import fs from 'node:fs'
import path from 'node:path'
import { sha } from './ai.mjs'
import { writeJSON } from './store.mjs'
import { reviewCases, loadEvidence, evidenceReceipt } from './ai-evidence.mjs'
import { regressionWindow } from './history.mjs'

// Summarize allowlisted diagnostic signals, never upload arbitrary log text, addresses or credentials.
const signals = {
    'Screenshot comparison mismatch': /toHaveScreenshot|toMatchSnapshot|pixels.*different/i,
    'Timeout observed': /timed? ?out|timeout/i,
    'Connection refused': /ECONNREFUSED|connection refused/i,
    'Connection closed': /connection (?:closed|reset)|ECONNRESET/i,
    'Authentication failure': /authentication failed|permission denied/i,
    'Known crash reporter observed': /crash.reporter|apport/i,
    'Missing baseline': /snapshot.*(?:missing|does not exist)|baseline.*missing/i,
}
export function investigationEvidence(run, directory, runs) {
    const base=fs.realpathSync(directory), attachments=run.tests.flatMap(t=>t.attachments || [])
    const candidates=[{name:'execution log',path:'execution.log',contentType:'text/plain'},...attachments]
    const artifacts=[]; const observed = new Set()
    for(const a of candidates.slice(0,300)) {
        try {
            const file=fs.realpathSync(path.resolve(directory,a.path)), stat=fs.statSync(file)
            if(!file.startsWith(base+path.sep)||!stat.isFile()||stat.size>40_000_000)continue
            const content=fs.readFileSync(file)
            artifacts.push({name:a.name,path:a.path,contentType:a.contentType,bytes:stat.size,sha256:sha(content)})
            if(/(?:text|json)/.test(a.contentType || '') && stat.size<=2_000_000 && !run.mutations) {
                const text=content.toString('utf8')
                for(const [name,pattern] of Object.entries(signals)) if(pattern.test(text)) observed.add(name)
            }
        }catch{}
    }
    const facts={testStatus:run.status,executed:run.tests.some(t=>t.status!=='not-run'),diagnosticSignals:[...observed],
        screenshots:artifacts.filter(a=>a.contentType==='image/png').length,traces:artifacts.filter(a=>a.name==='trace').length,
        environmentReports:artifacts.filter(a=>a.name==='environment').length,logs:artifacts.filter(a=>/log/.test(a.name)).length}
    return {version:'investigation-1',runId:run.id,sourceCommit:run.commit,sourceDirty:run.dirty,baselineDigest:run.baselineDigest || null,
        github:run.github || null,createdAt:new Date().toISOString(),facts,artifacts,history:regressionWindow(run,runs),
        limitation:'Diagnostic signals summarize retained files; they are not a full trace replay. First observed failure does not establish causality. Model findings are advisory; source results remain unchanged.'}
}
export async function investigate(run,directory,runs,reviewer,signal) {
    const record=investigationEvidence(run,directory,runs), file=path.join(directory,'investigation.json')
    record.status='running';writeJSON(file,record)
    try {
        if(run.mutations) {record.status='not-evaluated';record.reason='Mutation evidence is evaluated separately without diagnostic labels.'}
        else {
            const cases=reviewCases(run,directory).filter(c=>!c.excluded)
            const item=cases.find(c=>c.id==='final-window') || cases.find(c=>c.id==='actual') || cases[0]
            if(!item) {record.status='no-image-evidence';record.reason='No eligible screenshot: diagnostic facts retained; no visual diagnosis claimed.'}
            else {
                const evidence=loadEvidence(item,directory)
                evidence.investigation=record.facts
                record.evidence=evidenceReceipt(evidence);record.caseId=item.id
                record.review=await reviewer.evaluate(evidence,signal)
                record.status='completed'
            }
        }
    }catch(error){record.status=signal?.aborted?'cancelled':'infrastructure-failed';record.reason=error.message}
    record.finishedAt=new Date().toISOString();writeJSON(file,record);return record
}

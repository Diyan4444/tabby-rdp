import fs from 'node:fs'
import path from 'node:path'
import { sha } from './ai.mjs'
import { readJSON, writeJSON, loadRuns } from './store.mjs'

export function history(runs) {
    const groups = new Map()
    for (const run of runs.filter(r => !r.mutations && r.stage === 'finished')) {
        const group = groups.get(run.test) || { test: run.test, points: [], suspectFlakes: [] }
        group.points.push({ id: run.id, commit: run.commit, dirty: run.dirty, status: run.status, durationMs: run.durationMs, startedAt: run.startedAt, baseline: run.baselineDigest || null })
        groups.set(run.test, group)
    }
    for (const group of groups.values()) {
        const comparable = new Map()
        for (const p of group.points.filter(p => !p.dirty && p.baseline && ['passed','failed'].includes(p.status))) {
            const key = p.commit + ':' + p.baseline
            const states = comparable.get(key) || new Set(); states.add(p.status); comparable.set(key, states)
        }
        group.suspectFlakes = [...comparable].filter(([,states]) => states.size > 1).map(([key]) => key)
        group.latest = group.points[0]; group.applicationFailures = group.points.filter(p=>p.status==='failed').length
        group.infrastructureFailures = group.points.filter(p=>p.status==='infrastructure-failed').length
        const durations = group.points.map(p=>p.durationMs).filter(Number.isFinite).sort((a,b)=>a-b)
        group.medianDurationMs = durations.length ? durations[Math.floor(durations.length / 2)] : null
    }
    return [...groups.values()]
}
export function regressionWindow(run, runs) {
    if (run.mutations || run.status !== 'failed' || run.dirty || !run.baselineDigest) return null
    const peers = runs.filter(r=>r.test===run.test && !r.mutations && !r.dirty && r.baselineDigest===run.baselineDigest && r.startedAt<=run.startedAt && ['passed','failed'].includes(r.status)).sort((a,b)=>a.startedAt.localeCompare(b.startedAt))
    const lastGood = peers.filter(r=>r.status==='passed').at(-1)
    const firstBad = peers.find(r=>r.status==='failed' && (!lastGood || r.startedAt>lastGood.startedAt))
    return { lastObservedGood: lastGood ? {runId:lastGood.id,commit:lastGood.commit} : null, firstObservedBad: firstBad ? {runId:firstBad.id,commit:firstBad.commit} : null, limitation:'Observed same-target/baseline history, not proof of a causal commit. Environment changes may explain failures.' }
}
export function baselineDigest(root) {
    const dir = path.join(root, 'test/visual/baselines')
    const visit = folder => fs.readdirSync(folder,{withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name)).flatMap(d=>d.isDirectory()?visit(path.join(folder,d.name)):d.isFile()?[path.join(folder,d.name)]:[])
    return sha(visit(dir).map(f=>path.relative(dir,f)+':'+sha(fs.readFileSync(f))).join('\n'))
}
function bytes(directory) {
    return fs.readdirSync(directory,{withFileTypes:true}).reduce((sum,d)=>sum+(d.isDirectory()?bytes(path.join(directory,d.name)):d.isFile()?fs.statSync(path.join(directory,d.name)).size:0),0)
}
export function retain(runsDir, directory, policy, protectedIds = [], now = Date.now()) {
    fs.mkdirSync(directory,{recursive:true,mode:0o700})
    const runs = loadRuns(runsDir), keep = new Set(protectedIds)
    // Latest result of each target/mode/status outlives routine passes.
    const representatives = new Set()
    for (const run of runs) {
        const key = `${run.test}:${!!run.mutations}:${run.status}`
        if (!representatives.has(key)) { keep.add(run.id); representatives.add(key) }
    }
    const auditFile = path.join(directory,'retention.json')
    const audit = fs.existsSync(auditFile)?readJSON(auditFile):{removed:[]}
    let total = 0
    const sizes = new Map(runs.map(r=> { const n=bytes(path.join(runsDir,r.id)); total+=n; return [r.id,n] }))
    let count = runs.length
    for (const run of [...runs].reverse()) {
        if (keep.has(run.id) || run.stage !== 'finished' || run.status === 'running') continue
        const age = (now-Date.parse(run.finishedAt || run.startedAt))/86400000
        const days = run.status === 'passed' && !run.mutations ? policy.passDays : policy.failureDays
        const over = count>=policy.maxRuns || total>=policy.maxBytes
        // Pressure may evict old routine passes; failures/campaigns receive their full longer minimum.
        if (age < days && !(over && run.status==='passed' && !run.mutations && age>=1)) continue
        audit.removed.push({id:run.id,test:run.test,status:run.status,commit:run.commit,removedAt:new Date(now).toISOString(),bytes:sizes.get(run.id)})
        audit.removed = audit.removed.slice(-1000)
        writeJSON(auditFile,audit) // Audit before deleting only managed, finished run directories.
        fs.rmSync(path.join(runsDir,run.id),{recursive:true,force:true}); count--; total-=sizes.get(run.id)
    }
    audit.checkedAt=new Date(now).toISOString(); audit.runs=count; audit.bytes=total; audit.policy=policy
    audit.capacityAvailable=count<policy.maxRuns && total<policy.maxBytes
    writeJSON(auditFile,audit); return audit
}

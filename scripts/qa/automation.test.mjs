import {test} from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {Automation,validateAutomation,profiles} from './automation.mjs'
import {retain,history,regressionWindow} from './history.mjs'
import {investigationEvidence} from './investigation.mjs'
import {githubContext} from './github.mjs'
import {writeJSON} from './store.mjs'
const temporary=t=>{const d=fs.mkdtempSync(path.join(os.tmpdir(),'trd-automation-'));t.after(()=>fs.rmSync(d,{recursive:true,force:true}));return d}
const hash='a'.repeat(40)
test('scheduler persists due time, serializes, coalesces missed intervals and recovers without replay',async t=>{
 const dir=temporary(t),config=validateAutomation({schedules:[{id:'daily',profile:'smoke',everyMinutes:1440,firstAt:'2026-10-01T00:00:00Z'}]})
 let count=0,release
 const hooks={busy:()=>false,source:()=>({commit:hash,dirty:false}),cancel:()=>{},run:async()=>{count++;if(count===1)await new Promise(r=>release=r);return{id:String(count),status:'passed'}}}
 const a=new Automation(dir,config,hooks)
 await a.tick(Date.parse('2026-10-11T12:00:00Z'));await new Promise(r=>setImmediate(r))
 assert.equal(a.state.due.daily,'2026-10-12T00:00:00.000Z');assert.equal(count,1)
 assert.throws(()=>a.start('smoke',{}),/active/);await a.tick();assert.equal(count,1)
 const recovered=new Automation(dir,config,hooks);assert.equal(recovered.state.jobs[0].status,'interrupted');assert.equal(recovered.state.jobs[0].steps[1].status,'not-executed')
 release();await a.promise;assert.equal(a.state.jobs[0].status,'passed');assert.equal(count,3)
 a.pause(true);assert.equal(new Automation(dir,config,hooks).state.paused,true)
})
test('exact clean source, cancellation and changed checkout never silently execute later steps',async t=>{
 const dir=temporary(t);let count=0,dirty=true
 const a=new Automation(dir,validateAutomation(),{busy:()=>false,source:()=>({commit:hash,dirty}),run:async()=>{count++;dirty=true;return{id:'one',status:'passed'}},cancel:()=>{}})
 a.start('smoke',{});await a.promise;assert.equal(count,0);assert.equal(a.state.jobs.at(-1).status,'blocked')
 dirty=false;a.start('smoke',{},'b'.repeat(40));await a.promise;assert.equal(count,0)
 a.start('smoke',{},hash);await a.promise;assert.equal(count,1);assert.equal(a.state.jobs.at(-1).steps[1].status,'not-executed')
 assert.equal(profiles.matrix.steps.length,18)
 assert.throws(()=>validateAutomation({schedules:[{id:'bad',profile:'shell',everyMinutes:1,firstAt:'2026-10-11'}]}))
 assert.throws(()=>validateAutomation({retention:{passDays:90,failureDays:1}}))
})
test('retention protects active/latest/failure evidence, records removals and reports capacity honestly',t=>{
 const dir=temporary(t),runs=path.join(dir,'runs');fs.mkdirSync(runs)
 const put=(n,status,days,test='visual-host')=>{const id=`2026-10-01T00-00-00.000Z-${String(n).padStart(8,'0')}`,d=path.join(runs,id);fs.mkdirSync(d);const date=new Date(Date.parse('2026-10-11')-days*86400000).toISOString();writeJSON(path.join(d,'run.json'),{id,test,status,stage:status==='running'?'testing':'finished',commit:hash,startedAt:date,finishedAt:date});return id}
 const old=put(1,'passed',30),latest=put(2,'passed',1),failure=put(3,'failed',30),active=put(4,'running',31),pinned=put(5,'passed',40)
 const report=retain(runs,path.join(dir,'retention'),{passDays:14,failureDays:90,maxRuns:3,maxBytes:1000000},[pinned],Date.parse('2026-10-11'))
 assert.equal(fs.existsSync(path.join(runs,old)),false)
 for(const id of [latest,failure,active,pinned])assert.equal(fs.existsSync(path.join(runs,id)),true)
 assert.equal(report.capacityAvailable,false);assert.equal(report.removed[0].id,old)
})
test('history excludes mutations and infrastructure from suspected flakes and qualifies causal window',()=>{
 const run=(id,status,commit=hash)=>({id,test:'visual-host',status,stage:'finished',commit,dirty:false,baselineDigest:'same',startedAt:`2026-10-${id}T00:00:00Z`,durationMs:100})
 const good=run('01','passed'),bad=run('02','failed'),infra=run('03','infrastructure-failed'),mutation={...run('04','failed'),mutations:[]}
 const h=history([mutation,infra,bad,good]);assert.equal(h[0].suspectFlakes.length,1);assert.equal(h[0].applicationFailures,1);assert.equal(h[0].infrastructureFailures,1)
 assert.equal(regressionWindow(bad,[good,bad]).lastObservedGood.runId,'01');assert.match(regressionWindow(bad,[good,bad]).limitation,/not proof/)
 assert.equal(regressionWindow({...bad,dirty:true},[good,bad]),null)
})
test('investigations retain artifact hashes but only allowlisted diagnostic signals enter AI context',t=>{
 const dir=temporary(t);fs.writeFileSync(path.join(dir,'execution.log'),'password=DO_NOT_UPLOAD connection refused 10.0.0.8 secret instructions')
 fs.symlinkSync('/etc/hosts',path.join(dir,'escape'))
 const r=investigationEvidence({id:'x',commit:hash,status:'infrastructure-failed',tests:[{status:'not-run',attachments:[{name:'escape',path:'escape',contentType:'text/plain'}]}]},dir,[])
 assert.equal(r.artifacts.length,1);assert.equal(r.artifacts[0].sha256.length,64);assert.deepEqual(r.facts.diagnosticSignals,['Connection refused']);assert.equal(JSON.stringify(r).includes('DO_NOT_UPLOAD'),false)
})
test('GitHub metadata requires the exact commit; outages never imply CI success',async()=>{
 const record=await githubContext(hash,async endpoint=>endpoint.includes('/pulls')?[{number:2,state:'open'}]:{workflow_runs:[{id:3,head_sha:hash,status:'completed',conclusion:'success',event:'push',head_branch:'main'},{id:4,head_sha:'b'.repeat(40)}]})
 assert.equal(record.pullRequests[0].number,2);assert.equal(record.ci.length,1)
 assert.equal((await githubContext(hash,async()=>{throw Error('token=secret')})).status,'unavailable')
 await assert.rejects(githubContext('invalid'))
})
test('hosted workflow cannot upload private QA/auth data or request OpenAI secrets',()=>{
 const workflow=fs.readFileSync(new URL('../../.github/workflows/visual-qa.yml',import.meta.url),'utf8')
 assert.match(workflow,/runs-on: \$\{\{ matrix.os \}\}/)
 assert.match(workflow,/os: \[ubuntu-24.04, windows-2025, macos-15\]/)
 assert.match(workflow,/path: \$\{\{ runner.temp \}\}\/tabby-qa-evidence\//)
 assert.match(workflow,/persist-credentials: false/)
 assert.equal(/\$\{\{\s*secrets\.|CODEX_HOME|OPENAI_API_KEY|TRD_QA_ENV_FILE|TRD_QA_TARGETS_FILE|self-hosted|pull_request_target/.test(workflow),false)
})

// Observe an actual scheduled batch, then inspect its retained evidence in the authenticated browser.
import fs from 'node:fs'
import path from 'node:path'
import assert from 'node:assert/strict'
import {chromium,expect} from '@playwright/test'
const data=path.resolve(process.env.TRD_QA_DATA || '.qa'),base=`http://127.0.0.1:${process.env.TRD_QA_PORT || 4317}`
const token=fs.readFileSync(path.join(data,'token'),'utf8').trim(),headers={Authorization:'Bearer '+token}
let state,job
for(let i=0;i<360;i++) {
    state=await fetch(base+'/api/runs',{headers}).then(r=>r.json())
    job=process.argv[2]?state.automation.jobs.find(j=>j.id===process.argv[2]):[...state.automation.jobs].reverse().find(j=>j.trigger.kind==='schedule')
    if(job && job.status!=='running')break
    if(i%12===0)console.log('Waiting for the configured scheduled batch to finish')
    await new Promise(r=>setTimeout(r,5000))
}
assert.ok(job,'No scheduled batch');assert.equal(job.trigger.kind,'schedule')
assert.ok(['passed','attention'].includes(job.status),JSON.stringify(job))
const runs=job.steps.map(s=>state.runs.find(r=>r.id===s.runId))
assert.ok(runs.every(r=>r && !r.dirty && r.commit===job.commit && ['passed','failed'].includes(r.status)))
const campaign=runs.find(r=>r.mutations)
assert.ok(campaign);assert.equal(campaign.status,'passed');assert.equal(campaign.effectiveness.manifested,campaign.mutations.length)
assert.equal(campaign.ai.status,'completed');assert.ok(campaign.experiments.every(t=>t.restored))
assert.equal(runs.at(-1).status,'passed','Final healthy lifecycle must restore the environment')
for(const run of runs.filter(r=>r.status==='failed'))assert.equal(run.investigation?.status,'completed','Failed test must receive automatic investigation')
const browser=await chromium.launch(process.env.TRD_QA_BROWSER?{executablePath:process.env.TRD_QA_BROWSER}:{})
try {
    const page=await browser.newPage({viewport:{width:1440,height:1100}}),errors=[]
    page.on('pageerror',e=>errors.push(e.message))
    await page.goto(base);await page.getByLabel('Dashboard access token').fill(token);await page.getByRole('button',{name:'Sign in',exact:true}).click()
    const batch=page.locator('#automation-jobs details').filter({hasText:`${job.profile} · ${job.status} · schedule`}).first()
    await batch.locator('summary').click()
    await expect(batch).toHaveAttribute('open','')
    await batch.getByRole('button',{name:'View run'}).nth(runs.indexOf(campaign)).click()
    await expect(page.locator('#detail')).toHaveAttribute('data-run-id',campaign.id)
    const image=page.locator('#detail > .gallery img').first();await image.scrollIntoViewIfNeeded()
    await expect.poll(()=>image.evaluate(img=>img.complete&&img.naturalWidth>0),{timeout:20000}).toBe(true)
    await page.screenshot({path:path.join(data,'phase5-evidence.png')})
    const failed=runs.find(r=>r.status==='failed')
    if(failed) {
        await batch.getByRole('button',{name:'View run'}).nth(runs.indexOf(failed)).click()
        await expect(page.locator('#detail')).toHaveAttribute('data-run-id',failed.id)
        await expect(page.locator('#investigation')).toContainText('completed')
        await page.locator('#investigation').scrollIntoViewIfNeeded()
        await page.screenshot({path:path.join(data,'phase5-investigation.png')})
    }
    await page.evaluate(()=>scrollTo(0,0));await page.waitForTimeout(300)
    await page.screenshot({path:path.join(data,'phase5-dashboard.png')})
    await page.setViewportSize({width:390,height:844});await page.evaluate(()=>scrollTo(0,0));await page.waitForTimeout(300)
    await page.screenshot({path:path.join(data,'phase5-mobile.png')})
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));assert.deepEqual(errors,[])
    const receipt={acceptedAt:new Date().toISOString(),job,runIds:runs.map(r=>r.id),mutation:campaign.effectiveness,ai:campaign.ai.metrics,failedRuns:runs.filter(r=>r.status==='failed').map(r=>({id:r.id,status:r.status,investigation:r.investigation.status})),browserErrors:errors}
    fs.writeFileSync(path.join(data,'phase5-scheduled-acceptance.json'),JSON.stringify(receipt,null,2))
    console.log(JSON.stringify({batch:job.id,status:job.status,runIds:receipt.runIds,browserAccepted:true}))
} finally {await browser.close()}

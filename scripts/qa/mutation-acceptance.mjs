// Real browser demonstration, reusing the existing authenticated dashboard and RDP test.
import fs from 'node:fs'
import path from 'node:path'
import { chromium, expect } from '@playwright/test'
const data=path.resolve(process.env.TRD_QA_DATA || '.qa')
const target=process.argv[2] || 'visual-macos-ubuntu2404'
const ids=(process.argv[3] || 'crop').split(',')
const browser=await chromium.launch({...(process.env.TRD_QA_BROWSER ? {executablePath:process.env.TRD_QA_BROWSER} : {})})
try {
    const context=await browser.newContext({viewport:{width:1440,height:1000}})
    const page=await context.newPage(), errors=[]
    page.on('pageerror',error=>errors.push(error.message))
    await page.goto(`http://127.0.0.1:${process.env.TRD_QA_PORT || 4317}`)
    await page.getByLabel('Dashboard access token').fill(fs.readFileSync(path.join(data,'token'),'utf8').trim())
    await page.getByRole('button',{name:'Sign in',exact:true}).click()
    await page.getByLabel('Test environment').selectOption(target)
    const receipts=[]
    const execute=async(campaign)=>{
        const created=page.waitForResponse(r=>r.url().endsWith(campaign ? '/api/campaigns' : '/api/runs') && r.request().method()==='POST')
        await page.getByRole('button',{name:campaign ? 'Run selected mutations' : 'Run visual test',exact:true}).click()
        const response=await created;expect(response.status()).toBe(202)
        const run=await response.json()
        await expect(page.locator('#detail')).toHaveAttribute('data-run-id',run.id)
        await expect(page.locator('#detail h2')).not.toHaveText('Running',{timeout:970_000})
        await expect(page.locator('#detail h2')).toHaveText(campaign ? 'Campaign completed' : 'Passed')
        const state=await (await context.request.get(`http://127.0.0.1:${process.env.TRD_QA_PORT || 4317}/api/runs`)).json()
        const completed=state.runs.find(r=>r.id===run.id)
        receipts.push({id:run.id,commit:run.commit,dirty:run.dirty,campaign,metrics:completed.effectiveness})
        console.log(JSON.stringify(receipts.at(-1)))
        return completed
    }
    await execute(false)
    for(const checkbox of await page.locator('[data-mutation]').all()) await checkbox.uncheck()
    for(const id of ids) await page.locator(`[data-mutation="${id}"]`).check()
    const experiment=await execute(true)
    expect(experiment.effectiveness.manifested).toBe(ids.length)
    expect(experiment.effectiveness.detected).toBe(ids.length)
    expect(experiment.effectiveness.falsePositives).toBe(0)
    expect(experiment.experiments.every(t=>t.restored)).toBe(true)
    await page.locator('#detail').scrollIntoViewIfNeeded()
    await page.screenshot({path:path.join(data,`${target}-mutations.png`)})
    const image=page.locator('#detail img[alt*="experiment-2-crop-actual"]')
    const evidenceImage=await image.count() ? image.first() : page.locator('#detail img').first()
    await evidenceImage.scrollIntoViewIfNeeded();await expect.poll(()=>evidenceImage.evaluate(i=>i.complete && i.naturalWidth>0)).toBe(true)
    await page.screenshot({path:path.join(data,`${target}-mutation-evidence.png`)})
    const popup=page.waitForEvent('popup')
    await page.getByRole('link',{name:'Playwright report & trace viewer'}).click()
    const report=await popup
    await report.getByText(/Real RDP visual checkpoints:/).first().click()
    await report.locator('a[href*="trace/index.html"]').first().click()
    await report.waitForURL('**/trace/index.html?**')
    await expect(report.getByRole('treeitem',{name:/toHaveScreenshot/}).first()).toBeVisible({timeout:20_000})
    await report.screenshot({path:path.join(data,`${target}-mutation-trace.png`)})
    await page.setViewportSize({width:390,height:844})
    await page.locator('#mutations-panel').scrollIntoViewIfNeeded()
    await page.screenshot({path:path.join(data,`${target}-mutations-mobile.png`)})
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true)
    await execute(false)
    expect(errors).toEqual([])
    fs.writeFileSync(path.join(data,`${target}-mutation-acceptance.json`),JSON.stringify({receipts,ids,acceptedAt:new Date().toISOString()},null,2))
} finally {await browser.close()}

// Exercises the dashboard in a browser, including its locally hosted Playwright trace viewer.
// Start npm run qa first. Install Chromium (npx playwright install chromium), or set TRD_QA_BROWSER.
import { catalog } from './store.mjs'
import fs from 'node:fs'
import path from 'node:path'
import { chromium, expect } from '@playwright/test'
const selected = process.argv[2] || 'visual-host'
const suite = catalog.find(item => item.id === selected)?.suite || selected
const base = `http://127.0.0.1:${process.env.TRD_QA_PORT || 4317}`
const data = path.resolve(process.env.TRD_QA_DATA || '.qa')
const browser = await chromium.launch({ ...(process.env.TRD_QA_BROWSER ? { executablePath: process.env.TRD_QA_BROWSER } : {}) })
try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1100 } })
    const page = await context.newPage()
    page.context().setDefaultTimeout(20_000)
    const errors = []
    page.on('pageerror', e => errors.push(e.message))
    await page.goto(base)
    await page.getByLabel('Dashboard access token').fill(fs.readFileSync(path.join(data, 'token'), 'utf8').trim())
    await page.getByRole('button', { name: 'Sign in', exact: true }).click()
    await expect(page.getByRole('button', { name: 'Run visual test', exact: true })).toBeVisible()
    await page.getByLabel('Test environment').selectOption(selected)
    const creation = page.waitForResponse(r => r.url().endsWith('/api/runs') && r.request().method() === 'POST')
    await page.getByRole('button', { name: 'Run visual test', exact: true }).click()
    const run = await (await creation).json()
    await expect(page.locator('#detail')).toHaveAttribute('data-run-id', run.id)
    // Stop promptly on a terminal failure rather than waiting for a failure to turn into a pass.
    await expect(page.locator('#detail h2')).not.toHaveText('Running', { timeout: 320_000 })
    await expect(page.locator('#detail h2')).toHaveText('Passed')
    await expect(page.locator('#detail img').first()).toBeVisible()
    expect(await page.locator('#detail img').first().evaluate(img => img.naturalWidth)).toBeGreaterThan(0)
    await page.screenshot({ path: path.join(data, `${selected}-dashboard.png`), fullPage: true })
    const reportPage = page.waitForEvent('popup')
    await page.getByRole('link', { name: 'Playwright report & trace viewer' }).click()
    const report = await reportPage
    await report.waitForLoadState('networkidle')
    await report.getByText(suite === 'visual-host' ? 'Remote Desktop settings in real Tabby' : `Real RDP visual checkpoints: ${suite.slice(7)}`, { exact: true }).click()
    await report.waitForTimeout(500)
    const traceLink = report.locator('a[href*="trace/index.html"]').first()
    await expect(traceLink).toBeVisible()
    await traceLink.click()
    const trace = report
    await trace.waitForURL('**/trace/index.html?**')
    await trace.waitForLoadState('networkidle')
    await expect(trace.getByRole('treeitem', { name: /toHaveScreenshot/ }).first()).toBeVisible({ timeout: 20_000 })
    await trace.screenshot({ path: path.join(data, `${selected}-trace.png`) })
    await page.setViewportSize({ width: 390, height: 844 })
    await page.screenshot({ path: path.join(data, `${selected}-mobile.png`), fullPage: true })
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    expect(errors).toEqual([])
    const evidence = { runId: run.id, commit: run.commit, dirty: run.dirty, browserWorkflow: 'Sign in → run → passed → screenshot → HTML report → local trace viewer', acceptedAt: new Date().toISOString() }
    fs.writeFileSync(path.join(data, `${selected}-acceptance.json`), JSON.stringify(evidence, null, 2))
    console.log(JSON.stringify(evidence))
} finally { await browser.close() }

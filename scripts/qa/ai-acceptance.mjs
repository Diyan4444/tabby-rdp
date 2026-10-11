// Browser validation of the actual service. No provider substitutes or fabricated detector outcomes.
// --unconfigured verifies the disabled/error path only; it cannot establish Phase 4 acceptance.
import fs from 'node:fs'
import path from 'node:path'
import { chromium, expect } from '@playwright/test'
const data = path.resolve(process.env.TRD_QA_DATA || '.qa')
const base = `http://127.0.0.1:${process.env.TRD_QA_PORT || 4317}`
const args = process.argv.slice(2), unconfigured = args.includes('--unconfigured')
const ids = args.filter(a => a !== '--unconfigured')
if (!ids.length || ids.some(id => !/^[\dT.Z-]+-[a-f0-9]{8}$/.test(id))) throw new Error('Supply retained run IDs')
const browser = await chromium.launch({ ...(process.env.TRD_QA_BROWSER ? { executablePath: process.env.TRD_QA_BROWSER } : {}) })
try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } }), page = await context.newPage(), errors = [], receipts = []
    page.on('pageerror', e => errors.push(e.message))
    await page.goto(base)
    await page.getByLabel('Dashboard access token').fill(fs.readFileSync(path.join(data, 'token'), 'utf8').trim())
    await page.getByRole('button', { name: 'Sign in', exact: true }).click()
    const state = async () => (await context.request.get(base + '/api/runs')).json()
    await expect(page.locator('#workspace')).toBeVisible()
    expect((await state()).ai.configured).toBe(!unconfigured)
    for (const id of ids) {
        await page.locator(`.run-row[data-run-id="${id}"]`).click()
        await expect(page.locator('#detail')).toHaveAttribute('data-run-id', id)
        const original = (await state()).runs.find(r => r.id === id)
        if (unconfigured) {
            await expect(page.locator('#ai-review-run')).toBeDisabled()
            const rejected = await context.request.post(base + '/api/ai/reviews', { data: { runId: id } })
            expect(rejected.status()).toBe(409)
            expect((await rejected.json()).error).toContain('API key not configured')
            expect((await state()).runs.find(r => r.id === id).ai).toBeUndefined()
            receipts.push({ runId: id, sourceStatus: original.status, missingKeyRejected: true, evaluated: 0 })
        } else {
            const created = page.waitForResponse(r => r.url().endsWith('/api/ai/reviews') && r.request().method() === 'POST')
            await page.getByRole('button', { name: 'Review screenshots with AI', exact: true }).click()
            expect((await created).status()).toBe(202)
            let result
            await expect.poll(async () => { result = (await state()).runs.find(r => r.id === id); return result.ai.status }, { timeout: 1_250_000, intervals: [2000] }).not.toBe('running')
            expect(result.ai.status, result.ai.reason).toBe('completed')
            expect(result.status).toBe(original.status)
            expect(result.ai.cases.filter(c => !c.excluded).every(c => c.status === 'completed')).toBe(true)
            const first = page.locator('.ai-case').filter({ has: page.locator('summary', { hasText: /anomaly|healthy|uncertain/ }) }).first()
            await first.locator('summary').click()
            const image = first.locator('img').first()
            await image.scrollIntoViewIfNeeded(); await expect.poll(() => image.evaluate(i => i.complete && i.naturalWidth > 0)).toBe(true)
            receipts.push({ runId: id, reviewId: result.ai.id, detector: result.ai.detector, metrics: result.ai.metrics })
            // Repeating the same review must hit the local cache and issue no additional paid request.
            const requests = (await state()).ai.requests
            const repeated = await context.request.post(base + '/api/ai/reviews', { data: { runId: id } }); expect(repeated.status()).toBe(202)
            await expect.poll(async () => (await state()).ai.active, { timeout: 15_000 }).toBeNull()
            const cached = (await state()).runs.find(r => r.id === id).ai
            expect(cached.status).toBe('completed'); expect((await state()).ai.requests).toBe(requests)
            expect(cached.cases.filter(c => !c.excluded).every(c => c.review.cached)).toBe(true)
        }
        await page.locator('#ai-review').evaluate(e => e.scrollIntoView({ block: 'start' }))
        await page.screenshot({ path: path.join(data, `ai-${id}.png`) })
        await page.setViewportSize({ width: 390, height: 844 })
        await page.locator('#ai-review').evaluate(e => e.scrollIntoView({ block: 'start' }))
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
        await page.screenshot({ path: path.join(data, `ai-${id}-mobile.png`) })
        await page.setViewportSize({ width: 1440, height: 1000 })
        console.log(JSON.stringify(receipts.at(-1)))
    }
    expect(errors).toEqual([])
    fs.writeFileSync(path.join(data, unconfigured ? 'phase4-unconfigured-browser.json' : 'phase4-ai-acceptance.json'), JSON.stringify({ mode: unconfigured ? 'missing-credential-only' : 'live-provider', receipts, validatedAt: new Date().toISOString() }, null, 2))
} finally { await browser.close() }

import { test, expect, chromium } from '@playwright/test'
import fs from 'node:fs'
import type { HostSnapshot } from '../../src/hostCompat.js'

test('Remote Desktop settings in real Tabby', async ({}, info) => {
    info.annotations.push({ type: 'infrastructure', description: 'Connecting to the isolated Tabby browser' })
    const browser = await chromium.connectOverCDP(`http://127.0.0.1:${process.env.TRD_CDP_PORT}`)
    const context = browser.contexts()[0]
    await context.tracing.start({ screenshots: true, snapshots: true, sources: true })
    const page = context.pages().find(p => !p.url().startsWith('devtools:'))!
    info.annotations.splice(info.annotations.findIndex(a => a.type === 'infrastructure'), 1)
    const errors: string[] = []
    page.on('pageerror', error => errors.push(error.message))
    try {
        // Use the same real plugin handle as the existing CDP suites; no duplicate or mocked UI.
        await page.waitForFunction(() => !!(window as any).__remoteDesktop)
        expect(await page.evaluate(() => (globalThis as any).__trdSmokeCredentials)).toBe(true)
        const host = await page.evaluate<HostSnapshot>(() => (window as any).__remoteDesktop.compat.snapshot())
        await info.attach('host', { body: JSON.stringify({ ...host, viewport: '1100x800', scale: 1 }, null, 2), contentType: 'application/json' })
        const cdp = await context.newCDPSession(page)
        await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1100, height: 800, deviceScaleFactor: 1, mobile: false })
        await cdp.send('Emulation.setFocusEmulationEnabled', { enabled: true })
        await page.evaluate(() => (window as any).__remoteDesktop.help.open('settings'))
        const settings = page.locator('.trd-settings')
        await expect(settings).toBeVisible()
        await settings.locator('[data-tab=settings]').click()
        await expect(settings.locator('[data-setting=resize]')).toBeVisible()
        await page.evaluate(() => document.fonts.ready)
        // Baselines are specific to OS/architecture and the actual host runtime; never cross-compare hosts.
        const key = `${process.platform}-${process.arch}-tabby-${host.version}-electron-${host.electron}`.replace(/[^a-zA-Z0-9.-]/g, '_')
        const name = `${key}/settings-viewport.png`
        // Capture the visible viewport: Electron cannot paint a tall offscreen element by scrolling a screenshot.
        await info.attach('actual', { body: await page.screenshot({ animations: 'disabled', caret: 'hide', scale: 'css' }), contentType: 'image/png' })
        if (fs.existsSync(info.snapshotPath(name))) await info.attach('expected', { path: info.snapshotPath(name), contentType: 'image/png' })
        await expect(page).toHaveScreenshot(name)
        expect(errors, 'renderer exceptions').toEqual([])
    } finally {
        if (!page.isClosed()) await info.attach('window', { body: await page.screenshot({ scale: 'css' }), contentType: 'image/png' }).catch(() => {})
        const trace = info.outputPath('trace.zip')
        await context.tracing.stop({ path: trace })
        await info.attach('trace', { path: trace, contentType: 'application/zip' })
        await browser.close() // disconnect CDP; the existing runner owns Tabby's lifecycle
    }
})

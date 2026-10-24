import { test, expect, chromium } from '@playwright/test'
import { clientIdentity } from './identity.js'
import fs from 'node:fs'
import type { HostSnapshot } from '../../src/hostCompat.js'

const hostedSmoke = process.env.TRD_QA_TEST === 'visual-smoke'
test(hostedSmoke ? 'Native Tabby settings smoke (no baseline qualification)' : 'Remote Desktop settings in real Tabby', async ({}, info) => {
    info.annotations.push({ type: 'infrastructure', description: 'Connecting to the isolated Tabby browser' })
    const browser = await chromium.connectOverCDP(`http://127.0.0.1:${process.env.TRD_CDP_PORT}`)
    const context = browser.contexts()[0]
    await context.tracing.start({ screenshots: true, snapshots: true, sources: true })
    const page = context.pages().find(p => !p.url().startsWith('devtools:'))!
    const errors: string[] = []
    page.on('pageerror', error => errors.push(error.message))
    try {
        // Use the same real plugin handle as the existing CDP suites; no duplicate or mocked UI.
        await page.waitForFunction(() => !!(window as any).__remoteDesktop)
        expect(await page.evaluate(() => (globalThis as any).__trdSmokeCredentials)).toBe(true)
        const client = await clientIdentity(script => page.evaluate(`(async () => {${script}})()`))
        info.annotations.splice(info.annotations.findIndex(a => a.type === 'infrastructure'), 1)
        const host = await page.evaluate<HostSnapshot>(() => (window as any).__remoteDesktop.compat.snapshot())
        await info.attach('host', { body: JSON.stringify({ ...host, ...client, viewport: '1100x800', scale: 1 }, null, 2), contentType: 'application/json' })
        const cdp = await context.newCDPSession(page)
        await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1100, height: 800, deviceScaleFactor: 1, mobile: false })
        await cdp.send('Emulation.setFocusEmulationEnabled', { enabled: true })
        // Compare to Tabby's own control in the same host/theme, rather than asserting a hand-copied CSS design.
        await page.evaluate(() => (window as any).__remoteDesktop.help.openSettings('window'))
        const standardToggle = page.locator('window-settings-tab toggle input[type=checkbox]').first()
        await expect(standardToggle).toBeVisible()
        const reference = await standardToggle.evaluate(el => {
            const style = getComputedStyle(el)
            return { checked: (el as HTMLInputElement).checked, width: style.width, height: style.height,
                borderRadius: style.borderRadius, backgroundColor: style.backgroundColor,
                backgroundImage: style.backgroundImage, cursor: style.cursor, fontSize: style.fontSize }
        })
        await info.attach('tabby-standard-toggle', { body: await standardToggle.locator('..').screenshot(), contentType: 'image/png' })
        // Open the ordinary settings page. Help-topic navigation schedules smooth scrolling.
        await page.evaluate(() => (window as any).__remoteDesktop.help.openSettings('remote-desktop'))
        const settings = page.locator('.trd-settings')
        await expect(settings).toBeVisible()
        await settings.locator('[data-tab=settings]').click()
        const soundToggle = settings.locator('[data-setting=sound]')
        await expect(settings.locator('trd-settings-toggle toggle input[type=checkbox]')).toHaveCount(process.platform === 'darwin' ? 8 : 7)
        await expect(soundToggle).toHaveAccessibleName('Sound')
        const originalSound = await soundToggle.isChecked()
        if (originalSound !== reference.checked) await soundToggle.click()
        await expect.poll(() => page.evaluate(() => (window as any).__remoteDesktop.desktop.settings().sound)).toBe(reference.checked)
        await soundToggle.evaluate(el => (el as HTMLInputElement).blur())
        await expect.poll(() => soundToggle.evaluate(el => {
            const style = getComputedStyle(el)
            return { checked: (el as HTMLInputElement).checked, width: style.width, height: style.height,
                borderRadius: style.borderRadius, backgroundColor: style.backgroundColor,
                backgroundImage: style.backgroundImage, cursor: style.cursor, fontSize: style.fontSize }
        })).toEqual(reference)
        // Space must change the real setting once, and external configuration changes must update the component.
        await soundToggle.focus()
        await soundToggle.press('Space')
        await expect.poll(() => page.evaluate(() => (window as any).__remoteDesktop.desktop.settings().sound)).toBe(!reference.checked)
        await page.evaluate(sound => (window as any).__remoteDesktop.desktop.updateSettings({ sound }), originalSound)
        await expect(soundToggle).toBeChecked({ checked: originalSound })
        await soundToggle.evaluate(el => (el as HTMLInputElement).blur())
        const clientChoice = settings.locator('[data-setting=client]')
        await expect(clientChoice).toBeVisible()
        await expect(clientChoice.locator('option')).toHaveText(['IronRDP', 'FreeRDP (experimental)'])
        const originalClient = await clientChoice.inputValue()
        await clientChoice.selectOption('freerdp')
        await expect.poll(() => page.evaluate(() => (window as any).__remoteDesktop.desktop.settings().client)).toBe('freerdp')
        await clientChoice.selectOption(originalClient)
        await expect(settings.locator('[data-setting=resize]')).toBeVisible()
        await expect(settings.locator('h3')).toBeInViewport({ ratio: 1 })
        await page.evaluate(() => document.fonts.ready)
        // Persistent clients retain settings scroll after other tests use the page.
        // Establish the top-of-page precondition without changing styles or the reviewed baseline.
        const content = page.locator('settings-tab .tab-content')
        await content.evaluate(el => el.scrollTo({ top: 0, left: 0, behavior: 'instant' }))
        await expect.poll(() => content.evaluate(el => el.scrollTop)).toBe(0)
        // Baselines are specific to OS/architecture and the actual host runtime; never cross-compare hosts.
        const key = `${client.platform}-${client.arch}-tabby-${host.version}-electron-${host.electron}`.replace(/[^a-zA-Z0-9.-]/g, '_')
        const name = `${key}/settings-viewport.png`
        // Capture the visible viewport: Electron cannot paint a tall offscreen element by scrolling a screenshot.
        await info.attach('actual', { body: await page.screenshot({ animations: 'disabled', caret: 'hide', scale: 'css' }), contentType: 'image/png' })
        if (!hostedSmoke && fs.existsSync(info.snapshotPath(name))) await info.attach('expected', { path: info.snapshotPath(name), contentType: 'image/png' })
        if (hostedSmoke) {
            info.annotations.push({ type: 'coverage', description: 'Real native settings visibility and renderer checks with screenshot/trace. No reviewed hosted-runner baseline; no RDP coverage.' })
            expect(host.version).toBe('1.0.236')
            expect(client.platform).toBe(process.platform)
            expect(client.arch).toBe(process.arch)
        } else await expect(page).toHaveScreenshot(name)
        expect(errors, 'renderer exceptions').toEqual([])
    } finally {
        if (!page.isClosed()) await info.attach('window', { body: await page.screenshot({ scale: 'css' }), contentType: 'image/png' }).catch(() => {})
        const trace = info.outputPath('trace.zip')
        await context.tracing.stop({ path: trace })
        await info.attach('trace', { path: trace, contentType: 'application/zip' })
        await browser.close() // disconnect CDP; the existing runner owns Tabby's lifecycle
    }
})

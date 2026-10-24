// Real Tabby lifecycle against a dedicated RDP test server. Also accepts the local FreeRDP sample server.
// No provisioning, VM startup, or performance claim. Credentials use the runner's isolated in-memory store.
import { suite, type CanvasInfo } from '../lib/harness.js'
import { parseAddress } from '../../src/desktopForm.js'

await suite('freerdp', async t => {
    const address = parseAddress(t.env.direct.address)
    if (!address || !t.env.direct.user || !t.env.direct.password) {
        t.skip('FreeRDP desktop lifecycle', 'set TRD_TEST_DIRECT, TRD_TEST_DIRECT_USER and TRD_TEST_DIRECT_PASSWORD for a dedicated test server')
        return
    }
    await t.settings({ client: 'ironrdp', resize: 'off', sharpness: 'standard', h264: false, microphone: false, sound: false })
    await t.ev(`
        const before = new Set(H.panes())
        await H.inZone(() => RD.injector.get(require('tabby-core').ProfilesService).openNewTabForProfile({
            id: 'rdp:freerdp-test', type: 'rdp', name: 'FreeRDP test', options: {
                host: ${JSON.stringify(address.host)}, port: ${address.port}, kind: ${JSON.stringify(t.env.direct.kind)},
                username: ${JSON.stringify(t.env.direct.user)}, client: 'freerdp', clipboard: 'off', via: '', gateway: '', account: null
            }
        }))
        for (let i = 0; i < 80; i++) {
            H.nativePane = H.panes().find(p => !before.has(p))
            if (H.nativePane) { H.opened.push(H.nativePane); break }
            await new Promise(r => setTimeout(r, 100))
        }
    `)
    t.check('remote desktop tab opened', await t.ev('return !!H.nativePane'))
    const settle = async (): Promise<boolean> => {
        await t.ev('H.nativeCredentialsSubmitted = false')
        for (let i = 0; i < 120; i++) {
            const state = await t.ev<string>(`
                if (H.session(H.nativePane)?.state === 'connected') return 'connected'
                const form = H.overlay(H.nativePane)?.querySelector('.trd-signin form')
                if (form) {
                    const error = form.querySelector('.trd-signin-error')?.textContent
                    if (H.nativeCredentialsSubmitted && error?.trim()) return 'The sign-in was refused: ' + error
                    if (H.nativeCredentialsSubmitted) return 'waiting'
                    form.querySelector('[name=password]').value = ${JSON.stringify(t.env.direct.password)}
                    H.inZone(() => form.requestSubmit())
                    H.nativeCredentialsSubmitted = true
                    return 'waiting'
                }
                const status = H.status(H.nativePane)
                for (const label of ['Trust the certificate', 'Send the password anyway']) {
                    if (status?.buttons.includes(label)) { H.inZone(() => H.clickStatus(H.nativePane, label)); return 'waiting' }
                }
                return status?.text ?? 'waiting'
            `)
            if (state === 'connected') return true
            if (/connection failed|not installed|not support|not connected|sign-in was refused/i.test(state)) {
                t.check('FreeRDP connection succeeds', false, state)
                return false
            }
            await t.sleep(250)
        }
        return false
    }
    if (!await settle()) { t.check('FreeRDP connected before timeout', false, await t.ev('return H.status(H.nativePane)')); return }
    // A new Windows test account can spend time initializing its profile after RDP is already active.
    const settleMs = Number(process.env.TRD_TEST_RDP_SETTLE_MS || 0)
    if (Number.isFinite(settleMs) && settleMs > 0) await t.sleep(Math.min(30000, settleMs))
    t.check('per-profile FreeRDP overrides the IronRDP global default', await t.ev(`return !!H.overlay(H.nativePane).querySelector('.trd-freerdp')`))
    t.check('FreeRDP draws desktop pixels', !!await t.waitFor(`return H.canvas(H.nativePane)?.colors > 2`, 10), await t.ev<CanvasInfo>('return H.canvas(H.nativePane)'))
    await t.dump('H.nativePane', 'freerdp-connected')
    await t.ev(`
        H.nativeProcess = H.session(H.nativePane).ui.native
        H.nativePid = H.nativeProcess.child.pid
        H.nativeKeys = 0
        const send = H.nativeProcess.send.bind(H.nativeProcess)
        H.nativeProcess.send = (type, data) => { if (type === 'K') H.nativeKeys++; send(type, data) }
    `)
    await t.clickDesktop('H.nativePane')
    t.check('remote display contains visible content after pointer input', !!await t.waitFor(`return H.canvas(H.nativePane)?.colors > 20`, 5))
    await t.dump('H.nativePane', 'freerdp-input')
    await t.press('a')
    t.check('ordinary keys reach the native client through Tabby keyboard routing', await t.ev('return H.nativeKeys >= 2'))
    const paneStyle = await t.ev<string>('return H.nativePane.element.nativeElement.style.cssText')
    t.onCleanup(() => t.ev(`if (H.nativePane?.element?.nativeElement) H.nativePane.element.nativeElement.style.cssText = ${JSON.stringify(paneStyle)}`))
    const setPane = (width: number, height: number) => t.ev(`
        const el = H.nativePane.element.nativeElement
        el.style.flex = 'none'; el.style.minWidth = '0'; el.style.minHeight = '0'; el.style.width = '${width}px'; el.style.height = '${height}px'
    `)
    await setPane(800, 560)
    await t.settings({ resize: 'live' })
    const matchesPane = (width: number, height: number) => `const c = H.canvas(H.nativePane); return !!c && Math.abs(c.paneW - ${width}) <= 2 && Math.abs(c.paneH - ${height}) <= 2 && Math.abs(c.w - c.paneW) <= 2 && Math.abs(c.h - c.paneH) <= 2 && c.colors > 20`
    t.check('live resize draws pixels at the larger pane resolution', !!await t.waitFor(matchesPane(800, 560), 15), await t.ev('return H.canvas(H.nativePane)'))
    const large = await t.ev<CanvasInfo>('return H.canvas(H.nativePane)')
    await setPane(640, 480)
    t.check('live resize draws pixels at the smaller pane resolution', !!await t.waitFor(matchesPane(640, 480), 15), await t.ev('return H.canvas(H.nativePane)'))
    const small = await t.ev<CanvasInfo>('return H.canvas(H.nativePane)')
    t.check('display-control resize changes the remote dimensions without reconnecting', small.w < large.w &&
        await t.ev('return H.nativeProcess.child.pid === H.nativePid'), { large, small })
    await t.dump('H.nativePane', 'freerdp-resized')
    await t.settings({ resize: 'off' })
    await setPane(740, 520)
    await t.sleep(600)
    const fixed = await t.ev<CanvasInfo>('return H.canvas(H.nativePane)')
    t.check('fixed-resolution mode retains the remote size and fits the picture into the pane', fixed.w === small.w && fixed.h === small.h &&
        fixed.cssW <= fixed.paneW + 2 && fixed.cssH <= fixed.paneH + 2, fixed)
    await t.ev('H.inZone(() => RD.desktop.setViewOnly(H.nativePane, true)); H.nativeKeys = 0')
    await t.press('b')
    t.check('view only blocks native keyboard input', await t.ev('return H.nativeKeys === 0'))
    await t.ev('H.inZone(() => RD.desktop.setViewOnly(H.nativePane, false))')
    await t.ev('H.inZone(() => RD.desktop.disconnect(H.nativePane))')
    t.check('disconnect reaps the native process', !!await t.waitFor(`try { process.kill(H.nativePid, 0); return false } catch { return true }`, 5))
    t.check('disconnect removes the native UI', await t.ev(`return !H.nativePane.element.nativeElement.querySelector('.trd-freerdp')`))
    await t.ev('H.inZone(() => RD.desktop.showDesktop(H.nativePane))')
    t.check('FreeRDP reconnects with the remembered certificate/NLA decisions', await settle())
    t.check('reconnect has a new process and fresh pixels', !!await t.waitFor(`return H.session(H.nativePane)?.ui?.native?.child?.pid !== H.nativePid && H.canvas(H.nativePane)?.colors > 2`, 10))
    await t.dump('H.nativePane', 'freerdp-reconnected')
    await t.ev(`
        H.inZone(() => RD.desktop.disconnect(H.nativePane))
        H.nativePane.profile.options.client = 'ironrdp'
        H.inZone(() => RD.desktop.showDesktop(H.nativePane))
    `)
    t.check('the same profile switches back to IronRDP', await settle())
    if (Number.isFinite(settleMs) && settleMs > 0) await t.sleep(Math.min(30000, settleMs))
    t.check('IronRDP uses its own renderer and draws pixels', !!await t.waitFor(`return !!H.overlay(H.nativePane)?.querySelector('iron-remote-desktop') && H.canvas(H.nativePane)?.colors > 2`, 10))
    await t.dump('H.nativePane', 'ironrdp-same-server')
}, { needsHost: false })

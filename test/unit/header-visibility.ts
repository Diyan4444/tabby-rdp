import { test } from 'node:test'
import assert from 'node:assert/strict'
import Module, { createRequire } from 'node:module'
import { FakeElement, installDocument } from './support/dom.js'
const require = createRequire(import.meta.url)
class SplitTab {
    panes: any[] = []
    getAllTabs () { return this.panes }
    getFocusedTab () { return this.panes[0] }
    getMaximizedTab () { return this.panes[0] }
}
const load = (Module as any)._load
;(Module as any)._load = function (name: string, ...args: unknown[]) {
    if (name === '@angular/core') return new Proxy({}, { get: () => () => () => undefined })
    if (['tabby-core', 'tabby-settings', 'tabby-terminal'].includes(name)) return new Proxy({}, { get: (_, k) => k === '__esModule' ? undefined : k === 'SplitTabComponent' ? SplitTab : class {} })
    return load.call(this, name, ...args)
}
const { HeaderVisibility, installHeaderMenu, HEADER_MENU_ID, shouldHideHeader } = require('../../dist/headerVisibility.js')

class Item {
    [key: string]: any
    constructor (options: any) { Object.assign(this, options) }
}
class Menu {
    constructor (readonly items: Item[]) {}
    static buildFromTemplate (items: any[]) { return new Menu(items.map(item => item instanceof Item ? item : new Item(item))) }
}

test('Hide Header preserves the host menu actions, has one entry and can be rebound to the current window', () => {
    const devTools = new Item({ role: 'toggleDevTools' }), fullscreen = new Item({ role: 'togglefullscreen' })
    const edit = new Item({ label: 'Edit', submenu: new Menu([new Item({ role: 'copy' })]) })
    let current = new Menu([edit, new Item({ label: '&View', submenu: new Menu([devTools, fullscreen]) })])
    const remote = { MenuItem: Item, Menu: { ...Menu, buildFromTemplate: Menu.buildFromTemplate, getApplicationMenu: () => current, setApplicationMenu: (menu: Menu) => { current = menu } } }
    let first = 0, second = 0
    installHeaderMenu(remote, 'never', () => first++)
    const item = installHeaderMenu(remote, 'always', () => second++)
    assert.equal(current.items[0], edit)
    const entries = current.items[1].submenu.items
    assert.deepEqual(entries.slice(0, 2), [devTools, fullscreen])
    assert.equal(entries.filter((i: Item) => i.id === HEADER_MENU_ID).length, 1)
    assert.equal(item.label, 'Hide Header')
    assert.deepEqual(item.submenu.items.map((i: Item) => [i.label, i.checked]), [['Automatic', false], ['Never', false], ['Always', true]])
    item.submenu.items[2].click()
    assert.deepEqual([first, second], [0, 1])
    assert.equal(installHeaderMenu({ Menu: { getApplicationMenu: () => null } }, 'never', () => {}), null)
})

function harness (t: any) {
    const page = installDocument(); t.after(page.restore)
    const root: any = new FakeElement('app-root'), bar: any = new FakeElement('div'), title: any = new FakeElement('title-bar')
    bar.className = 'tab-bar'; root.appendChild(title); root.appendChild(bar)
    root.dataset = {}; root.style.setProperty = () => {}
    title.getBoundingClientRect = () => ({ top: 0, bottom: 30, left: 0, right: 1000, width: 1000, height: 30 })
    bar.getBoundingClientRect = () => ({ top: 30, bottom: 68, left: 0, right: 1000, width: 1000, height: 38 })
    const query = root.querySelector.bind(root)
    root.querySelector = (selector: string) => selector === ':scope > title-bar' ? title : query(selector)
    const doc = globalThis.document as any
    doc.querySelector = (selector: string) => selector === 'app-root' ? root : null
    doc.createElement = (tag: string) => Object.assign(new FakeElement(tag), { setAttribute () {} })
    const before = (globalThis as any).window
    ;(globalThis as any).window = { innerWidth: 1000, innerHeight: 800 }
    t.after(() => { (globalThis as any).window = before })
    const settings = { headerAutoHide: 'never', headerMinWidth: 0, headerMinHeight: 0 }, host = { isFullscreen: false }
    const visibility = new HeaderVisibility({ settings: () => settings, singleDesktopVisible: () => false }, { store: { appearance: { tabsLocation: 'top' } } }, {}, host, { headerVisibilityChanged () {} })
    return { visibility, root, bar, title, settings, host, doc }
}

test('windowed header auto-hide is opt-in, reveals at the edge and hides repeatedly without getting stuck', t => {
    t.mock.timers.enable({ apis: ['setTimeout'] })
    const { visibility, root, settings } = harness(t)
    visibility.refresh()
    assert.equal(root.classList.contains('trd-auto-hide-header'), false)
    settings.headerAutoHide = 'always'; visibility.refresh()
    assert.equal(root.classList.contains('trd-auto-hide-header'), true)
    assert.equal(root.dataset.trdHeaderEdge, 'top')
    assert.equal(visibility.bar.inert, true)
    for (let n = 0; n < 3; n++) {
        visibility.pointer({ clientX: 500, clientY: 1 })
        assert.equal(root.classList.contains('trd-header-revealed'), true)
        assert.equal(visibility.bar.inert, false)
        visibility.pointer({ clientX: 500, clientY: 400 })
        t.mock.timers.tick(400)
        assert.equal(root.classList.contains('trd-header-revealed'), false)
        assert.equal(visibility.bar.inert, true)
    }
    visibility.pointer({ clientX: 500, clientY: 1 })
    visibility.pointer({ clientX: 500, clientY: 400 })
    visibility.pointer({ clientX: 500, clientY: 1 }) // Cancelling an old timer must allow the next hide.
    visibility.pointer({ clientX: 500, clientY: 400 }); t.mock.timers.tick(400)
    assert.equal(root.classList.contains('trd-header-revealed'), false)
})

test('header controls retain keyboard focus; disabling or full screen restores the host layout', t => {
    t.mock.timers.enable({ apis: ['setTimeout'] })
    const { visibility, root, bar, title, settings, host, doc } = harness(t)
    settings.headerAutoHide = 'always'; visibility.refresh(); visibility.pointer({ clientX: 500, clientY: 1 })
    const button = new FakeElement('button'); bar.appendChild(button); doc.activeElement = button
    visibility.keyboardFocus = true
    visibility.hideLater(); t.mock.timers.tick(400)
    assert.equal(root.classList.contains('trd-header-revealed'), true)
    visibility.pointer({ clientX: 500, clientY: 400 }); t.mock.timers.tick(400)
    assert.equal(root.classList.contains('trd-header-revealed'), false, 'using the pointer must not retain an old keyboard-focus pin')
    doc.activeElement = doc.body
    visibility.hideLater(); settings.headerAutoHide = 'never'; visibility.refresh(); t.mock.timers.tick(400)
    assert.equal(root.classList.contains('trd-auto-hide-header'), false)
    assert.equal(bar.classList.contains('trd-auto-tabbar'), false)
    assert.equal(title.classList.contains('trd-auto-titlebar'), false)
    settings.headerAutoHide = 'always'; host.isFullscreen = true; visibility.refresh()
    assert.equal(root.classList.contains('trd-auto-hide-header'), false, 'full screen belongs to Tabby')
})

test('Automatic requires a sole RDP desktop and every configured minimum dimension, inclusive of the boundary', () => {
    assert.equal(shouldHideHeader('automatic', false, 1920, 1080), false)
    assert.equal(shouldHideHeader('automatic', true, 800, 600), true)
    assert.equal(shouldHideHeader('automatic', true, 1100, 800, 1100, 800), true)
    assert.equal(shouldHideHeader('automatic', true, 1099, 900, 1100, 800), false)
    assert.equal(shouldHideHeader('automatic', true, 1200, 799, 1100, 800), false)
    assert.equal(shouldHideHeader('automatic', true, 1200, 600, 1100, 0), true)
    assert.equal(shouldHideHeader('always', false, 800, 600, 1920, 1080), true)
    assert.equal(shouldHideHeader('never', true, 1920, 1080), false)
})

test('Automatic excludes consoles, connecting desktops and all splits, including a maximized pane', () => {
    const { RemoteDesktopService } = require('../../dist/desktop.service.js')
    const pane = { profile: { type: 'rdp' }, element: { nativeElement: {} } }
    const app: any = { activeTab: pane, tabs: [pane] }
    let visible = true, connected = true
    const standIn = { app, isVisible: () => visible, isConnected: () => connected, splitOf: RemoteDesktopService.prototype.splitOf }
    const eligible = () => RemoteDesktopService.prototype.singleDesktopVisible.call(standIn)
    assert.equal(eligible(), true)
    visible = false; assert.equal(eligible(), false, 'console is showing')
    visible = true; connected = false; assert.equal(eligible(), false, 'still connecting')
    connected = true
    const split = new SplitTab(); split.panes = [pane, { profile: { type: 'local' } }]
    app.activeTab = split; app.tabs = [split]
    assert.equal(eligible(), false, 'the other pane exists even while this one is maximized')
    split.panes = [pane, { profile: { type: 'rdp' } }]
    assert.equal(eligible(), false, 'two desktops are still a split')
    split.panes = [pane]
    assert.equal(eligible(), true, 'a single-pane tab wrapper is eligible')
    app.activeTab = {}; assert.equal(eligible(), false, 'Settings or a welcome tab is not a desktop')
})

test('header setup waits for the config instead of failing the renderer during startup', () => {
    const visibility = new HeaderVisibility({ settings () { throw new Error('too soon') } }, { store: undefined }, {}, {}, {})
    assert.doesNotThrow(() => visibility.refresh())
})

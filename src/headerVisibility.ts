import { Injectable, NgZone } from '@angular/core'
import { AppService, ConfigService, HostWindowService } from 'tabby-core'
import { RemoteDesktopService } from './desktop.service'
import { HeaderControls } from './header'
import { HeaderAutoHide } from './hostCompat'

export const HEADER_MENU_ID = 'tabby-rdp-hide-header'

/** Rebuild through Electron's supported API, retaining all the host's existing menu items and their roles. */
export function installHeaderMenu (remote: any, mode: HeaderAutoHide, click: (mode: HeaderAutoHide) => void, currentWindow?: any, platform = process.platform): any | null {
    // Tabby removes native menu bars on some Windows/Linux hosts. Never attach one to those windows.
    if (platform !== 'darwin' && (!currentWindow || !currentWindow.isMenuBarVisible() && !currentWindow.isMenuBarAutoHide())) { return null }
    const menu = remote.Menu.getApplicationMenu()
    const view = menu?.items.find((item: any) => item.role?.toLowerCase() === 'viewmenu' || item.label?.replace(/&/g, '') === 'View')
    if (!view?.submenu) { return null }
    const choices = (['automatic', 'never', 'always'] as const).map(value => ({
        id: `${HEADER_MENU_ID}-${value}`, type: 'radio', label: value === 'automatic' ? 'Automatic' : value === 'never' ? 'Never' : 'Always',
        checked: mode === value, click: () => click(value),
    }))
    const choice = new remote.MenuItem({ id: HEADER_MENU_ID, label: 'Hide Header', submenu: remote.Menu.buildFromTemplate(choices) })
    const submenu = remote.Menu.buildFromTemplate([...view.submenu.items.filter((item: any) => item.id !== HEADER_MENU_ID), choice])
    const updated = remote.Menu.buildFromTemplate(menu.items.map((item: any) => item === view
        ? { id: view.id, label: view.label, role: view.role, enabled: view.enabled, visible: view.visible, submenu } : item))
    if (platform === 'darwin') { remote.Menu.setApplicationMenu(updated) } else {
        const visible = currentWindow.isMenuBarVisible(), autoHide = currentWindow.isMenuBarAutoHide()
        currentWindow.setMenu(updated)
        currentWindow.setAutoHideMenuBar(autoHide); currentWindow.setMenuBarVisibility(visible)
    }
    return choice
}

export function shouldHideHeader (mode: HeaderAutoHide, remoteVisible: boolean, width: number, height: number, minWidth = 0, minHeight = 0): boolean {
    return mode === 'always' || mode === 'automatic' && remoteVisible && width >= minWidth && height >= minHeight
}

const STYLE = `
app-root.trd-auto-hide-header { position: relative; }
.trd-auto-hide-header .trd-auto-titlebar { position: absolute !important; top: 0; left: 0; right: 0;
    height: var(--trd-titlebar-height); z-index: 1040; }
.trd-auto-hide-header .trd-auto-tabbar { position: absolute !important; z-index: 1040; }
.trd-auto-hide-header[data-trd-header-edge=top] .trd-auto-tabbar { top: var(--trd-titlebar-height); left: 0; right: 0; width: 100%; }
.trd-auto-hide-header[data-trd-header-edge=bottom] .trd-auto-tabbar { bottom: 0; left: 0; right: 0; width: 100%; }
.trd-auto-hide-header[data-trd-header-edge=left] .trd-auto-tabbar { top: 0; bottom: 0; left: 0; height: 100%; }
.trd-auto-hide-header[data-trd-header-edge=right] .trd-auto-tabbar { top: 0; bottom: 0; right: 0; height: 100%; }
.trd-auto-hide-header:not(.trd-header-revealed) .trd-auto-titlebar,
.trd-auto-hide-header:not(.trd-header-revealed) .trd-auto-tabbar { opacity: 0; visibility: hidden; pointer-events: none; }
.trd-header-edge { position: fixed; top: 0; left: 0; right: 0; height: 3px; z-index: 1039;
    background: none; border: none; padding: 0; -webkit-app-region: no-drag; }
.trd-header-edge:focus-visible { height: 6px; outline: 2px solid var(--bs-primary, #5af); }
`

/** Windowed auto-hide; full screen keeps Tabby's existing behavior. Hover never resizes the desktop. */
@Injectable({ providedIn: 'root' })
export class HeaderVisibility {
    private root: HTMLElement | null = null
    private bar: HTMLElement | null = null
    private title: HTMLElement | null = null
    private edge: HTMLButtonElement | null = null
    private timer?: ReturnType<typeof setTimeout>
    private scheduled = false
    private active = false
    private revealed = false
    private remote: any = null
    private menuMode?: HeaderAutoHide
    private menuRebind = true
    private menuFocused = true
    private menuItem: any = null
    private controlsHidden = false
    private keyboardFocus = false

    constructor (
        private desktop: RemoteDesktopService, private config: ConfigService, private zone: NgZone,
        private host: HostWindowService, private header: HeaderControls,
        private app: AppService,
    ) { }

    install (): void {
        try { this.remote = require('@electron/remote') } catch { }
        this.zone.runOutsideAngular(() => {
            const style = document.createElement('style'); style.textContent = STYLE; document.head.appendChild(style)
            this.desktop.changed$.subscribe(() => this.schedule())
            this.app.activeTabChange$.subscribe(() => this.schedule())
            this.config.changed$.subscribe(() => { this.menuRebind = true; this.schedule() })
            ;(this.config as any).ready$?.subscribe?.(() => this.schedule())
            this.host.windowFocused$.subscribe(() => { this.menuFocused = true; this.menuRebind = true; this.schedule() })
            new MutationObserver(() => this.schedule()).observe(document.body, { childList: true, subtree: true })
            window.addEventListener('resize', () => this.schedule())
            window.addEventListener('mousemove', event => this.pointer(event))
            window.addEventListener('mouseout', event => { if (!event.relatedTarget) { this.pointer(event) } })
            window.addEventListener('keydown', () => { this.keyboardFocus = true })
            window.addEventListener('pointerdown', () => { this.keyboardFocus = false })
            window.addEventListener('blur', () => { this.menuFocused = false; this.keyboardFocus = false; this.hideLater() })
            document.addEventListener('focusin', () => {
                this.schedule()
                if (this.inHeader(document.activeElement)) { this.show() } else { this.hideLater() }
            })
            document.addEventListener('focusout', () => this.hideLater())
            window.addEventListener('beforeunload', () => { if (this.menuItem) { this.menuItem.enabled = false } })
            this.schedule()
        })
    }

    private schedule (): void {
        if (this.scheduled) { return }
        this.scheduled = true
        setTimeout(() => { this.scheduled = false; this.refresh() }, 16)
    }

    private refreshMenu (mode: HeaderAutoHide): void {
        if (!this.menuFocused || !this.menuRebind && mode === this.menuMode) { return }
        // The application menu belongs to the focused window. Rebind after focus so closing another window cannot
        // leave a callback owned by its destroyed renderer. DOM mutations must not cause synchronous menu IPC.
        try {
            const current = this.remote?.getCurrentWindow()
            if (current?.isFocused()) {
                this.menuItem = installHeaderMenu(this.remote, mode, value => this.zone.run(() => {
                    if (this.remote?.getCurrentWindow()?.isFocused()) {
                        this.desktop.updateSettings({ headerAutoHide: value })
                    }
                }), current)
                this.menuMode = mode
                this.menuRebind = false
            } else { this.menuFocused = false }
        } catch {
            // Retry on the next focus/config change, rather than every DOM mutation on an unsupported bridge.
            this.menuMode = mode
            this.menuRebind = false
        }
    }

    private refresh (): void {
        if (!this.config.store) { return } // Windows can render the first frame before Tabby's config is ready.
        const settings = this.desktop.settings()
        this.refreshMenu(settings.headerAutoHide)
        this.root = document.querySelector('app-root')
        const bar = this.root?.querySelector<HTMLElement>('.tab-bar') ?? null
        const title = this.root?.querySelector<HTMLElement>(':scope > title-bar') ?? null
        if (this.bar !== bar) { this.bar?.classList.remove('trd-auto-tabbar'); this.bar = bar }
        if (this.title !== title) { this.title?.classList.remove('trd-auto-titlebar'); this.title = title }
        this.active = !!this.root && !this.host.isFullscreen && shouldHideHeader(settings.headerAutoHide,
            this.desktop.singleDesktopVisible(), window.innerWidth, window.innerHeight, settings.headerMinWidth, settings.headerMinHeight)
        this.root?.classList.toggle('trd-auto-hide-header', this.active)
        if (!this.active) {
            clearTimeout(this.timer); this.timer = undefined
            this.bar?.classList.remove('trd-auto-tabbar'); this.title?.classList.remove('trd-auto-titlebar')
            if (this.bar) { this.bar.inert = false }
            if (this.title) { this.title.inert = false }
            this.root?.classList.remove('trd-header-revealed')
            this.edge?.remove(); this.edge = null; this.revealed = false
            this.nativeControls(false)
            this.header.headerVisibilityChanged()
            return
        }
        this.root!.style.setProperty('--trd-titlebar-height', `${this.title?.getBoundingClientRect().height ?? 0}px`)
        const edge = this.config.store.appearance?.tabsLocation
        this.root!.dataset.trdHeaderEdge = ['left', 'right', 'bottom'].includes(edge) ? edge : 'top'
        this.bar?.classList.add('trd-auto-tabbar'); this.title?.classList.add('trd-auto-titlebar')
        this.headerInput(!this.revealed)
        if (!this.edge) {
            this.edge = document.createElement('button'); this.edge.className = 'trd-header-edge'
            this.edge.setAttribute('aria-label', 'Show Tabby header')
            this.edge.addEventListener('mouseenter', () => this.show())
            this.edge.addEventListener('focus', () => this.show())
            this.edge.addEventListener('click', () => this.show())
            this.root!.appendChild(this.edge)
        }
        this.nativeControls(!this.revealed)
        this.header.headerVisibilityChanged()
    }

    private nativeControls (hide: boolean): void {
        if (process.platform !== 'darwin' || this.controlsHidden === hide || hide && this.config.store.appearance?.frame !== 'thin') { return }
        try { this.remote?.getCurrentWindow()?.setWindowButtonVisibility(!hide); this.controlsHidden = hide } catch { }
    }

    private inHeader (element: Element | null): boolean {
        return !!element && (!!this.bar?.contains(element) || !!this.title?.contains(element) || element === this.edge)
    }

    private headerInput (hidden: boolean): void {
        // A few host tab descendants explicitly restore visibility. Inert also prevents invisible close buttons
        // taking clicks or keyboard focus; the separate edge button and native View menu remain accessible.
        if (this.bar) { this.bar.inert = hidden }
        if (this.title) { this.title.inert = hidden }
    }

    private show (): void {
        if (!this.active) { return }
        clearTimeout(this.timer)
        this.timer = undefined
        this.revealed = true; this.root?.classList.add('trd-header-revealed')
        this.headerInput(false)
        this.nativeControls(false)
        this.header.headerVisibilityChanged()
    }

    private hideLater (): void {
        if (!this.active || this.timer) { return }
        this.timer = setTimeout(() => {
            this.timer = undefined
            if (this.keyboardFocus && this.inHeader(document.activeElement) || document.querySelector('.dropdown-menu.show, .modal.show')) { return }
            this.revealed = false; this.root?.classList.remove('trd-header-revealed')
            this.headerInput(true)
            this.nativeControls(true)
            this.header.headerVisibilityChanged()
        }, 400)
    }

    private pointer (event: MouseEvent): void {
        if (!this.active) { return }
        this.keyboardFocus = false
        const edge = this.root?.dataset.trdHeaderEdge
        const atEdge = event.clientY <= 3 || edge === 'left' && event.clientX <= 3 ||
            edge === 'right' && event.clientX >= window.innerWidth - 3 || edge === 'bottom' && event.clientY >= window.innerHeight - 3
        const contains = (element: HTMLElement | null) => {
            const r = element?.getBoundingClientRect()
            return !!r && event.clientX >= r.left && event.clientX < r.right && event.clientY >= r.top && event.clientY < r.bottom
        }
        if (atEdge || this.revealed && (contains(this.bar) || contains(this.title))) { this.show() } else { this.hideLater() }
    }
}

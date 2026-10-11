// Fixed public identities. Addresses, credentials and CDP tunnels belong only to operator configuration.
export const clients = [
    { id: 'macos', name: 'macOS', platform: 'darwin' },
    { id: 'windows', name: 'Windows', platform: 'win32' },
    { id: 'linux', name: 'Linux', platform: 'linux' },
]
export const desktops = [
    { id: 'ubuntu2404', name: 'Ubuntu 24.04 / GNOME 46', os: 'ubuntu', version: '24.04', gnome: '46' },
    { id: 'fedora44', name: 'Fedora 44 / GNOME 50', os: 'fedora', version: '44', gnome: '50' },
    { id: 'debian13', name: 'Debian 13.7 / GNOME 48', os: 'debian', version: '13', point: '13.7', gnome: '48' },
    { id: 'rocky9', name: 'Rocky Linux 9 / Xfce / xrdp', os: 'rocky', version: '9.8', stack: 'xrdp' },
    { id: 'fedora44-kde', name: 'Fedora 44 / KDE Plasma / KRDP (QA encoder + FreeRDP fixes)', os: 'fedora', version: '44', stack: 'krdp' },
    { id: 'windows11', name: 'Windows 11 26H2', os: 'windows', version: '26H2', build: '26300' },
]
export const linuxRequired = ['TRD_TEST_HOST']
export const windowsRequired = ['TRD_TEST_WIN_SSH_HOST', 'TRD_TEST_WIN_ADDRESS', 'TRD_TEST_WIN_USER', 'TRD_TEST_WIN_PASSWORD', 'TRD_TEST_WIN_WINRM']
export const matrix = clients.flatMap(client => [
    { id: `visual-${client.id}-host`, name: `${client.name} Tabby settings`, environment: `${client.name} client → local UI`, client: client.platform, suite: 'visual-host', required: [], coverage: 'Actual native Tabby settings UI' },
    ...desktops.map(desktop => ({ id: `visual-${client.id}-${desktop.id}`, name: `${client.name} → ${desktop.name}`, environment: `${client.name} client → ${desktop.name}`, client: client.platform, desktop,
        suite: desktop.os === 'windows' ? 'visual-windows' : 'visual-linux', required: desktop.os === 'windows' ? windowsRequired : [...linuxRequired, ...(desktop.stack === 'xrdp' ? ['TRD_TEST_XRDP_USER', 'TRD_TEST_XRDP_PASSWORD'] : []), ...(desktop.stack === 'krdp' ? ['TRD_TEST_KRDP_USER', 'TRD_TEST_KRDP_PASSWORD'] : [])],
        coverage: desktop.stack === 'krdp' ? 'H.264 with private encoder and FreeRDP compatibility fixes: framebuffer, input, tab return, client fit and reconnect; fixed monitor, remote resize unsupported' : 'Real RDP framebuffer, geometry, input, resize, tab return and reconnect' })),
])
export function validateTargets (value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Expected QA target object')
    for (const [id, env] of Object.entries(value)) {
        if (!matrix.some(item => item.id === id)) throw new Error(`Unknown QA target: ${id}`)
        if (!env || typeof env !== 'object' || Array.isArray(env)) throw new Error(`Invalid QA target: ${id}`)
        for (const [key, setting] of Object.entries(env)) {
            if (!/^TRD_TEST_[A-Z_]+$/.test(key) || typeof setting !== 'string') throw new Error(`Invalid QA setting for ${id}`)
            if (key.startsWith('TRD_TEST_EXPECT_')) throw new Error('Expected identities are controlled by the catalog')
        }
        if (env.TRD_TEST_CLIENT_CDP_PORT && !/^[1-9]\d{0,4}$/.test(env.TRD_TEST_CLIENT_CDP_PORT)) throw new Error('Invalid client CDP port')
        if (Number(env.TRD_TEST_CLIENT_CDP_PORT) > 65535) throw new Error('Invalid client CDP port')
    }
    return value
}
export function targetEnvironment (entry, base, targets = {}) {
    if (!entry.client) return base // Existing Phase 1/2 commands retain their environment.
    // No inherited destination: a missing target must never accidentally exercise another cell.
    const env = Object.fromEntries(Object.entries(base).filter(([key]) => !key.startsWith('TRD_TEST_')))
    return { ...env, ...targets[entry.id], TRD_TEST_EXPECT_CLIENT: entry.client,
        TRD_TEST_EXPECT_OS: entry.desktop?.os || '', TRD_TEST_EXPECT_VERSION: entry.desktop?.version || '',
        TRD_TEST_EXPECT_POINT: entry.desktop?.point || '', TRD_TEST_EXPECT_BUILD: entry.desktop?.build || '', TRD_TEST_EXPECT_GNOME: entry.desktop?.gnome || '', TRD_TEST_EXPECT_STACK: entry.desktop?.stack || '' }
}
export function missingSettings (entry, base, targets = {}) {
    if (entry.client && !Object.hasOwn(targets, entry.id)) return ['Dedicated target configuration']
    const env = targetEnvironment(entry, base, targets)
    return [...entry.required.filter(key => !env[key]), ...(entry.client && entry.client !== process.platform && !env.TRD_TEST_CLIENT_CDP_PORT ? ['TRD_TEST_CLIENT_CDP_PORT'] : [])]
}

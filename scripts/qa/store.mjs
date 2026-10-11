import fs from 'node:fs'
import path from 'node:path'
import { matrix, missingSettings } from './matrix.mjs'

export const catalog = [
    { id: 'visual-host', name: 'Remote Desktop settings', environment: 'Local Tabby', coverage: 'Actual plugin UI; no RDP session', required: [] },
    { id: 'visual-linux', name: 'Ubuntu GNOME desktop', environment: 'Ubuntu GNOME', coverage: 'Real RDP framebuffer, geometry, input, resize, tab return and reconnect', required: ['TRD_TEST_HOST'] },
    { id: 'visual-windows', name: 'Windows 11 desktop', environment: 'Windows 11', coverage: 'Real RDP framebuffer, geometry, input, resize, tab return and reconnect', required: ['TRD_TEST_WIN_SSH_HOST', 'TRD_TEST_WIN_ADDRESS', 'TRD_TEST_WIN_USER', 'TRD_TEST_WIN_PASSWORD', 'TRD_TEST_WIN_WINRM'] },
]
catalog.push(...matrix)
export function availableCatalog (env, targets = {}) {
    return catalog.map(({ required, ...item }) => { const missing = missingSettings({ ...item, required }, env, targets); return { ...item, configured: !missing.length, missing } })
}
export const terminalStates = ['passed', 'failed', 'skipped', 'infrastructure-failed', 'cancelled']
export function writeJSON (file, value) {
    fs.writeFileSync(file + '.tmp', JSON.stringify(value, null, 2))
    fs.renameSync(file + '.tmp', file)
}
export function readJSON (file) { return JSON.parse(fs.readFileSync(file, 'utf8')) }

// Exit zero alone never means a test passed. Require the expected test and its visual evidence.
export function classify (code, report, directory) {
    if (!report || report.errors?.length || !Array.isArray(report.tests) || report.tests.length !== 1) return 'infrastructure-failed'
    if (report.tests.every(t => t.status === 'skipped')) return code === 0 ? 'skipped' : 'infrastructure-failed'
    if (report.tests.some(t => ['failed', 'timedOut'].includes(t.status))) return 'failed'
    if (report.tests.some(t => t.status !== 'passed')) return 'infrastructure-failed'
    const evidence = report.tests.every(t => ['actual', 'trace'].every(name => t.attachments?.some(a => {
        const file = path.resolve(directory, a.path)
        return a.name === name && file.startsWith(directory + path.sep) && fs.existsSync(file) && fs.statSync(file).size > 0
    })))
    return code === 0 && report.status === 'passed' && evidence ? 'passed' : 'infrastructure-failed'
}

export function loadRuns (directory) {
    return fs.readdirSync(directory).filter(n => /^[\dT.Z-]+-[a-f0-9]{8}$/.test(n)).map(n => {
        try { return readJSON(path.join(directory, n, 'run.json')) } catch { return null }
    }).filter(Boolean).sort((a, b) => b.startedAt.localeCompare(a.startedAt))
}

export function recoverRuns (directory) {
    for (const run of loadRuns(directory)) {
        if (!terminalStates.includes(run.status)) {
            run.status = 'infrastructure-failed'
            run.reason = 'Dashboard stopped before completion; result is unverified. Run again.'
            run.finishedAt = new Date().toISOString()
            writeJSON(path.join(directory, run.id, 'run.json'), run)
        }
    }
}

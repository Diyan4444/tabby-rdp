import { test } from 'node:test'
import assert from 'node:assert/strict'
import { matrix, targetEnvironment, missingSettings, validateTargets } from './matrix.mjs'
import { availableCatalog } from './store.mjs'

test('every native client has its own UI and five explicitly versioned desktop targets', () => {
    assert.equal(matrix.length, 18)
    assert.equal(new Set(matrix.map(e => e.id)).size, 18)
    for (const client of ['darwin', 'win32', 'linux']) {
        const targets = matrix.filter(e => e.client === client)
        assert.deepEqual(targets.filter(e => e.desktop).map(e => e.desktop.gnome || e.desktop.stack || e.desktop.os), ['46', '50', '48', 'xrdp', 'windows'])
        assert.equal(targets.find(e => e.desktop?.os === 'debian').desktop.point, '13.7')
        assert.ok(targets.find(e => e.desktop?.stack === 'xrdp').required.includes('TRD_TEST_XRDP_PASSWORD'))
    }
})
test('an unconfigured cell never inherits another target or reports itself configured', () => {
    const entry = matrix.find(e => e.id === 'visual-windows-fedora44')
    const base = { TRD_TEST_HOST: 'wrong-host', TRD_TEST_WIN_PASSWORD: 'private', PATH: '/bin' }
    assert.ok(missingSettings(entry, base).length)
    const targets = validateTargets({ [entry.id]: { TRD_TEST_HOST: 'dedicated-host', TRD_TEST_CLIENT_CDP_PORT: '9336' } })
    const env = targetEnvironment(entry, base, targets)
    assert.equal(env.TRD_TEST_HOST, 'dedicated-host')
    assert.equal(env.TRD_TEST_WIN_PASSWORD, undefined)
    assert.equal(env.TRD_TEST_EXPECT_CLIENT, 'win32')
    assert.equal(env.TRD_TEST_EXPECT_GNOME, '50')
    assert.equal(env.PATH, '/bin')
    assert.deepEqual(missingSettings(entry, base, targets), [])
    const visible = JSON.stringify(availableCatalog(base, targets))
    for (const secret of ['wrong-host', 'dedicated-host', 'private']) assert.ok(!visible.includes(secret))
})
test('operator configuration rejects unknown cells, identity overrides and non-port CDP arguments', () => {
    for (const value of [null, [], { unknown: {} }, { 'visual-linux-host': { COMMAND: 'shell' } },
        { 'visual-linux-host': { TRD_TEST_EXPECT_CLIENT: 'darwin' } },
        { 'visual-linux-host': { TRD_TEST_CLIENT_CDP_PORT: '9335 --update' } },
        { 'visual-linux-host': { TRD_TEST_CLIENT_CDP_PORT: '99999' } }]) {
        assert.throws(() => validateTargets(value))
    }
})

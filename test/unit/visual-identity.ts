import { test } from 'node:test'
import assert from 'node:assert/strict'
import { verifyLinuxIdentity } from '../visual/identity.js'

test('visual QA rejects a neighboring Debian point release and the wrong GNOME/GRD major', () => {
    const settings = { TRD_TEST_EXPECT_OS: 'debian', TRD_TEST_EXPECT_VERSION: '13', TRD_TEST_EXPECT_POINT: '13.7', TRD_TEST_EXPECT_GNOME: '48' }
    const previous = Object.fromEntries(Object.keys(settings).map(k => [k, process.env[k]]))
    Object.assign(process.env, settings)
    const actual = { os: 'debian', version: '13', point: '13.7', gnome: 'GNOME Shell 48.7', grd: '48.1-4' }
    try {
        assert.doesNotThrow(() => verifyLinuxIdentity(actual))
        for (const wrong of [{ point: '13.6' }, { os: 'ubuntu' }, { gnome: 'GNOME Shell 46.0' }, { grd: '50.2' }]) {
            assert.throws(() => verifyLinuxIdentity({ ...actual, ...wrong }))
        }
    } finally {
        for (const [key, value] of Object.entries(previous)) { if (value === undefined) delete process.env[key]; else process.env[key] = value }
    }
})

test('Rocky visual QA requires Xfce, xorgxrdp and an xrdp version with live resize', () => {
    const keys = ['TRD_TEST_EXPECT_OS', 'TRD_TEST_EXPECT_VERSION', 'TRD_TEST_EXPECT_POINT', 'TRD_TEST_EXPECT_GNOME', 'TRD_TEST_EXPECT_STACK']
    const previous = Object.fromEntries(keys.map(k => [k, process.env[k]]))
    Object.assign(process.env, { TRD_TEST_EXPECT_OS: 'rocky', TRD_TEST_EXPECT_VERSION: '9.8', TRD_TEST_EXPECT_POINT: '', TRD_TEST_EXPECT_GNOME: '', TRD_TEST_EXPECT_STACK: 'xrdp' })
    const actual = { os: 'rocky', version: '9.8', point: '', xfce: '4.18.3', xrdp: '0.10.6.1', xorgxrdp: '0.10.5' }
    try {
        assert.doesNotThrow(() => verifyLinuxIdentity(actual))
        for (const wrong of [{ xrdp: '0.9.27' }, { xfce: undefined }, { xorgxrdp: undefined }, { os: 'fedora' }]) {
            assert.throws(() => verifyLinuxIdentity({ ...actual, ...wrong }))
        }
    } finally {
        for (const [key, value] of Object.entries(previous)) { if (value === undefined) delete process.env[key]; else process.env[key] = value }
    }
})

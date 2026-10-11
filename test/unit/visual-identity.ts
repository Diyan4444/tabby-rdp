import { test } from 'node:test'
import assert from 'node:assert/strict'
import { verifyLinuxIdentity, kdeEncoderPatch, kdeFreerdpPatch } from '../visual/identity.js'

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

test('KDE qualification requires Plasma, KWin, KRDP and PipeWire, not Fedora GNOME', () => {
    const keys = ['TRD_TEST_EXPECT_OS', 'TRD_TEST_EXPECT_VERSION', 'TRD_TEST_EXPECT_POINT', 'TRD_TEST_EXPECT_GNOME', 'TRD_TEST_EXPECT_STACK']
    const previous = Object.fromEntries(keys.map(k => [k, process.env[k]]))
    Object.assign(process.env, { TRD_TEST_EXPECT_OS: 'fedora', TRD_TEST_EXPECT_VERSION: '44', TRD_TEST_EXPECT_POINT: '', TRD_TEST_EXPECT_GNOME: '', TRD_TEST_EXPECT_STACK: 'krdp' })
    const actual = { os: 'fedora', version: '44', point: '', plasma: '6.7.5', kwin: '6.7.5', krdp: '6.7.5', pipewire: '1.6.9', session: 'wayland', freerdp: '3.32.1', loadedFreerdp: '3.32.1', server: { sourceCommit: '270dcf01851229134f74fa7d90ac338ec788ec67', patchSha256: kdeFreerdpPatch, librarySha256: 'c'.repeat(64), loadedLibrarySha256: 'c'.repeat(64) }, encoder: { sourceCommit: '6318082fe449b50e701abc4d91308c2371cf8741', patchSha256: kdeEncoderPatch, librarySha256: 'a'.repeat(64), loadedLibrarySha256: 'a'.repeat(64) } }
    try {
        assert.doesNotThrow(() => verifyLinuxIdentity(actual))
        for (const wrong of [{ plasma: undefined, gnome: 'GNOME Shell 50.5' }, { kwin: undefined }, { krdp: '6.6.4' }, { pipewire: undefined }, { session: 'x11' }, { freerdp: '3.24.2' }, { loadedFreerdp: undefined }, { loadedFreerdp: '3.24.2' }, { server: undefined }, { server: { ...actual.server, sourceCommit: '0'.repeat(40) } }, { server: { ...actual.server, patchSha256: 'b'.repeat(64) } }, { server: { ...actual.server, loadedLibrarySha256: 'b'.repeat(64) } }, { encoder: undefined }, { encoder: { ...actual.encoder, patchSha256: 'b'.repeat(64) } }, { encoder: { ...actual.encoder, loadedLibrarySha256: 'b'.repeat(64) } }]) {
            assert.throws(() => verifyLinuxIdentity({ ...actual, ...wrong }))
        }
    } finally {
        for (const [key, value] of Object.entries(previous)) { if (value === undefined) delete process.env[key]; else process.env[key] = value }
    }
})

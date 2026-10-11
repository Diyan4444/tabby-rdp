// Host versions explain bug reports; capability probes must still follow forks, themes and optional host APIs.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import type { HostSources } from '../../src/hostCompat.js'

const require = createRequire(import.meta.url)
const { HostCompatibility, createHostCompatibility } = require('../../dist/hostCompat.js') as typeof import('../../src/hostCompat.js')
const fork: HostSources = {
    name: () => 'Example Terminal Preview', version: () => '1.0.238-beta.1', platform: 'darwin', electron: '43.7.0', node: '22.0.0',
    terminalPackage: () => ({ devDependencies: { '@xterm/xterm': '^5' } }),
}

test('host identity preserves prereleases and forks without assuming their terminal version', () => {
    const compat = new HostCompatibility(fork)
    assert.deepEqual(compat.info, {
        name: 'Example Terminal Preview', version: '1.0.238-beta.1', platform: 'darwin', electron: '43.7.0', node: '22.0.0',
        xtermDeclaration: '^5', xtermMajor: 5,
    })
    assert.equal(Object.isFrozen(compat.info), true)
    assert.deepEqual(compat.snapshot().capabilities, { terminalInput: null })
})

test('missing host APIs and unreadable package metadata leave independent information available', () => {
    const missing = () => { throw new Error('optional host API is unavailable') }
    const compat = new HostCompatibility({ ...fork, name: missing, terminalPackage: missing })
    assert.equal(compat.info.name, null)
    assert.equal(compat.info.xtermDeclaration, null)
    assert.equal(compat.info.xtermMajor, null)
    assert.equal(compat.info.version, '1.0.238-beta.1')
    assert.equal(compat.info.electron, '43.7.0')
    assert.equal(new HostCompatibility({ version: missing }).info.version, null)
    assert.equal(createHostCompatibility({ getAppVersion: () => 'fork-build-17' }).info.version, 'fork-build-17')
    const broken = new HostCompatibility({ ...fork, terminalPackage: () => ({ get dependencies () { throw new Error('metadata read failed') } }) })
    assert.equal(broken.info.xtermDeclaration, null)
    assert.equal(broken.info.version, '1.0.238-beta.1')
})

test('only a declaration restricted to one xterm major establishes that major', () => {
    for (const [declaration, expected] of [
        ['^5', 5], ['~5.5.0', 5], ['6.0.0', 6], ['^6.1.0-beta.304', 6], ['6.x', 6],
        ['^5 || ^6', null], ['>=5', null], ['*', null], ['workspace:*', null], ['https://example.invalid/xterm-6.tgz', null],
    ] as const) {
        const compat = new HostCompatibility({ ...fork, terminalPackage: () => ({ dependencies: { '@xterm/xterm': declaration } }) })
        assert.equal(compat.info.xtermMajor, expected, declaration)
        assert.equal(compat.info.xtermDeclaration, declaration)
    }
})

test('terminal input availability is scoped to the pane supplied, and is unknown without a pane', () => {
    const compat = new HostCompatibility(fork)
    const pane = (inputs: unknown[]) => ({ querySelectorAll: (selector: string) => {
        assert.equal(selector, 'textarea.xterm-helper-textarea')
        return inputs
    } }) as unknown as ParentNode
    assert.equal(compat.snapshot(pane([{}])).capabilities.terminalInput, true)
    assert.equal(compat.snapshot(pane([])).capabilities.terminalInput, false)
    assert.equal(compat.snapshot().capabilities.terminalInput, null)
})

test('diagnostics label declared versions and unobserved capabilities, with metadata kept on single lines', () => {
    const compat = new HostCompatibility({ ...fork, name: () => 'Example Terminal\nPreview', version: () => '1.0.238\r\npreview' })
    const lines = compat.diagnosticLines()
    assert.match(lines[0], /^Host: Example Terminal Preview 1\.0\.238  preview on darwin$/)
    assert.equal(lines[2], 'Terminal: xterm ^5 (host declaration)')
    assert.equal(lines[3], 'Compatibility: terminal input unobserved')
    assert.ok(lines.every(line => !/[\r\n]/.test(line)))
    assert.deepEqual(new HostCompatibility({}).diagnosticLines(), [
        'Host: unknown unknown on unknown', 'Runtime: Electron unknown, Node unknown',
        'Terminal: xterm unknown (host declaration)', 'Compatibility: terminal input unobserved',
    ])
})

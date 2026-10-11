import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { classify, writeJSON, loadRuns, recoverRuns } from './store.mjs'

test('a successful exit requires an executed passing test, screenshot and trace', t => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'trd-qa-test-'))
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
    const report = { status: 'passed', errors: [], tests: [{ status: 'passed', attachments: [{ name: 'actual', path: 'actual.png' }, { name: 'trace', path: 'trace.zip' }] }] }
    assert.equal(classify(0, null, dir), 'infrastructure-failed')
    assert.equal(classify(0, { ...report, tests: [] }, dir), 'infrastructure-failed')
    assert.equal(classify(0, report, dir), 'infrastructure-failed')
    fs.writeFileSync(path.join(dir, 'actual.png'), 'evidence')
    fs.writeFileSync(path.join(dir, 'trace.zip'), 'evidence')
    assert.equal(classify(0, report, dir), 'passed')
    assert.equal(classify(1, report, dir), 'infrastructure-failed')
    assert.equal(classify(0, { ...report, errors: ['global setup failed'] }, dir), 'infrastructure-failed')
    assert.equal(classify(0, { ...report, tests: [{ status: 'skipped' }] }, dir), 'skipped')
    assert.equal(classify(1, { ...report, tests: [{ status: 'failed' }] }, dir), 'failed')
    assert.equal(classify(1, { ...report, tests: [{ status: 'timedOut' }] }, dir), 'failed')
    assert.equal(classify(1, { ...report, tests: [{ status: 'interrupted' }] }, dir), 'infrastructure-failed')
})
test('restarting retains completed evidence and marks unfinished runs as infrastructure failures', t => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'trd-qa-test-'))
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
    for (const [index, status] of ['running', 'passed'].entries()) {
        const id = `2026-10-10T00-00-0${index}.000Z-abcdef01`
        fs.mkdirSync(path.join(dir, id))
        writeJSON(path.join(dir, id, 'run.json'), { id, status, startedAt: id })
    }
    recoverRuns(dir)
    assert.deepEqual(loadRuns(dir).map(r => r.status), ['passed', 'infrastructure-failed'])
    assert.match(loadRuns(dir)[1].reason, /unverified/)
})

test('environment configuration is reported without exposing credentials', async () => {
    const { availableCatalog } = await import('./store.mjs')
    const empty = availableCatalog({})
    assert.deepEqual(empty.map(e => [e.id, e.configured]), [['visual-host', true], ['visual-linux', false], ['visual-windows', false]])
    const configured = availableCatalog({ TRD_TEST_HOST: 'test-host', TRD_TEST_WIN_SSH_HOST: 'test-host', TRD_TEST_WIN_ADDRESS: 'guest:3389', TRD_TEST_WIN_USER: 'test', TRD_TEST_WIN_PASSWORD: 'secret-value', TRD_TEST_WIN_WINRM: 'guest:5985' })
    assert.ok(configured.every(e => e.configured))
    assert.ok(!JSON.stringify(configured).includes('secret-value'))
    assert.equal(classify(1, { tests: [{ status: 'infrastructure-failed' }] }, '/tmp'), 'infrastructure-failed')
})

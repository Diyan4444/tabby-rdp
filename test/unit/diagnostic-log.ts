// The diagnostic log file: what is washed out of a line, where and how the file is written. Real files in a temporary
// folder; no server input.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
const require = createRequire(import.meta.url)
const { DiagnosticLog, diagnosticLevel, logDirectory, logFileName, washed, MAX_LINE } = require('../../dist/diagnosticLog.js')

test('a list of bytes, a long hex string and the token are replaced with their length; the rest stays', () => {
    assert.equal(washed('premaster: [171, 171, 171, 171, 171, 171, 171, 171] mac: [1, 2]'), 'premaster: <8 bytes withheld> mac: [1, 2]')
    assert.equal(washed('key [ 0, 255,12 ,3, 4, 5, 6, 7, 8, ]'), 'key <9 bytes withheld>')
    assert.equal(washed('sha256 ' + 'ab'.repeat(32) + ' id 0123456789abcdef'), 'sha256 <64 hex digits withheld> id 0123456789abcdef')
    assert.equal(washed('connect wss://127.0.0.1:1234/deadbeef failed', 'deadbeef'), 'connect wss://127.0.0.1:1234/<token withheld> failed')
    const kept = 'DEBUG ironrdp_connector::license_exchange: Received message=ServerUpgradeLicense { license_header: LicenseHeader { preamble_message_type: UpgradeLicense, preamble_message_size: 1156 }, encrypted_license_info: <1134 bytes withheld>, mac_data: <16 bytes withheld> }'
    assert.equal(washed(kept), kept)
})

test('the level and the folder', () => {
    assert.equal(diagnosticLevel('debug'), 'debug')
    assert.equal(diagnosticLevel('trace'), 'trace')
    assert.equal(diagnosticLevel('TRACE'), 'off')
    assert.equal(diagnosticLevel(undefined), 'off')
    assert.equal(logDirectory('/home/me/.config/tabby/config.yaml'), path.join('/home/me/.config/tabby', 'tabby-rdp-logs'))
    assert.equal(logDirectory(null), path.join(os.homedir(), '.tabby-rdp-logs'))
    assert.equal(logFileName('Work: PC/1', new Date('2026-10-14T16:51:00.123Z')), 'tabby-rdp_2026-10-14_16-51-00_Work_PC_1.log')
    assert.equal(logFileName('///', new Date('2026-10-14T16:51:00Z')), 'tabby-rdp_2026-10-14_16-51-00_desktop.log')
})

test('the file is written for the user alone, stamped, washed, cut, and closed', async () => {
    const dir = path.join(await fs.promises.mkdtemp(path.join(os.tmpdir(), 'trd-diag-')), 'logs')
    const log = new DiagnosticLog(dir, 'desk', 'debug', () => 'tok3n', ['tabby-rdp 0.0.0 on test'])
    log.line('plugin', 'connecting to host/tok3n')
    log.line('ironrdp', 'DEBUG x: random: [1, 2, 3, 4, 5, 6, 7, 8, 9]')
    log.line('ironrdp', 'y'.repeat(MAX_LINE + 10))
    await log.close()
    log.line('plugin', 'after close')
    await log.close()
    assert.equal(log.failure, null)
    assert.equal(fs.statSync(dir).mode & 0o777, 0o700)
    assert.equal(fs.statSync(log.file).mode & 0o777, 0o600)
    const lines = fs.readFileSync(log.file, 'utf8').trimEnd().split('\n')
    const stamp = /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z /
    assert.ok(lines.every(line => stamp.test(line)), lines.join('\n'))
    const texts = lines.map(line => line.replace(stamp, ''))
    assert.equal(texts[0], 'log tabby-rdp diagnostic log, level debug: desk')
    assert.equal(texts[1], 'log tabby-rdp 0.0.0 on test')
    assert.match(texts[2], /^log Keys, passwords, licenses/)
    assert.equal(texts[3], 'plugin connecting to host/<token withheld>')
    assert.equal(texts[4], 'ironrdp DEBUG x: random: <9 bytes withheld>')
    assert.equal(texts[5], `ironrdp ${'y'.repeat(MAX_LINE)}… (10 characters more)`)
    assert.equal(texts.length, 6)
})

test('a folder that cannot be made is a failure, not an exception', async () => {
    const file = path.join(await fs.promises.mkdtemp(path.join(os.tmpdir(), 'trd-diag-')), 'not-a-folder')
    fs.writeFileSync(file, '')
    const log = new DiagnosticLog(path.join(file, 'logs'), 'desk', 'trace')
    log.line('plugin', 'x')
    await log.close()
    assert.ok(log.failure)
})

import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { CodexReviewer, codexArguments, codexEnvironment, parseCodexEvents } from './ai-codex.mjs'

test('Codex review uses subscription auth, isolated inputs and no inherited test/API credentials', () => {
    const env = codexEnvironment({ HOME: '/home/user', PATH: '/bin', CODEX_HOME: '/private/codex', OPENAI_API_KEY: 'secret', CODEX_API_KEY: 'secret', TRD_TEST_WIN_PASSWORD: 'secret', CODEX_THREAD_ID: 'other-thread' })
    assert.deepEqual(env, { PATH: '/bin', HOME: '/home/user', CODEX_HOME: '/private/codex' })
    const args = codexArguments('/tmp/opaque', [{ role: 'observed', id: 'crop', truth: 'fail' }])
    assert.ok(args.includes('--ignore-user-config')); assert.ok(args.includes('--ephemeral')); assert.ok(args.includes('read-only'))
    for (const setting of ['forced_login_method="chatgpt"', 'features.shell_tool=false', 'features.apps=false', 'features.plugins=false', 'features.multi_agent=false', 'features.hooks=false', 'features.code_mode_host=false', 'memories.use_memories=false', 'project_doc_max_bytes=0']) assert.ok(args.includes(setting))
    assert.equal(args.includes('/tmp/opaque/observed.png'), true)
    assert.equal(args.join(' ').includes('crop'), false)
})

test('Codex event parser accepts known isolation notices and rejects tools, turn failures and unknown errors', () => {
    const complete = { type: 'turn.completed', usage: { input_tokens: 20, output_tokens: 5 } }
    const parse = events => parseCodexEvents(events.map(JSON.stringify).join('\n'))
    assert.deepEqual(parse([{ type: 'item.completed', item: { type: 'agent_message' } }, complete]), complete.usage)
    for (const message of ['Code Mode is unavailable because code-mode host is disabled.', 'Exceeded skills context budget. All skill descriptions were removed']) {
        assert.deepEqual(parse([{ type: 'item.completed', item: { type: 'error', message } }, complete]), complete.usage)
    }
    for (const type of ['command_execution', 'file_change', 'mcp_tool_call', 'web_search']) assert.throws(() => parse([{ type: 'item.completed', item: { type } }, complete]))
    assert.throws(() => parse([{ type: 'turn.failed' }, complete]))
    assert.throws(() => parse([{ type: 'item.completed', item: { type: 'error', message: 'Unknown tool or error' } }, complete]))
    assert.throws(() => parse([{ type: 'turn.completed', usage: { input_tokens: -1, output_tokens: 1 } }]))
})

test('Codex cancellation terminates its owned process and records a bounded attempt, not a successful review', async t => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'trd-codex-contract-'))
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
    const binary = path.join(dir, 'cli')
    fs.writeFileSync(binary, '#!/usr/bin/env node\nif(process.argv.includes("--version")){console.log("codex-cli 0.0.0")}else if(process.argv.includes("login")){console.log("Logged in using ChatGPT")}else{process.stdin.resume();setInterval(()=>{},1000)}', { mode: 0o700 })
    const reviewer = new CodexReviewer(path.join(dir, 'data'), { codexBinary: binary, maxRequests: 1 })
    assert.equal(reviewer.status().configured, true)
    const png = Buffer.alloc(24); Buffer.from('89504e470d0a1a0a', 'hex').copy(png); png.writeUInt32BE(800, 16); png.writeUInt32BE(600, 20)
    const evidence = { images: [{ role: 'observed', bytes: png }] }, controller = new AbortController()
    const pending = reviewer.evaluate(evidence, controller.signal)
    setTimeout(() => controller.abort(), 100)
    await assert.rejects(pending, /AI review cancelled/)
    assert.equal(reviewer.status().requests, 1); assert.equal(reviewer.status().tokens, 0)
    assert.equal(reviewer.busy, false)
    await assert.rejects(reviewer.evaluate(evidence), /request limit reached/)
})

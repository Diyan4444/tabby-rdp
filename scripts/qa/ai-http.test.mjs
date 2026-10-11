// Contract evidence only: isolated synthetic cached response, with all network spending disabled.
// These tests must never be cited as model-quality or real-provider acceptance.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import net from 'node:net'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { fileURLToPath } from 'node:url'
import { detector, requestFor, sha } from './ai.mjs'
import { writeJSON } from './store.mjs'

test('HTTP cached review persists advisory findings, metrics and history without changing source results', { timeout: 20_000 }, async t => {
    const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'trd-ai-http-'))
    const socket = net.createServer().listen(0, '127.0.0.1'); await once(socket, 'listening')
    const port = socket.address().port; await new Promise(r => socket.close(r))
    const id = '2026-10-11T00-00-00.000Z-00000001', runDir = path.join(dir, 'runs', id)
    fs.mkdirSync(runDir, { recursive: true }); fs.mkdirSync(path.join(dir, 'ai/cache'), { recursive: true })
    const png = Buffer.alloc(24); Buffer.from('89504e470d0a1a0a', 'hex').copy(png); png.writeUInt32BE(800, 16); png.writeUInt32BE(600, 20)
    fs.writeFileSync(path.join(runDir, 'sample.png'), png)
    const run = { id, test: 'visual-host', status: 'passed', stage: 'finished', startedAt: '2026-10-11T00:00:00Z', commit: 'contract-fixture',
        tests: [{ title: 'Contract fixture only', status: 'passed', attachments: ['actual', 'expected'].map(name => ({ name, path: 'sample.png', contentType: 'image/png' })) }] }
    writeJSON(path.join(runDir, 'run.json'), run)
    const request = requestFor({ images: [{ role: 'reference', bytes: png }, { role: 'observed', bytes: png }], sequence: null })
    const key = sha(JSON.stringify({ version: detector.version, request }))
    writeJSON(path.join(dir, 'ai/cache', key + '.json'), { verdict: 'anomaly', confidence: 0.7, findings: [{ category: 'clipping', severity: 'low', confidence: 0.7, image: 'observed', region: null, explanation: 'Synthetic contract finding' }],
        observations: 'Synthetic contract response', hypotheses: '', limitations: 'Not real provider evidence', detector, estimatedUSD: 0, latencyMs: 1, cached: false })
    // An exhausted budget ensures even an accidental cache miss cannot contact the provider.
    writeJSON(path.join(dir, 'ai/ledger.json'), { estimatedUSD: 0.30, requests: 0, unresolved: [] })
    const child = spawn(process.execPath, ['scripts/qa/server.mjs'], { cwd: root, env: { ...process.env, TRD_QA_DATA: dir, TRD_QA_PORT: String(port),
        TRD_QA_AI_PROVIDER: 'responses', TRD_QA_ENV_FILE: '', TRD_QA_TARGETS_FILE: '', OPENAI_API_KEY: 'contract-only', TRD_QA_OPENAI_KEY_FILE: '', TRD_QA_AI_BUDGET_USD: '0.30' }, stdio: ['ignore', 'pipe', 'pipe'] })
    t.after(async () => { if (child.exitCode === null && child.signalCode === null) { const done = once(child, 'exit'); child.kill('SIGTERM'); await done }; fs.rmSync(dir, { recursive: true, force: true }) })
    await once(child.stdout, 'data')
    const token = fs.readFileSync(path.join(dir, 'token'), 'utf8').trim()
    const base = `http://127.0.0.1:${port}`
    const call = (route, body) => fetch(base + route, { method: body ? 'POST' : 'GET', headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) })
    const created = await call('/api/ai/reviews', { runId: id }); assert.equal(created.status, 202)
    let state
    for (let i = 0; i < 100; i++) { state = await (await call('/api/runs')).json(); if (!state.ai.active) break; await new Promise(r => setTimeout(r, 10)) }
    assert.equal(state.ai.requests, 0)
    const result = state.runs[0]
    assert.equal(result.status, 'passed'); assert.equal(result.ai.status, 'completed'); assert.equal(result.ai.advisory, true)
    assert.equal(result.ai.cases[0].review.cached, true)
    assert.equal(result.ai.metrics.falsePositives, 1); assert.equal(result.ai.metrics.controls, 1)
    assert.equal(result.aiHistory.length, 1)
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(runDir, 'run.json'))), run)
    assert.equal((await call(`/runs/${id}/ai-reviews/${result.ai.id}.json`)).status, 200)
    assert.equal((await fetch(base + `/runs/${id}/ai-review.json`)).status, 401)
    // A second review reuses the cache while preserving its predecessor.
    assert.equal((await call('/api/ai/reviews', { runId: id })).status, 202)
    state = await (await call('/api/runs')).json()
    assert.equal(state.runs[0].aiHistory.length, 2); assert.equal(state.ai.requests, 0)
})

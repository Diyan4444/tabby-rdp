import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import net from 'node:net'
import http from 'node:http'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { fileURLToPath } from 'node:url'
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')

test('HTTP authentication, fixed catalog, single execution, cancellation, artifacts and restart', { timeout: 30_000 }, async t => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'trd-qa-http-'))
    const socket = net.createServer().listen(0, '127.0.0.1')
    await once(socket, 'listening')
    const port = socket.address().port
    await new Promise(r => socket.close(r))
    let child
    const start = async (environment = {}) => {
        child = spawn(process.execPath, ['scripts/qa/server.mjs'], { cwd: root, env: { ...process.env, TRD_QA_PORT: String(port), TRD_QA_DATA: dir, ...environment }, stdio: ['ignore', 'pipe', 'pipe'] })
        await once(child.stdout, 'data')
    }
    const stop = async () => { const done = once(child, 'exit'); child.kill('SIGTERM'); await done }
    t.after(async () => { if (child?.exitCode === null && child?.signalCode === null) await stop(); fs.rmSync(dir, { recursive: true, force: true }) })
    await start()
    const base = `http://127.0.0.1:${port}`
    const token = fs.readFileSync(path.join(dir, 'token'), 'utf8')
    const request = (url, body, auth = true, extra = {}) => fetch(base + url, { method: body === undefined ? 'GET' : 'POST', headers: { ...(auth ? { Authorization: `Bearer ${token}` } : {}), 'Content-Type': 'application/json', ...extra }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) })
    assert.equal((await request('/api/runs', undefined, false)).status, 401)
    assert.equal((await request('/api/runs', { test: 'visual-host' }, false)).status, 401)
    assert.equal((await request('/api/runs', { test: 'visual-host' }, true, { Origin: 'https://example.com' })).status, 403)
    const invalidHost = await new Promise(resolve => {
        http.get(base + '/api/runs', { headers: { Host: 'example.com' } }, response => { response.resume(); resolve(response.statusCode) })
    })
    assert.equal(invalidHost, 403)
    assert.equal((await request('/api/runs', { test: 'visual-host', command: 'ignored' })).status, 400)
    assert.equal((await request('/api/runs', { test: 'unknown' })).status, 400)
    assert.equal((await request('/api/campaigns', {test:'visual-linux',mutations:[{id:'crop',value:20}]},false)).status,401)
    assert.equal((await request('/api/campaigns', {test:'visual-linux',mutations:[{id:'crop',value:20}]},true,{Origin:'https://example.com'})).status,403)
    assert.equal((await request('/api/campaigns', {test:'visual-host',mutations:[{id:'crop',value:20}]})).status,400)
    assert.equal((await request('/api/campaigns', {test:'visual-linux',mutations:[{id:'crop',value:999}]})).status,400)
    const login = await request('/api/login', { token }, false)
    assert.equal(login.status, 200)
    assert.match(login.headers.get('set-cookie'), /HttpOnly; SameSite=Strict/)
    const created = await request('/api/runs', { test: 'visual-host' })
    assert.equal(created.status, 202)
    const run = await created.json()
    assert.equal((await request('/api/runs', { test: 'visual-host' })).status, 409)
    assert.equal((await request('/api/campaigns', {test:'visual-linux',mutations:[{id:'crop',value:20}]})).status,409)
    assert.equal((await request('/api/cancel', {})).status, 202)
    let state
    for (let i = 0; i < 100; i++) {
        state = await (await request('/api/runs')).json()
        if (!state.active) break
        await new Promise(r => setTimeout(r, 50))
    }
    assert.equal(state.runs[0].status, 'cancelled')
    assert.equal(state.runs[0].tests[0].status, 'not-run')
    fs.writeFileSync(path.join(dir, 'runs', run.id, 'sample.png'), 'evidence')
    assert.equal((await request(`/runs/${run.id}/sample.png`, undefined, false)).status, 401)
    assert.equal((await request(`/runs/${run.id}/sample.png`)).status, 200)
    fs.symlinkSync(path.join(dir, 'token'), path.join(dir, 'runs', run.id, 'escape'))
    assert.equal((await request(`/runs/${run.id}/escape`)).status, 404)
    await stop(); await start()
    const restored = await (await request('/api/runs')).json()
    assert.equal(restored.runs[0].id, run.id)
    assert.equal(restored.runs[0].status, 'cancelled')
    assert.equal((await request(`/runs/${run.id}/sample.png`)).status, 200)
    // Node is an existing executable but cannot launch Tabby: verify an actual launcher failure, not a fixture result.
    await stop(); await start({ TABBY_BIN: process.execPath })
    assert.equal((await request('/api/runs', { test: 'visual-host' })).status, 202)
    for (let i = 0; i < 200; i++) {
        state = await (await request('/api/runs')).json()
        if (!state.active) break
        await new Promise(r => setTimeout(r, 50))
    }
    assert.equal(state.runs[0].status, 'infrastructure-failed')
    assert.equal(state.runs[0].tests[0].status, 'not-run')
    const log = await (await request(`/runs/${state.runs[0].id}/execution.log`)).text()
    assert.match(log, /Tabby exited before DevTools/)
    await stop(); await start({ TRD_TEST_HOST: '' })
    const missing = await (await request('/api/runs', { test: 'visual-linux' })).json()
    const snapshot = await (await request('/api/runs')).json()
    const unavailable = snapshot.runs.find(r => r.id === missing.id)
    assert.equal(unavailable.test, 'visual-linux')
    assert.equal(unavailable.status, 'infrastructure-failed')
    assert.equal(unavailable.tests[0].status, 'not-run')
    assert.match(unavailable.reason, /TRD_TEST_HOST/)
    assert.equal(fs.existsSync(path.join(dir, 'runs', missing.id, 'results.json')), false)
    const campaignRun = await (await request('/api/campaigns', {test:'visual-linux',mutations:[{id:'crop',value:20}]})).json()
    const campaignState = (await (await request('/api/runs')).json()).runs.find(r=>r.id===campaignRun.id)
    assert.equal(campaignState.status,'infrastructure-failed')
    assert.equal(campaignState.experiments[0].classification,'not-executed')
    assert.equal(campaignState.effectiveness.manifested,0)
    assert.equal(campaignState.effectiveness.excluded,1)
    assert.equal(campaignState.effectiveness.detectionRate,null)


})

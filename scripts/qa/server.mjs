import { mutations, validateCampaign, effectiveness } from './mutations.mjs'
import { targetEnvironment, missingSettings, validateTargets } from './matrix.mjs'
import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import crypto from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { spawn, execFileSync } from 'node:child_process'
import { catalog, availableCatalog, writeJSON, readJSON, classify, loadRuns, recoverRuns } from './store.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const data = path.resolve(process.env.TRD_QA_DATA || path.join(root, '.qa'))
const runsDir = path.join(data, 'runs')
// Operator-owned configuration, never accepted from an HTTP request or copied into results.
const envFile = process.env.TRD_QA_ENV_FILE
if (envFile) {
    const settings = readJSON(path.resolve(envFile))
    for (const [key, value] of Object.entries(settings)) {
        if (!/^TRD_TEST_[A-Z_]+$/.test(key) || typeof value !== 'string') throw new Error('Invalid QA environment setting')
        process.env[key] = value
    }
}
const targets = process.env.TRD_QA_TARGETS_FILE ? validateTargets(readJSON(path.resolve(process.env.TRD_QA_TARGETS_FILE))) : {}
const port = Number(process.env.TRD_QA_PORT || 4317)
fs.mkdirSync(runsDir, { recursive: true, mode: 0o700 })
const lock = path.join(data, 'server.pid')
if (fs.existsSync(lock)) {
    const pid = Number(fs.readFileSync(lock, 'utf8'))
    let alive = false
    try { process.kill(pid, 0); alive = true } catch (e) { if (e.code !== 'ESRCH') throw e }
    if (alive) throw new Error('Another dashboard owns this data directory')
    fs.unlinkSync(lock)
}
fs.writeFileSync(lock, String(process.pid), { flag: 'wx', mode: 0o600 })
process.on('exit', () => { try { fs.unlinkSync(lock) } catch {} })
const tokenFile = path.join(data, 'token')
if (!fs.existsSync(tokenFile)) fs.writeFileSync(tokenFile, crypto.randomBytes(32).toString('hex'), { mode: 0o600, flag: 'wx' })
const token = fs.readFileSync(tokenFile, 'utf8').trim()
if (token.length < 32) throw new Error('Dashboard token must be at least 32 characters')
const sessions = new Map()
let loginAttempts = []
let active = null
let stopping = false
recoverRuns(runsDir)

function equal (a, b) {
    return typeof a === 'string' && Buffer.byteLength(a) === Buffer.byteLength(b) && crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b))
}
function authorized (req) {
    if (equal(req.headers.authorization, `Bearer ${token}`)) return true
    const session = /(?:^|; )trd_qa=([a-f0-9]+)/.exec(req.headers.cookie || '')?.[1]
    return sessions.get(session) > Date.now()
}
function json (res, code, value) {
    res.writeHead(code, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify(value))
}
async function body (req) {
    if (req.headers['content-type'] !== 'application/json') throw new Error('Use application/json')
    let value = ''
    for await (const chunk of req) {
        value += chunk
        if (value.length > 4096) throw new Error('Request too large')
    }
    return JSON.parse(value)
}
function save (run) { writeJSON(path.join(runsDir, run.id, 'run.json'), run) }
function git (...args) { return execFileSync('git', args, { cwd: root, encoding: 'utf8', timeout: 5000 }).trim() }
function signalChild (child, signal) {
    if (!child?.pid) return
    try { process.kill(-child.pid, signal) } catch { try { child.kill(signal) } catch {} }
}
function command (run, args) {
    return new Promise(resolve => {
        // No caller-provided executable, arguments, environment or shell. Baseline updates are always disabled.
        const child = spawn(process.execPath, args, { cwd: root, detached: process.platform !== 'win32', env: {
            ...targetEnvironment(catalog.find(item => item.id === run.test), process.env, targets), TRD_QA_RUN_DIR: path.join(runsDir, run.id), TRD_QA_UPDATE_BASELINES: '0',
            TRD_QA_PARENT_PID: String(process.pid), PLAYWRIGHT_HTML_OPEN: 'never',
            TRD_QA_MUTATIONS: run.mutations ? JSON.stringify(run.mutations) : '',
        }, stdio: ['ignore', 'pipe', 'pipe'] })
        active.child = child
        let bytes = 0
        const log = fs.createWriteStream(path.join(runsDir, run.id, 'execution.log'), { flags: 'a' })
        for (const stream of [child.stdout, child.stderr]) stream.on('data', chunk => {
            if (bytes < 2_000_000) log.write(chunk.subarray(0, 2_000_000 - bytes))
            bytes += chunk.length
        })
        child.on('error', error => { log.write(String(error)); log.end(); resolve(2) })
        child.on('close', code => { log.end(); resolve(code ?? 2) })
    })
}
async function execute (run) {
    const timeout = setTimeout(() => {
        if (active?.run === run) { active.timedOut = true; stopActive() }
    }, run.mutations ? 960_000 : (catalog.find(item => item.id === run.test).suite || run.test) === 'visual-host' ? 180_000 : 300_000)
    try {
        const entry = catalog.find(item => item.id === run.test)
        const missing = missingSettings(entry, process.env, targets)
        if (missing.length) {
            const reason = 'Environment not configured: ' + missing.join(', ')
            fs.writeFileSync(path.join(runsDir, run.id, 'execution.log'), reason + '\n')
            throw new Error(reason)
        }
        const build = await command(run, [path.join(root, 'node_modules/typescript/bin/tsc'), '-p', 'tsconfig.json'])
        if (build !== 0 || active.cancelled || active.timedOut) {
            run.reason = 'Build failed or execution interrupted; visual test did not execute.'
            run.status = 'infrastructure-failed'
        } else {
            run.stage = 'testing'; save(run)
            const env = targetEnvironment(entry, process.env, targets)
            const code = await command(run, ['--import', 'tsx', 'test/run.ts', '--hidden', ...(env.TRD_TEST_CLIENT_CDP_PORT ? ['--port', env.TRD_TEST_CLIENT_CDP_PORT] : []), entry.suite || run.test])
            let report
            try { report = readJSON(path.join(runsDir, run.id, 'results.json')) } catch {}
            run.status = classify(code, report, path.join(runsDir, run.id))
            run.tests = report?.tests || run.tests
            run.runnerErrors = report?.errors || []
            run.exitCode = code
            if (run.status === 'infrastructure-failed') run.reason = 'Runner failed or required results/evidence are missing. See execution log.'
        }
    } catch (error) {
        run.status = 'infrastructure-failed'; run.reason = String(error)
    } finally {
        clearTimeout(timeout)
        if (active.cancelled) run.status = 'cancelled'
        if (active.timedOut) { run.status = 'infrastructure-failed'; run.reason = 'Execution exceeded the environment time limit.' }
        run.finishedAt = new Date().toISOString()
        run.durationMs = Date.now() - Date.parse(run.startedAt)
        run.stage = 'finished'
        if (run.mutations) {
            try {
                const result = readJSON(path.join(runsDir, run.id, 'mutation-results.json'))
                run.experiments = result.trials
                // Interrupted/failed infrastructure cannot contribute to effectiveness metrics.
                if (['cancelled','infrastructure-failed'].includes(run.status)) run.experiments = run.experiments.map(t=>({...t, complete:false, classification:'incomplete'}))
            } catch { run.experiments = [] }
            for (const mutation of run.mutations) {
                if (!run.experiments.some(t=>t.id===mutation.id)) run.experiments.push({...mutation, control:false, complete:false, restored:false, detectors:[], classification:'not-executed'})
            }
            run.effectiveness = effectiveness(run.experiments)
            if (run.status === 'passed' && (run.effectiveness.manifested !== run.mutations.length || run.effectiveness.controls !== 2)) {
                run.status = 'infrastructure-failed'; run.reason = 'Campaign evidence incomplete'
            }
        }
        save(run)
        active = null
    }
}
function stopActive () {
    const child = active?.child
    signalChild(child, 'SIGTERM')
    const force = setTimeout(() => { if (child?.exitCode === null && child?.signalCode === null) signalChild(child, 'SIGKILL') }, 5000)
    force.unref()
}
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml', '.json': 'application/json', '.zip': 'application/zip', '.log': 'text/plain', '.woff2': 'font/woff2' }
function serve (res, base, relative) {
    try {
        const realBase = fs.realpathSync(base)
        const file = fs.realpathSync(path.resolve(base, relative))
        if (!file.startsWith(realBase + path.sep) || !fs.statSync(file).isFile()) return json(res, 404, { error: 'Not found' })
        res.writeHead(200, { 'Content-Type': types[path.extname(file)] || 'application/octet-stream' })
        fs.createReadStream(file).pipe(res)
    } catch { json(res, 404, { error: 'Not found' }) }
}
const server = http.createServer(async (req, res) => {
    res.setHeader('Cache-Control', 'no-store')
    res.setHeader('X-Content-Type-Options', 'nosniff')
    res.setHeader('Referrer-Policy', 'no-referrer')
    res.setHeader('X-Frame-Options', 'SAMEORIGIN')
    // Loopback + Host validation also reject DNS rebinding. Access the central host using an SSH tunnel.
    if (!/^(localhost|127\.0\.0\.1):\d+$/.test(req.headers.host || '')) return json(res, 403, { error: 'Invalid host' })
    if (!['GET', 'POST'].includes(req.method)) return json(res, 405, { error: 'Method not allowed' })
    if (req.method === 'POST' && req.headers.origin && req.headers.origin !== `http://${req.headers.host}`) return json(res, 403, { error: 'Invalid origin' })
    try {
        const url = new URL(req.url, 'http://localhost')
        if (req.method === 'GET' && ['/', '/app.js', '/style.css'].includes(url.pathname)) return serve(res, path.join(root, 'scripts/qa/public'), url.pathname === '/' ? 'index.html' : url.pathname.slice(1))
        if (req.method === 'POST' && url.pathname === '/api/login') {
            loginAttempts = loginAttempts.filter(t => t > Date.now() - 60_000)
            if (loginAttempts.length >= 10) return json(res, 429, { error: 'Try again in one minute' })
            loginAttempts.push(Date.now())
            const input = await body(req)
            if (!equal(input.token, token)) return json(res, 401, { error: 'Invalid token' })
            for (const [id, expires] of sessions) if (expires < Date.now()) sessions.delete(id)
            const session = crypto.randomBytes(32).toString('hex')
            sessions.set(session, Date.now() + 8 * 3600_000)
            res.setHeader('Set-Cookie', `trd_qa=${session}; HttpOnly; SameSite=Strict; Path=/; Max-Age=28800`)
            return json(res, 200, { ok: true })
        }
        if (!authorized(req)) return json(res, 401, { error: 'Sign in to view results and execute tests' })
        if (req.method === 'GET' && url.pathname === '/api/runs') {
            const runs = loadRuns(runsDir)
            const completedTrials = runs.filter(r=>r.stage==='finished').flatMap(r=>r.experiments || [])
            if (active?.run.mutations) {
                const current = runs.find(r=>r.id===active.run.id)
                try { current.experiments = readJSON(path.join(runsDir, current.id, 'mutation-results.json')).trials } catch {}
            }
            return json(res, 200, { catalog: availableCatalog(process.env, targets), mutations, runs, active: active?.run.id || null,
                effectiveness: effectiveness(completedTrials),
                trends: runs.filter(r=>r.mutations).map(r=>({ id:r.id, commit:r.commit, startedAt:r.startedAt, status:r.status, effectiveness:r.effectiveness || null })) })
        }
        if (req.method === 'POST' && ['/api/runs', '/api/campaigns'].includes(url.pathname)) {
            const input = await body(req)
            const campaign = url.pathname === '/api/campaigns'
            const requestedMutations = campaign ? validateCampaign(input, catalog.find(item=>item.id===input.test)) : null
            if (!campaign && (Object.keys(input).length !== 1 || !catalog.some(item => item.id === input.test))) return json(res, 400, { error: 'Select an available test' })
            if (active || stopping) return json(res, 409, { error: 'A run is already active or the server is stopping' })
            // A bounded, explicit capacity avoids silently deleting failure evidence in this first phase.
            if (loadRuns(runsDir).length >= 100) return json(res, 409, { error: '100-run capacity reached; archive old run directories before continuing' })
            const entry = catalog.find(item => item.id === input.test)
            const id = new Date().toISOString().replaceAll(':', '-') + '-' + crypto.randomBytes(4).toString('hex')
            const run = { id, test: input.test, ...(requestedMutations ? { mutations: requestedMutations } : {}), status: 'running', stage: 'building', startedAt: new Date().toISOString(),
                commit: git('rev-parse', 'HEAD'), dirty: !!git('status', '--porcelain'),
                platform: `${os.platform()}-${os.arch()}`, node: process.version,
                clientPlatform: entry.client || null, server: entry.desktop || null, environment: entry.environment, coverage: entry.coverage, tests: [{ title: entry.name, status: 'not-run', attachments: [] }],
            }
            fs.mkdirSync(path.join(runsDir, id), { mode: 0o700 })
            save(run); active = { run, child: null, cancelled: false, timedOut: false }
            active.promise = execute(run)
            return json(res, 202, run)
        }
        if (req.method === 'POST' && url.pathname === '/api/cancel') {
            await body(req)
            if (!active) return json(res, 409, { error: 'No active run' })
            active.cancelled = true; stopActive()
            return json(res, 202, { ok: true })
        }
        if (req.method === 'GET' && url.pathname.startsWith('/runs/')) return serve(res, runsDir, decodeURIComponent(url.pathname.slice(6)))
        return json(res, 404, { error: 'Not found' })
    } catch (error) { json(res, 400, { error: error instanceof SyntaxError ? 'Invalid JSON' : String(error.message) }) }
})
server.requestTimeout = 10_000
server.listen(port, '127.0.0.1', () => console.log(`QA dashboard: http://127.0.0.1:${port}\nSign-in token file: ${tokenFile}`))
for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, async () => {
    if (stopping) return
    stopping = true
    server.close()
    if (active) { active.cancelled = true; stopActive(); await active.promise }
    process.exit(0)
})

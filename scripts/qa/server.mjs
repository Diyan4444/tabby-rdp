import { Automation, validateAutomation } from './automation.mjs'
import { history, baselineDigest, retain } from './history.mjs'
import { githubContext, hostedContext } from './github.mjs'
import { investigate } from './investigation.mjs'
import { mutations, validateCampaign, effectiveness } from './mutations.mjs'
import { VisualReviewer, configuration, detector } from './ai.mjs'
import { CodexReviewer } from './ai-codex.mjs'
import { reviewCases, loadEvidence, evidenceReceipt, aiMetrics } from './ai-evidence.mjs'
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
const aiConfig = configuration()
const reviewer = aiConfig.provider === 'codex' ? new CodexReviewer(path.join(data, 'ai-codex'), aiConfig) : new VisualReviewer(path.join(data, 'ai'), aiConfig)
let aiActive = null
const automationConfig = validateAutomation(process.env.TRD_QA_AUTOMATION_FILE ? readJSON(path.resolve(process.env.TRD_QA_AUTOMATION_FILE)) : {})
let retentionState = null
let githubState = null
let githubBusy = false
let lastGithubCheck = 0
const aiFile = id => path.join(runsDir, id, 'ai-review.json')
for (const run of loadRuns(runsDir)) {
    try {
        const file=path.join(runsDir,run.id,'investigation.json'), record=readJSON(file)
        if(record.status==='running'){record.status='interrupted';record.reason='Service stopped during investigation; no automatic retry';writeJSON(file,record)}
    } catch {}
    try {
        const review = readJSON(aiFile(run.id))
        if (review.status === 'running') {
            review.status = 'interrupted'; review.reason = 'Dashboard stopped during AI review; unresolved request cost remains reserved.'
            review.finishedAt = new Date().toISOString()
            writeJSON(aiFile(run.id), review)
            writeJSON(path.join(runsDir, run.id, 'ai-reviews', review.id + '.json'), review)
        }
    } catch {}
}
async function executeReview(run, review, controller) {
    const directory = path.join(runsDir, run.id)
    const persist = () => {
        review.metrics = aiMetrics(review.cases)
        writeJSON(aiFile(run.id), review)
        writeJSON(path.join(directory, 'ai-reviews', review.id + '.json'), review)
    }
    try {
        persist()
        for (const item of review.cases) {
            if (item.excluded) continue
            if (controller.signal.aborted) throw new Error('AI review cancelled')
            try {
                const evidence = loadEvidence(item, directory)
                item.evidence = evidenceReceipt(evidence)
                item.review = await reviewer.evaluate(evidence, controller.signal)
                item.status = 'completed'
            } catch (error) {
                item.status = 'failed'; item.reason = error.message
                // Stop on first provider/evidence failure: no silent retries or partial success.
                throw error
            } finally { persist() }
        }
        review.status = 'completed'
    } catch (error) {
        review.status = controller.signal.aborted ? 'cancelled' : 'infrastructure-failed'
        review.reason = error.message
    } finally {
        review.finishedAt = new Date().toISOString(); persist(); aiActive = null
    }
}

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
        const childEnvironment = { ...targetEnvironment(catalog.find(item => item.id === run.test), process.env, targets) }
        // AI credentials belong only to the dashboard process, never Tabby/test subprocesses.
        delete childEnvironment.OPENAI_API_KEY
        delete childEnvironment.CODEX_API_KEY
        delete childEnvironment.TRD_QA_OPENAI_KEY_FILE
        // No caller-provided executable, arguments, environment or shell. Baseline updates are always disabled.
        const child = spawn(process.execPath, args, { cwd: root, detached: process.platform !== 'win32', env: {
            ...childEnvironment, TRD_QA_RUN_DIR: path.join(runsDir, run.id), TRD_QA_UPDATE_BASELINES: '0',
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
        if (run.automation && (git('rev-parse','HEAD') !== run.commit || git('status','--porcelain'))) {
            run.status='infrastructure-failed';run.reason='Checkout changed during execution; source attribution is unverified.'
        }
        save(run)
        try {
            if (run.automaticAI && run.status === 'passed') {
                const review = startReview(run)
                await aiActive.promise
                run.automaticAIStatus = review.status
            }
            if (['failed','infrastructure-failed'].includes(run.status) && !stopping) {
                const controller = new AbortController()
                aiActive = { runId: run.id, controller }
                aiActive.promise = investigate(run, path.join(runsDir,run.id), loadRuns(runsDir), reviewer, controller.signal)
                const investigation = await aiActive.promise
                run.investigationStatus = investigation.status
                aiActive = null
            }
        } catch { run.automaticAIStatus = 'infrastructure-failed'; aiActive = null }
        save(run)
        active = null
        maintenance()
    }
}
function stopActive () {
    const child = active?.child
    signalChild(child, 'SIGTERM')
    const force = setTimeout(() => { if (child?.exitCode === null && child?.signalCode === null) signalChild(child, 'SIGKILL') }, 5000)
    force.unref()
}
function startReview(run) {
    const cases = reviewCases(run, path.join(runsDir, run.id))
    if (!cases.some(c => !c.excluded)) throw new Error('No eligible screenshot evidence')
    const folder = path.join(runsDir, run.id, 'ai-reviews')
    fs.mkdirSync(folder, { recursive: true, mode: 0o700 })
    if (fs.readdirSync(folder).length >= 20) throw new Error('20-review capacity reached')
    const review = { id: crypto.randomUUID(), runId: run.id, status: 'running', startedAt: new Date().toISOString(),
        detector: reviewer.detector || detector, advisory: true, sourceCommit: run.commit, evaluatorCommit: git('rev-parse','HEAD'), evaluatorDirty: !!git('status','--porcelain'), sourceStatus: run.status, cases }
    const controller = new AbortController()
    aiActive = { runId: run.id, controller }
    aiActive.promise = executeReview(run,review,controller)
    return review
}
function maintenance() {
    retentionState = retain(runsDir,path.join(data,'automation'),automationConfig.retention,
        [active?.run.id,aiActive?.runId,...automation.state.jobs.filter(j=>j.status==='running').flatMap(j=>j.steps.map(s=>s.runId))].filter(Boolean))
    return retentionState
}
function startRun(test, requestedMutations, job = null, automaticAI = false, onCreated = () => {}) {
    if (!maintenance().capacityAvailable) throw new Error('Evidence capacity reached; protected evidence requires operator archive')
    const entry = catalog.find(item => item.id === test)
    const id = new Date().toISOString().replaceAll(':', '-') + '-' + crypto.randomBytes(4).toString('hex')
    const commit = git('rev-parse','HEAD')
    const run = { id, test, ...(requestedMutations ? { mutations: requestedMutations } : {}), status: 'running', stage: 'building', startedAt: new Date().toISOString(),
        commit, dirty: !!git('status','--porcelain'), baselineDigest: baselineDigest(root),
        github: githubState?.commit === commit ? githubState : {status:'not-queried',commit},
        automation: job ? {jobId:job.id,profile:job.profile,trigger:job.trigger} : null, automaticAI,
        platform: `${os.platform()}-${os.arch()}`, node: process.version, clientPlatform: entry.client || null, server: entry.desktop || null,
        environment: entry.environment, coverage: entry.coverage, tests: [{title:entry.name,status:'not-run',attachments:[]}] }
    fs.mkdirSync(path.join(runsDir,id),{mode:0o700});save(run)
    active = {run,child:null,cancelled:false,timedOut:false}
    onCreated(id)
    active.promise = execute(run)
    return run
}
const automation = new Automation(path.join(data,'automation'),automationConfig,{
    busy: () => !!active || !!aiActive || stopping,
    source: () => ({commit:git('rev-parse','HEAD'),dirty:!!git('status','--porcelain')}),
    run: async (step,job,onCreated) => {
        const selection = step.mutations ? validateCampaign({test:step.test,mutations:step.mutations},catalog.find(c=>c.id===step.test)) : null
        const run = startRun(step.test,selection,job,step.ai,onCreated)
        await active.promise
        return run
    },
    cancel: () => { if(active){active.cancelled=true;stopActive()} if(aiActive)aiActive.controller.abort() },
})
async function tick() {
    if (stopping) return
    try {
        if (automationConfig.github && !githubBusy && Date.now()-lastGithubCheck>300_000 && !active && !aiActive && !automation.busy) {
            githubBusy=true;lastGithubCheck=Date.now()
            try {
                const commit=git('rev-parse','HEAD')
                githubState=await githubContext(commit)
                githubState.hosted=await hostedContext(commit)
                writeJSON(path.join(data,'automation','github.json'),githubState)
                const ci=githubState.ci.find(c=>c.status==='completed' && c.conclusion==='success' && ['push','pull_request'].includes(c.event))
                if(ci && !automation.state.paused && !active && !aiActive && !automation.busy && !git('status','--porcelain') && git('rev-parse','HEAD')===commit && automation.state.lastCI !== ci.id) {
                    automation.state.lastCI=ci.id;automation.save()
                    automation.start(ci.event==='push' && ci.branch==='main'?'matrix':'smoke',{kind:'github',ciId:ci.id,url:ci.url},commit)
                }
            }finally{githubBusy=false}
        }
        await automation.tick()
    }catch(error){automation.state.error=error.message;automation.save()}
}
const scheduler = setInterval(tick,5000)
scheduler.unref()
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
            for (const run of runs) {
                if(githubState?.commit===run.commit)run.github=githubState
                try { run.ai = readJSON(aiFile(run.id)) } catch {}
                try { run.investigation = readJSON(path.join(runsDir,run.id,'investigation.json')) } catch {}
                try {
                    run.aiHistory = fs.readdirSync(path.join(runsDir, run.id, 'ai-reviews')).filter(f => /^[a-f0-9-]+\.json$/.test(f)).map(f => {
                        const r = readJSON(path.join(runsDir, run.id, 'ai-reviews', f))
                        return { id: r.id, status: r.status, startedAt: r.startedAt, detector: r.detector, metrics: r.metrics }
                    }).sort((a, b) => b.startedAt.localeCompare(a.startedAt))
                } catch {}
            }
            const completedTrials = runs.filter(r=>r.stage==='finished').flatMap(r=>r.experiments || [])
            if (active?.run.mutations) {
                const current = runs.find(r=>r.id===active.run.id)
                try { current.experiments = readJSON(path.join(runsDir, current.id, 'mutation-results.json')).trials } catch {}
            }
            return json(res, 200, { source: {commit:git('rev-parse','HEAD'),dirty:!!git('status','--porcelain')}, automation: automation.snapshot(), history: history(runs), retention: retentionState, github: githubState, catalog: availableCatalog(process.env, targets), mutations, runs, active: active?.run.id || null,
                ai: { ...reviewer.status(), active: aiActive?.runId || null,
                    metrics: aiMetrics(runs.flatMap(r => r.ai?.cases || [])) },
                effectiveness: effectiveness(completedTrials),
                trends: runs.filter(r=>r.mutations).map(r=>({ id:r.id, commit:r.commit, startedAt:r.startedAt, status:r.status, effectiveness:r.effectiveness || null })) })
        }
        if (req.method === 'POST' && url.pathname === '/api/automation/start') {
            const input = await body(req)
            if (!input || Object.keys(input).some(k=>!['profile','commit'].includes(k)) || !/^[a-f0-9]{40}$/.test(input.commit || '')) return json(res,400,{error:'Select a profile and exact commit'})
            if (active || aiActive || automation.busy || stopping) return json(res,409,{error:'Work already active'})
            return json(res,202,automation.start(input.profile,{kind:'manual'},input.commit))
        }
        if (req.method === 'POST' && url.pathname === '/api/automation/pause') {
            const input=await body(req)
            if(Object.keys(input).join(',')!=='paused' || typeof input.paused!=='boolean') return json(res,400,{error:'Supply paused boolean'})
            automation.pause(input.paused);return json(res,200,automation.snapshot())
        }
        if (req.method === 'POST' && url.pathname === '/api/automation/cancel') {
            await body(req);automation.cancel();return json(res,202,{ok:true})
        }
        if (req.method === 'POST' && url.pathname === '/api/investigations') {
            const input=await body(req)
            if (!input || Object.keys(input).join(',')!=='runId') return json(res,400,{error:'Select a run'})
            const run=loadRuns(runsDir).find(r=>r.id===input.runId)
            if(!run || run.stage!=='finished' || run.mutations) return json(res,400,{error:'Select a finished ordinary run'})
            if(active || aiActive || automation.busy || stopping) return json(res,409,{error:'Work already active'})
            const controller=new AbortController();aiActive={runId:run.id,controller}
            aiActive.promise=investigate(run,path.join(runsDir,run.id),loadRuns(runsDir),reviewer,controller.signal).finally(()=>{aiActive=null})
            return json(res,202,{ok:true})
        }
        if (req.method === 'POST' && url.pathname === '/api/ai/reviews') {
            const input = await body(req)
            if (!input || Object.keys(input).join(',') !== 'runId' || typeof input.runId !== 'string') return json(res, 400, { error: 'Select an existing run' })
            const run = loadRuns(runsDir).find(r => r.id === input.runId)
            if (!run || run.stage !== 'finished') return json(res, 400, { error: 'Select a finished run' })
            if (active || aiActive || automation.busy || stopping) return json(res, 409, { error: 'A test or AI review is already active' })
            if (!reviewer.status().configured) return json(res, 409, { error: aiConfig.provider === 'codex' ? 'Codex ChatGPT sign-in required; run codex login locally and restart the dashboard' : 'OpenAI API key not configured; set a private key file and restart the dashboard' })
            const review = startReview(run)
            return json(res, 202, review)
        }
        if (req.method === 'POST' && url.pathname === '/api/ai/cancel') {
            await body(req)
            if (!aiActive) return json(res, 409, { error: 'No active AI review' })
            aiActive.controller.abort()
            return json(res, 202, { ok: true })
        }
        if (req.method === 'POST' && ['/api/runs', '/api/campaigns'].includes(url.pathname)) {
            const input = await body(req)
            const campaign = url.pathname === '/api/campaigns'
            const requestedMutations = campaign ? validateCampaign(input, catalog.find(item=>item.id===input.test)) : null
            if (!campaign && (Object.keys(input).length !== 1 || !catalog.some(item => item.id === input.test))) return json(res, 400, { error: 'Select an available test' })
            if (active || aiActive || automation.busy || stopping) return json(res, 409, { error: 'A test or AI review is already active or the server is stopping' })
            const run = startRun(input.test, requestedMutations)
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
    clearInterval(scheduler)
    automation.cancel()
    server.close()
    if (aiActive) { const job = aiActive; job.controller.abort(); await job.promise }
    if (active) { active.cancelled = true; stopActive(); await active.promise }
    if (automation.promise) await automation.promise
    process.exit(0)
})

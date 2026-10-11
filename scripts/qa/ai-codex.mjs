// Supported subscription-authenticated Codex CLI; no token extraction or private API calls.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawn, spawnSync } from 'node:child_process'
import { VisualReviewer, detector as apiDetector, requestFor, parseReview, sha } from './ai.mjs'
import { readJSON, writeJSON } from './store.mjs'

export const codexDetector = { version: 'visual-review-1-codex', model: apiDetector.model, provider: 'codex', billing: 'ChatGPT subscription allowance' }
export function parseCodexEvents(stdout) {
    const events = stdout.trim().split('\n').filter(Boolean).map(line => JSON.parse(line))
    // The installed CLI emits deliberate isolation notices as error items, not fatal turn errors.
    const isolationNotice = item => item.type === 'error' && (/^Code Mode is unavailable because code-mode host is disabled\./.test(item.message) || /^Exceeded skills context budget\. All skill descriptions were removed/.test(item.message))
    if (events.some(e => ['turn.failed', 'error'].includes(e.type) || (e.item && !['agent_message', 'reasoning'].includes(e.item.type) && !isolationNotice(e.item)))) throw new Error('Codex output or tool isolation validation failed')
    const usage = events.find(e => e.type === 'turn.completed')?.usage
    if (!usage || !Number.isSafeInteger(usage.input_tokens) || !Number.isSafeInteger(usage.output_tokens) || usage.input_tokens < 0 || usage.output_tokens < 0) throw new Error('Codex usage unavailable')
    return usage
}
export function codexEnvironment(env = process.env) {
    return Object.fromEntries(['PATH', 'HOME', 'CODEX_HOME', 'TMPDIR', 'USER', 'LOGNAME', 'LANG'].filter(k => env[k]).map(k => [k, env[k]]))
}
export function codexArguments(directory, images) {
    return ['exec', '--ignore-user-config', '--ephemeral', '--skip-git-repo-check', '--sandbox', 'read-only', '--json', '--color', 'never',
        '--model', codexDetector.model, '--cd', directory, '--output-schema', path.join(directory, 'schema.json'), '--output-last-message', path.join(directory, 'answer.json'),
        ...['approval_policy="never"', 'forced_login_method="chatgpt"', 'model_reasoning_effort="low"', 'web_search="disabled"',
            'features.shell_tool=false', 'features.unified_exec=false', 'features.multi_agent=false', 'features.multi_agent_v2=false',
            'features.apps=false', 'features.plugins=false', 'features.hooks=false', 'features.computer_use=false', 'features.code_mode_host=false',
            'project_doc_max_bytes=0', 'skills.max_context_tokens=1', 'memories.use_memories=false', 'memories.generate_memories=false'].flatMap(value => ['-c', value]),
        ...images.flatMap(i => ['--image', path.join(directory, i.role + '.png')]), '-']
}

export class CodexReviewer extends VisualReviewer {
    constructor(directory, config) {
        super(directory, config)
        this.environment = codexEnvironment()
        const auth = spawnSync(config.codexBinary, ['login', 'status'], { env: this.environment, encoding: 'utf8', timeout: 5000 })
        this.configured = auth.status === 0 && /ChatGPT/i.test((auth.stdout || '') + (auth.stderr || ''))
        const version = spawnSync(config.codexBinary, ['--version'], { env: this.environment, encoding: 'utf8', timeout: 5000 })
        this.cliVersion = /^codex-cli [\d.]+/.exec(version.stdout || '')?.[0] || 'unavailable'
        this.detector = { ...codexDetector, cliVersion: this.cliVersion }
    }
    status() { return { configured: this.configured, ...this.detector, requests: this.ledger.requests, maxRequests: this.config.maxRequests, tokens: this.ledger.tokens || 0 } }
    async evaluate(evidence, signal) {
        if (this.busy) throw new Error('AI reviewer busy')
        const request = requestFor(evidence), key = sha(JSON.stringify({ detector: this.detector, options: codexArguments('/evidence', evidence.images), request })), cacheFile = path.join(this.directory, 'cache', key + '.json')
        if (fs.existsSync(cacheFile)) return { ...readJSON(cacheFile), cached: true, latencyMs: 0 }
        if (!this.configured) throw new Error('Codex ChatGPT sign-in required; run codex login locally')
        if (signal?.aborted) throw new Error('AI review cancelled')
        if (this.ledger.requests >= this.config.maxRequests) throw new Error('Codex review request limit reached')
        this.busy = true
        this.ledger.requests++; writeJSON(this.ledgerFile, this.ledger)
        const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'tabby-visual-review-')), started = Date.now()
        try {
            for (const image of evidence.images) fs.writeFileSync(path.join(directory, image.role + '.png'), image.bytes, { mode: 0o600 })
            writeJSON(path.join(directory, 'schema.json'), request.text.format.schema)
            const prompt = request.instructions + '\nInspect only the attached images. Do not call tools or inspect files.\n' + request.input[0].content.filter(c => c.type === 'input_text').map(c => c.text).join('\n')
            const result = await new Promise((resolve, reject) => {
                const child = spawn(this.config.codexBinary, codexArguments(directory, evidence.images), { cwd: directory, env: this.environment, detached: process.platform !== 'win32', stdio: ['pipe', 'pipe', 'pipe'] })
                let stdout = '', stderr = '', failure = null, force, stopping = false
                const stop = () => {
                    if (stopping) return
                    stopping = true
                    try { process.kill(-child.pid, 'SIGTERM') } catch { child.kill('SIGTERM') }
                    force = setTimeout(() => { try { process.kill(-child.pid, 'SIGKILL') } catch { child.kill('SIGKILL') } }, 2000); force.unref()
                }
                const abort = () => { failure = 'AI review cancelled'; stop() }
                signal?.addEventListener('abort', abort, { once: true })
                const timer = setTimeout(() => { failure = 'Codex review timed out'; stop() }, 60_000)
                child.stdout.on('data', chunk => { if (stdout.length <= 100_000) stdout = (stdout + chunk).slice(0, 100_001); if (stdout.length > 100_000 && !failure) { failure = 'Codex response exceeds limit'; stop() } })
                child.stderr.on('data', chunk => { if (stderr.length < 100_000) stderr += chunk })
                child.stdin.on('error', () => {})
                child.on('error', () => { failure = 'Codex launch failed' })
                child.on('close', code => {
                    clearTimeout(timer); clearTimeout(force); signal?.removeEventListener('abort', abort)
                    if (failure || code !== 0) return reject(new Error(failure || (/usage.limit|rate.limit|quota/i.test(stderr) ? 'Codex subscription usage limit reached' : 'Codex review failed; check local sign-in and model access')))
                    try {
                        resolve(parseCodexEvents(stdout))
                    } catch { reject(new Error('Codex output or tool isolation validation failed')) }
                })
                child.stdin.end(prompt)
            })
            this.ledger.tokens = (this.ledger.tokens || 0) + result.input_tokens + result.output_tokens; writeJSON(this.ledgerFile, this.ledger)
            const answer = fs.readFileSync(path.join(directory, 'answer.json'), 'utf8')
            if (answer.length > 100_000) throw new Error('Codex answer exceeds limit')
            const review = parseReview({ status: 'completed', output: [{ content: [{ type: 'output_text', text: answer }] }] }, evidence.images.some(i => i.role === 'later'))
            const saved = { ...review, detector: this.detector, cacheKey: key, evaluatedAt: new Date().toISOString(), providerModel: codexDetector.model,
                usage: { input_tokens: result.input_tokens, output_tokens: result.output_tokens, cached_input_tokens: result.cached_input_tokens || 0 },
                estimatedUSD: null, latencyMs: Date.now() - started, cached: false }
            writeJSON(cacheFile, saved); return saved
        } finally { fs.rmSync(directory, { recursive: true, force: true }); this.busy = false }
    }
}

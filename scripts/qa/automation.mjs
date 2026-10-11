import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { readJSON, writeJSON, catalog } from './store.mjs'
import { mutations } from './mutations.mjs'

const normal = test => ({ test, ai: false })
const representative = ['visual-macos-ubuntu2404', 'visual-windows-windows11', 'visual-linux-rocky9']
const campaign = (test, all = false) => ({ test, ai: true, mutations: (all ? mutations : mutations.filter(m => m.id === 'crop')).map(m => ({ id: m.id, value: m.values[0] })) })
export const profiles = {
    smoke: { name: 'Native settings smoke', steps: ['macos', 'windows', 'linux'].map(c => normal(`visual-${c}-host`)) },
    matrix: { name: 'All 18 visual environments', steps: catalog.filter(c => c.client).map(c => normal(c.id)) },
    nightly: { name: 'Representative RDP and mutation checks', steps: [...representative.map(normal), campaign(representative[0]), normal(representative[0])] },
    weekly: { name: 'Expanded mutations on three native clients', steps: representative.flatMap(test => [normal(test), campaign(test, true), normal(test)]) },
}
export function validateAutomation(value = {}) {
    if (!value || Object.keys(value).some(k => !['schedules', 'github', 'retention'].includes(k))) throw new Error('Invalid automation configuration')
    const schedules = value.schedules || []
    if (!Array.isArray(schedules) || schedules.length > 10) throw new Error('Invalid schedules')
    const ids = new Set()
    for (const item of schedules) {
        if (!item || Object.keys(item).some(k => !['id','profile','everyMinutes','firstAt'].includes(k)) || !/^[a-z][a-z0-9-]{0,39}$/.test(item.id) || ids.has(item.id) || !Object.hasOwn(profiles, item.profile) || !Number.isInteger(item.everyMinutes) || item.everyMinutes < 1 || item.everyMinutes > 10080 || !Number.isFinite(Date.parse(item.firstAt))) throw new Error('Invalid schedule')
        ids.add(item.id)
    }
    if (value.github !== undefined && typeof value.github !== 'boolean') throw new Error('Invalid GitHub switch')
    const retention = { passDays: 14, failureDays: 90, maxRuns: 500, maxBytes: 10_000_000_000, ...(value.retention || {}) }
    for (const [key, n] of Object.entries(retention)) if (!['passDays','failureDays','maxRuns','maxBytes'].includes(key) || !Number.isSafeInteger(n) || n < 1) throw new Error('Invalid retention limits')
    if (retention.failureDays < retention.passDays || retention.maxRuns > 10000 || retention.maxBytes < 1_000_000) throw new Error('Invalid retention policy')
    return { schedules, github: value.github === true, retention }
}

// One persisted batch at a time. The server owns the existing single-test/AI lock.
export class Automation {
    constructor(directory, config, hooks) {
        this.directory = directory; this.config = config; this.hooks = hooks; this.busy = false
        fs.mkdirSync(directory, { recursive: true, mode: 0o700 })
        this.file = path.join(directory, 'state.json')
        this.state = fs.existsSync(this.file) ? readJSON(this.file) : { paused: false, due: {}, jobs: [] }
        for (const job of this.state.jobs) if (job.status === 'running') {
            job.status = 'interrupted'; job.reason = 'Service stopped; unstarted steps were not executed. No automatic replay.'; job.finishedAt = new Date().toISOString()
            for (const step of job.steps) if (['pending','running'].includes(step.status)) step.status = 'not-executed'
        }
        for (const schedule of config.schedules) this.state.due[schedule.id] ??= schedule.firstAt
        this.save()
    }
    save() { this.state.jobs = this.state.jobs.slice(-200); writeJSON(this.file, this.state) }
    snapshot() { return { ...this.state, active: this.busy ? this.state.jobs.at(-1)?.id : null, schedules: this.config.schedules, profiles: Object.entries(profiles).map(([id,p])=>({id,name:p.name,steps:p.steps.length})) } }
    pause(paused) { this.state.paused = paused; this.save() }
    async tick(now = Date.now()) {
        if (this.busy || this.state.paused || this.hooks.busy()) return
        const schedule = this.config.schedules.find(s => Date.parse(this.state.due[s.id]) <= now)
        if (!schedule) return
        // Advance before work: missed intervals coalesce to one attempt, never a catch-up storm.
        const due = Date.parse(this.state.due[schedule.id]), interval = schedule.everyMinutes * 60_000
        this.state.due[schedule.id] = new Date(due + (Math.floor((now - due) / interval) + 1) * interval).toISOString()
        this.save()
        return this.start(schedule.profile, { kind: 'schedule', schedule: schedule.id, dueAt: new Date(due).toISOString() })
    }
    start(profile, trigger, expectedCommit) {
        if (!Object.hasOwn(profiles, profile)) throw new Error('Select a fixed automation profile')
        if (this.busy || this.hooks.busy()) throw new Error('A test, review or automation batch is active')
        const job = { id: crypto.randomUUID(), profile, trigger, status: 'running', startedAt: new Date().toISOString(), steps: profiles[profile].steps.map(s => ({ ...s, status: 'pending' })) }
        this.state.jobs.push(job); this.busy = true; this.save()
        this.promise = this.execute(job, expectedCommit)
        return job
    }
    async execute(job, expectedCommit) {
        try {
            const source = await this.hooks.source()
            job.commit = source.commit
            if (source.dirty || expectedCommit && source.commit !== expectedCommit) throw new Error('Not executed: checkout is dirty or does not match the requested commit')
            for (const step of job.steps) {
                if (job.cancelled) break
                const current = await this.hooks.source()
                if (current.dirty || current.commit !== job.commit) throw new Error('Checkout changed during batch; remaining steps not executed')
                step.status = 'running'; this.save()
                const run = await this.hooks.run(step, job, id => { step.runId = id; this.save() })
                step.runId = run.id; step.status = run.status; step.investigation = run.investigationStatus || null; step.aiStatus = run.automaticAIStatus || null
                this.save()
                // Infrastructure outages do not suppress evidence from the other independent environments.
            }
            job.status = job.cancelled ? 'cancelled' : job.steps.every(s => s.status === 'passed' && (!s.ai || s.aiStatus === 'completed')) ? 'passed' : 'attention'
        } catch (error) { job.status = 'blocked'; job.reason = error.message }
        finally {
            for (const step of job.steps) if (['pending','running'].includes(step.status)) step.status = 'not-executed'
            job.finishedAt = new Date().toISOString(); this.busy = false; this.save()
        }
    }
    cancel() { if (this.busy) { this.state.jobs.at(-1).cancelled = true; this.save(); this.hooks.cancel() } }
}

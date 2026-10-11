import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { VisualReviewer, requestFor, parseReview, configuration } from './ai.mjs'
import { reviewCases, loadEvidence, evidenceReceipt, aiMetrics } from './ai-evidence.mjs'

const png = Buffer.alloc(24); Buffer.from('89504e470d0a1a0a', 'hex').copy(png); png.writeUInt32BE(800, 16); png.writeUInt32BE(600, 20)
const evidence = { images: [{ role: 'reference', bytes: png }, { role: 'observed', bytes: png }], sequence: 0 }
const healthy = { verdict: 'healthy', confidence: 0.8, findings: [], observations: 'Intact fixture.', hypotheses: '', limitations: 'Static image.' }
const response = value => ({ status: 'completed', model: 'gpt-6-luna', usage: { input_tokens: 100, output_tokens: 100 }, output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify(value) }] }] })
const temp = t => { const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'trd-ai-')); t.after(() => fs.rmSync(dir, { recursive: true, force: true })); return dir }

test('AI request has only explicit image/state evidence; metadata cannot change the request or cache identity', () => {
    const request = requestFor(evidence)
    assert.deepEqual(requestFor({ ...evidence, mutation: 'secret-truth', expectedFailure: 'fail', control: true, filename: '/private/key' }), request)
    assert.equal(request.store, false); assert.equal(request.service_tier, 'default'); assert.equal(request.text.format.strict, true)
    assert.equal(JSON.stringify(request).includes('secret-truth'), false)
    assert.throws(() => requestFor({ ...evidence, sequence: NaN }))
    assert.throws(() => requestFor({ images: [{ role: 'observed', bytes: Buffer.from('not PNG') }] }))
    assert.throws(() => requestFor({ images: [{ role: 'arbitrary', bytes: png }] }))
    const retina = Buffer.from(png); retina.writeUInt32BE(2200, 16); retina.writeUInt32BE(1700, 20)
    assert.doesNotThrow(() => requestFor({ images: [{ role: 'observed', bytes: retina }] }))
    const huge = Buffer.from(png); huge.writeUInt32BE(4097, 16)
    assert.throws(() => requestFor({ images: [{ role: 'observed', bytes: huge }] }))
})

test('AI parsing rejects refusal, incomplete, contradictory or ungrounded region responses', () => {
    assert.deepEqual(parseReview(response(healthy)), healthy)
    assert.throws(() => parseReview({ ...response(healthy), status: 'incomplete' }), /incomplete/)
    assert.throws(() => parseReview({ status: 'completed', output: [{ content: [{ type: 'refusal' }] }] }), /refused/)
    assert.throws(() => parseReview(response({ ...healthy, verdict: 'anomaly' })))
    assert.throws(() => parseReview(response({ ...healthy, confidence: 2 })))
    const finding = { category: 'clipping', severity: 'high', confidence: 0.7, image: 'observed', region: { x: 0.9, y: 0, width: 0.1, height: 1 }, explanation: 'Right edge absent.' }
    const anomaly = { ...healthy, verdict: 'anomaly', findings: [finding] }
    assert.equal(parseReview(response(anomaly)).findings.length, 1)
    assert.throws(() => parseReview(response({ ...anomaly, findings: [{ ...finding, image: 'later' }] })))
    assert.throws(() => parseReview(response({ ...anomaly, findings: [{ ...finding, region: { x: 0.9, y: 0, width: 1, height: 1 } }] })))
})

test('AI cache survives restart, records usage, and excludes credentials from persisted evidence', async t => {
    const dir = temp(t); let calls = 0
    const fetcher = async (url, init) => {
        calls++; assert.equal(url, 'https://api.openai.com/v1/responses'); assert.equal(init.redirect, 'error')
        assert.equal(init.headers.Authorization, 'Bearer fixture-secret')
        return new Response(JSON.stringify(response(healthy)))
    }
    const reviewer = new VisualReviewer(dir, { key: 'fixture-secret', budgetUSD: 2 }, fetcher)
    const first = await reviewer.evaluate(evidence)
    assert.equal(first.cached, false); assert.equal(reviewer.status().reservedUSD, 0); assert.ok(first.estimatedUSD > 0)
    const second = await new VisualReviewer(dir, { key: '', budgetUSD: 2 }, fetcher).evaluate(evidence)
    assert.equal(second.cached, true); assert.equal(second.latencyMs, 0); assert.equal(calls, 1)
    assert.equal(fs.readFileSync(path.join(dir, 'cache', first.cacheKey + '.json'), 'utf8').includes('fixture-secret'), false)
    assert.equal(fs.readFileSync(path.join(dir, 'ledger.json'), 'utf8').includes('fixture-secret'), false)
    const altered = { ...evidence, sequence: 1 }
    await assert.rejects(new VisualReviewer(dir, { key: '', budgetUSD: 2 }, fetcher).evaluate(altered), /not configured/)
})

test('AI failures retain budget reservations across restarts, never retry and sanitize provider errors', async t => {
    const dir = temp(t); let calls = 0
    const fetcher = async () => { calls++; return new Response('credential SECRET echoed', { status: 401 }) }
    const reviewer = new VisualReviewer(dir, { key: 'SECRET', budgetUSD: 0.30 }, fetcher)
    await assert.rejects(reviewer.evaluate(evidence), /^Error: AI provider HTTP 401$/)
    assert.equal(reviewer.status().reservedUSD, 0.30)
    const restarted = new VisualReviewer(dir, { key: 'SECRET', budgetUSD: 0.30 }, fetcher)
    await assert.rejects(restarted.evaluate(evidence), /budget exhausted/); assert.equal(calls, 1)
})

test('AI cancellation aborts a live request and preserves an unknown charge', async t => {
    const dir = temp(t), controller = new AbortController()
    let begun
    const started = new Promise(resolve => { begun = resolve })
    const reviewer = new VisualReviewer(dir, { key: 'fixture', budgetUSD: 2 }, async (_url, init) => {
        begun(); await new Promise((_, reject) => init.signal.addEventListener('abort', () => reject(new Error('sensitive network error'))))
    })
    const pending = reviewer.evaluate(evidence, controller.signal)
    await started; controller.abort()
    await assert.rejects(pending, /^Error: AI review cancelled$/)
    assert.equal(reviewer.status().reservedUSD, 0.30)
})

test('AI private configuration refuses world-readable key files without exposing contents', t => {
    const dir = temp(t), file = path.join(dir, 'key')
    fs.writeFileSync(file, 'fixture-secret', { mode: 0o600 })
    assert.equal(configuration({ TRD_QA_OPENAI_KEY_FILE: file }).key, 'fixture-secret')
    fs.chmodSync(file, 0o644)
    assert.throws(() => configuration({ TRD_QA_OPENAI_KEY_FILE: file }), /private file/)
    assert.throws(() => configuration({ TRD_QA_AI_BUDGET_USD: 'NaN' }))
    assert.throws(() => configuration({ TRD_QA_AI_BUDGET_USD: '1000' }))
})

test('AI selection separates truth from pixels, excludes nonmanifestation and refuses escaped artifact paths', t => {
    const dir = temp(t); fs.writeFileSync(path.join(dir, 'observed.png'), png)
    const trial = { id: 'crop', complete: true, restored: true, manifestation: { manifested: true, remoteSequence: 0 }, category: 'cropping', layer: 'framebuffer' }
    const run = { mutations: [{}], experiments: [trial], tests: [{ attachments: ['expected', 'actual'].map(s => ({ name: 'experiment-1-crop-' + s, path: 'observed.png', contentType: 'image/png' })) }] }
    const [item] = reviewCases(run, dir)
    assert.equal(item.truth.defect, true)
    assert.deepEqual(loadEvidence(item, dir), evidence)
    assert.equal(evidenceReceipt(loadEvidence(item, dir)).images[0].sha256.length, 64)
    trial.manifestation.manifested = false
    assert.match(reviewCases(run, dir)[0].excluded, /did not manifest/)
    const outside = path.join(temp(t), 'secret'); fs.writeFileSync(outside, png); fs.symlinkSync(outside, path.join(dir, 'escape'))
    assert.throws(() => loadEvidence({ ...item, images: [{ role: 'observed', path: 'escape' }] }, dir), /Invalid evidence/)
})

test('AI effectiveness counts actual observations, abstentions as misses and infrastructure separately', () => {
    const row = (id, defect, verdict, status = 'completed') => ({ id, status, truth: { defect, category: 'test', layer: 'framebuffer' }, review: { verdict, latencyMs: 10, cached: false } })
    const metrics = aiMetrics([row('caught', true, 'anomaly'), row('miss', true, 'healthy'), row('uncertain', true, 'uncertain'), row('healthy', false, 'healthy'), row('fp', false, 'anomaly'), row('infra', true, null, 'failed'), { ...row('noop', true, 'anomaly'), excluded: 'not manifested' }, { status: 'completed', review: { verdict: 'anomaly' } }])
    assert.equal(metrics.manifested, 3); assert.equal(metrics.detected, 1); assert.equal(metrics.falseNegativeRate, 2 / 3)
    assert.equal(metrics.falsePositiveRate, 0.5); assert.equal(metrics.pendingOrFailed, 1); assert.equal(metrics.abstentions, 1)
    assert.equal(metrics.excluded, 1); assert.equal(metrics.unlabelled, 1); assert.deepEqual(metrics.escaped, ['miss', 'uncertain'])
    assert.equal(aiMetrics([]).detectionRate, null)
})

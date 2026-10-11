import fs from 'node:fs'
import path from 'node:path'
import { sha } from './ai.mjs'

function artifact(directory, attachment) {
    if (!attachment) throw new Error('Required image evidence missing')
    const base = fs.realpathSync(directory), file = fs.realpathSync(path.resolve(directory, attachment.path))
    if (!file.startsWith(base + path.sep) || !fs.statSync(file).isFile() || fs.statSync(file).size > 4_000_000) throw new Error('Invalid evidence file')
    return fs.readFileSync(file)
}

// Selection and truth are local only. The evaluator receives evidence.images and evidence.sequence,
// never the case ID, filenames, manifestation verdict, expected failure or existing detector results.
export function reviewCases(run, directory) {
    const attachments = run.tests.flatMap(t => t.attachments || [])
    const find = name => attachments.find(a => a.name === name && a.contentType === 'image/png')
    const cases = []
    const add = (id, mapping, sequence = null, truth = null, excluded = null) => {
        const images = Object.entries(mapping).filter(([, a]) => a).map(([role, a]) => ({ role, path: a.path }))
        cases.push({ id, images, sequence, truth, excluded, status: excluded ? 'excluded' : 'pending' })
    }
    if (run.mutations) {
        for (const [index, trial] of (run.experiments || []).entries()) {
            const prefix = `experiment-${index + 1}-${trial.id}`
            const excluded = !trial.complete || !trial.restored ? 'Incomplete trial or restoration' : !trial.control && !trial.manifestation?.manifested ? 'Mutation did not manifest' : null
            add(trial.id, { reference: find(prefix + '-expected'), observed: find(prefix + '-actual'), later: find(prefix + '-temporal-second') },
                trial.manifestation?.remoteSequence ?? null,
                { defect: !trial.control, category: trial.category || 'healthy', layer: trial.layer || 'control', source: 'Independent campaign observation' }, excluded)
        }
    } else {
        for (const name of ['initial-desktop', 'actual', 'tab-return', 'resized', 'reconnected']) {
            const reference = find(name + '-expected') || (name === 'actual' ? find('expected') : null)
            if (find(name)) add(name, { reference, observed: find(name) }, null,
                reference && run.status === 'passed' ? { defect: false, category: 'healthy-reference', layer: 'control', source: 'Passed reviewed-baseline checkpoint' } : null)
        }
        if (!cases.length || run.status !== 'passed') {
            const last = find('final-window') || find('window')
            if (last) add('final-window', { observed: last })
        }
    }
    // Successful input checkpoints are additional controls with actual state changes, not just static controls.
    const metadata = attachments.find(a => a.name === 'environment' && a.contentType === 'application/json')
    let checkpoints = []
    if (metadata) { try { checkpoints = JSON.parse(artifact(directory, metadata)).checkpoints || [] } catch {} }
    for (const name of ['mouse-input', 'keyboard-input']) {
        const state = checkpoints.find(c => c.name === name)?.state
        if (state && find(name)) add(name, { reference: find('actual-expected'), observed: find(name) }, state.sequence,
            run.status === 'passed' ? { defect: false, category: 'healthy-state-change', layer: 'control', source: 'Passed native-input checkpoint and independent remote state' } : null)
    }
    if (cases.length > 20) throw new Error('Review exceeds 20-case limit')
    return cases
}

export function loadEvidence(item, directory) {
    const images = item.images.map(i => ({ role: i.role, bytes: artifact(directory, i) }))
    return { images, sequence: item.sequence }
}
export function evidenceReceipt(evidence) {
    return { sequence: evidence.sequence, images: evidence.images.map(i => ({ role: i.role, sha256: sha(i.bytes) })) }
}

export function aiMetrics(cases) {
    const eligible = cases.filter(c => c.truth && !c.excluded)
    const evaluated = eligible.filter(c => c.status === 'completed')
    const defects = evaluated.filter(c => c.truth.defect), controls = evaluated.filter(c => !c.truth.defect)
    const caught = c => c.review.verdict === 'anomaly'
    const detected = defects.filter(caught).length, falsePositives = controls.filter(caught).length
    const ratio = (a, b) => b ? a / b : null
    const group = key => Object.fromEntries([...new Set(defects.map(c => c.truth[key]))].map(value => {
        const rows = defects.filter(c => c.truth[key] === value)
        return [value, { evaluated: rows.length, detected: rows.filter(caught).length }]
    }))
    const fresh = evaluated.filter(c => !c.review.cached)
    return { eligible: eligible.length, evaluated: evaluated.length, reviewable: cases.filter(c => !c.excluded).length,
        reviewed: cases.filter(c => c.status === 'completed').length,
        pendingOrFailed: cases.filter(c => !c.excluded && c.status !== 'completed').length,
        manifested: defects.length, detected, detectionRate: ratio(detected, defects.length), falseNegativeRate: ratio(defects.length - detected, defects.length),
        controls: controls.length, falsePositives, falsePositiveRate: ratio(falsePositives, controls.length),
        abstentions: evaluated.filter(c => c.review.verdict === 'uncertain').length,
        excluded: cases.filter(c => c.excluded).length, unlabelled: cases.filter(c => !c.truth).length,
        byCategory: group('category'), byLayer: group('layer'),
        uniqueEvaluations: new Set(evaluated.map(c => c.review.cacheKey).filter(Boolean)).size,
        byDetector: Object.fromEntries([...new Set(evaluated.map(c => `${c.review.detector?.model || 'unknown'}/${c.review.detector?.version || 'unknown'}`))].map(id => {
            const rows = evaluated.filter(c => `${c.review.detector?.model || 'unknown'}/${c.review.detector?.version || 'unknown'}` === id)
            return [id, { evaluated: rows.length, manifested: rows.filter(c => c.truth.defect).length, detected: rows.filter(c => c.truth.defect && caught(c)).length,
                controls: rows.filter(c => !c.truth.defect).length, falsePositives: rows.filter(c => !c.truth.defect && caught(c)).length }]
        })),
        escaped: defects.filter(c => !caught(c)).map(c => c.id),
        meanRequestLatencyMs: fresh.length ? fresh.reduce((sum, c) => sum + c.review.latencyMs, 0) / fresh.length : null,
        cached: evaluated.filter(c => c.review.cached).length }
}

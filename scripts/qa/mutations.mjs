import fs from 'node:fs'
export const mutations = JSON.parse(fs.readFileSync(new URL('./mutations.json', import.meta.url), 'utf8'))

export function validateCampaign(input, entry) {
    if (!input || Object.keys(input).some(k => !['test', 'mutations'].includes(k)) || !entry || (entry.suite || entry.id) === 'visual-host') throw new Error('Select a real RDP environment')
    if (!Array.isArray(input.mutations) || !input.mutations.length || input.mutations.length > mutations.length) throw new Error('Select 1–13 mutations')
    const seen = new Set()
    return input.mutations.map(choice => {
        if (!choice || Object.keys(choice).sort().join(',') !== 'id,value') throw new Error('Use a catalog mutation and value')
        const definition = mutations.find(m => m.id === choice.id)
        if (!definition || !definition.values.includes(choice.value) || seen.has(choice.id)) throw new Error('Invalid or repeated mutation')
        seen.add(choice.id)
        return { ...definition, value: choice.value, seed: null, expectedFailure: 'Visible reference or decoded-frame/state disagreement' }
    })
}

// Only executed detectors on independently manifested mutations enter the denominator.
export function effectiveness(trials) {
    const usable = trials.filter(t => t.complete)
    const manifested = usable.filter(t => !t.control && t.manifestation?.manifested)
    const detected = manifested.filter(t => t.detectors.some(d => d.failed))
    const controls = usable.filter(t => t.control)
    const falsePositives = controls.filter(t => t.detectors.some(d => d.failed)).length
    const ratio = (n, d) => d ? n / d : null
    const groups = key => Object.fromEntries([...new Set(manifested.map(t => t[key]))].map(value => {
        const group = manifested.filter(t => t[key] === value)
        return [value, { manifested: group.length, detected: group.filter(t => t.detectors.some(d => d.failed)).length }]
    }))
    const latencies = detected.map(t => t.latencyMs).filter(Number.isFinite)
    return { manifested: manifested.length, detected: detected.length, detectionRate: ratio(detected.length, manifested.length),
        falseNegativeRate: ratio(manifested.length - detected.length, manifested.length), controls: controls.length, falsePositives,
        falsePositiveRate: ratio(falsePositives, controls.length), meanObservationLatencyMs: latencies.length ? latencies.reduce((a,b)=>a+b,0)/latencies.length : null,
        excluded: trials.length - manifested.length - controls.length, byCategory: groups('category'), byLayer: groups('layer'),
        byDetector: Object.fromEntries(['screenshot', 'frame-state'].map(id => [id, { evaluated: manifested.filter(t=>t.detectors.some(d=>d.id===id)).length, detected: manifested.filter(t=>t.detectors.some(d=>d.id===id && d.failed)).length }])),
        escaped: manifested.filter(t => !t.detectors.some(d=>d.failed)).map(t=>t.id) }
}

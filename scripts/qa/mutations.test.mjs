import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mutations, validateCampaign, effectiveness } from './mutations.mjs'

test('campaign input is bounded to fixed real-RDP catalog values', () => {
    const entry={id:'visual-linux'}
    assert.equal(mutations.length,13)
    assert.equal(validateCampaign({test:entry.id,mutations:[{id:'crop',value:20}]},entry)[0].layer,'framebuffer')
    for(const input of [
        {test:entry.id,mutations:[]}, {test:entry.id,mutations:[{id:'crop',value:21}]},
        {test:entry.id,mutations:[{id:'crop',value:20,command:'no'}]},
        {test:entry.id,mutations:[{id:'crop',value:20},{id:'crop',value:40}]},
        {test:entry.id,mutations:[{id:'crop',value:20}],environment:{}},
    ]) assert.throws(()=>validateCampaign(input,entry))
    assert.throws(()=>validateCampaign({test:'visual-host',mutations:[{id:'crop',value:20}]},{id:'visual-host'}))
})

test('effectiveness excludes unmanifested/incomplete trials and preserves misses and healthy false positives', () => {
    const trial={complete:true,restored:true,control:false,manifestation:{manifested:true},layer:'frontend',category:'overlay',detectors:[{id:'screenshot',failed:true},{id:'frame-state',failed:false}],latencyMs:10}
    const metrics=effectiveness([
        {...trial,id:'caught'}, {...trial,id:'escaped',detectors:[{id:'screenshot',failed:false}]},
        {...trial,id:'no-op',manifestation:{manifested:false}}, {...trial,id:'interrupted',complete:false},
        {...trial,id:'healthy-bad',control:true,restored:false}, {...trial,id:'healthy-good',control:true,detectors:[{id:'screenshot',failed:false}]},
    ])
    assert.equal(metrics.manifested,2);assert.equal(metrics.detected,1);assert.equal(metrics.detectionRate,.5)
    assert.equal(metrics.falseNegativeRate,.5);assert.equal(metrics.falsePositiveRate,.5);assert.equal(metrics.excluded,2)
    assert.deepEqual(metrics.escaped,['escaped']);assert.equal(metrics.byLayer.frontend.detected,1)
    assert.equal(effectiveness([]).detectionRate,null)
})

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import path from 'node:path'
import { preserveColorProfile } from '../visual/png.js'
const require = createRequire(import.meta.url)
const { PNG } = require(path.join(path.dirname(require.resolve('playwright-core/package.json')), 'lib/utilsBundle.js'))

test('pixel mutation retains the source color profile without changing the mutated RGBA bytes', () => {
    const source = new PNG({ width: 2, height: 1 })
    source.data.set([220,40,60,255,30,100,200,255])
    const original = PNG.sync.write({ ...source, gamma: .45455 })
    const mutation = PNG.sync.read(original)
    mutation.data[4] = 120
    const encoded = PNG.sync.write({ ...mutation, gamma: 0 })
    assert.equal(PNG.sync.read(encoded).gamma, 0)
    const result = PNG.sync.read(preserveColorProfile(original, encoded))
    assert.equal(result.gamma, .45455)
    assert.deepEqual(result.data, mutation.data)
    assert.deepEqual([...result.data.subarray(0,4)], [220,40,60,255])
})

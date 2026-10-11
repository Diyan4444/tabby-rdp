// The H.264 decoder's cap on surfaces (src/h264.ts) over IronRDP's own decoder as vendored (WebCodecsH264Decoder,
// patch 0008), the browser's VideoDecoder stood in for: a server that draws on surface after surface has no more than
// MAX_H264_SURFACES decoders open, a frame that isn't a key frame opens none, and a desktop that draws on one or two
// surfaces, or moves to new ones as it resizes, decodes as before (security review, finding 3). Runs against the built
// plugin: npm run build && npm run test:unit
import { before, test } from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { fileURLToPath, pathToFileURL } from 'node:url'

const require = createRequire(import.meta.url)
const root = fileURLToPath(new URL('../../', import.meta.url))
const { cappedH264Decoder, MAX_H264_SURFACES } = require('../../dist/h264.js')

/** The browser's decoders, as many as are open, and every one made. */
const made: FakeVideoDecoder[] = []
class FakeVideoDecoder {
    state = 'unconfigured'
    readonly chunks: { type: string, timestamp: number }[] = []
    constructor (readonly init: { output: (frame: unknown) => void, error: (e: unknown) => void }) { made.push(this) }
    configure () { this.state = 'configured' }
    decode (chunk: { type: string, timestamp: number }) { this.chunks.push(chunk) }
    close () { this.state = 'closed' }
}
const open = () => made.filter(d => d.state !== 'closed').length

let WebCodecsH264Decoder: any
before(async () => {
    const g = globalThis as any
    g.VideoDecoder = FakeVideoDecoder
    g.EncodedVideoChunk = class { constructor (init: object) { Object.assign(this, init) } }
    ;({ WebCodecsH264Decoder } = await import(pathToFileURL(root + 'vendor/iron-remote-desktop-rdp.js').href))
})

/** IronRDP's decoder, capped, on a clock of the test's own; what each frame was answered with. */
function decoder () {
    const clock = { ms: 0 }
    const failures: string[] = []
    const inner = new WebCodecsH264Decoder({ now: () => clock.ms, stallMs: 3000, onFailure: (reason: string) => failures.push(reason) })
    const capped = cappedH264Decoder(inner)
    const answers = new Map<number, { pixels: unknown, error?: string }>()
    let id = 0
    const frame = (surfaceId: number, keyFrame: boolean) => {
        const frameId = ++id
        capped.decode({ id: frameId, surfaceId, keyFrame, data: new Uint8Array([0, 0, 0, 1, keyFrame ? 0x65 : 0x41]), regions: [], destination: { left: 0, top: 0, right: 2, bottom: 1 } },
            (done: number, pixels: unknown, error?: string) => {
                assert.ok(!answers.has(done), `frame ${done} answered twice`)
                answers.set(done, { pixels, error })
            })
        return frameId
    }
    return { inner, capped, clock, failures, answers, frame }
}

test('a server that draws on surface after surface has no more decoders open than the cap', t => {
    made.length = 0
    const d = decoder()
    t.after(() => d.capped.close())
    for (let surface = 0; surface < 2000; surface++) {
        d.clock.ms += 10
        d.frame(surface, true)
    }
    assert.equal(open(), MAX_H264_SURFACES)
    assert.equal(d.inner.surfaces.size, MAX_H264_SURFACES)
    assert.equal(d.capped.failed, null)
    // Every frame of a surface closed before its picture came was answered (dropped), and once only.
    assert.equal(d.answers.size, 2000 - MAX_H264_SURFACES)
    assert.ok([...d.answers.values()].every(a => a.pixels === null && !a.error))
    assert.equal(d.inner.stats.pending, MAX_H264_SURFACES)
})

test('the decoder\'s counts are read through the cap, as the live suites and the connection read them', t => {
    made.length = 0
    const d = decoder()
    t.after(() => d.capped.close())
    d.frame(1, true)
    assert.equal(d.capped.stats, d.inner.stats)
    assert.equal(d.capped.stats.pending, 1)
})

test('a frame that isn\'t a key frame opens no decoder; a surface that never gets one fails H.264, as the decoder\'s own watchdog does', t => {
    made.length = 0
    const d = decoder()
    t.after(() => d.capped.close())
    for (let surface = 0; surface < 1000; surface++) {
        d.frame(surface, false)
    }
    assert.equal(made.length, 0)
    assert.equal(d.answers.size, 1000)
    assert.equal(d.capped.failed, null)
    // Past the stall time, still without one: H.264 fails, and the connection goes on without it.
    d.clock.ms += 3001
    const last = d.frame(0, false)
    assert.match(d.capped.failed, /no key frame for surface 0/)
    assert.deepEqual(d.failures, [d.capped.failed])
    assert.equal(d.answers.get(last)?.error, d.capped.failed)
})

test('a desktop on one or two surfaces, and one that moves to new surfaces as it resizes, decodes as before', t => {
    made.length = 0
    const d = decoder()
    t.after(() => d.capped.close())
    // The main surface and AVC444's second view, a frame each 16 ms: key frames, then deltas.
    for (let i = 0; i < 100; i++) {
        d.clock.ms += 16
        d.frame(1, i === 0)
        d.frame(2, i === 0)
    }
    assert.equal(made.length, 2)
    assert.equal(d.answers.size, 0, 'no frame dropped')
    assert.equal(made[0].chunks.length, 100)
    // Resized fifty times, each a surface of its own (the old ones deleted, which the decoder doesn't hear of): the old
    // ones close, the newest stay open.
    for (let surface = 3; surface < 53; surface++) {
        d.clock.ms += 1000
        d.frame(surface, true)
        d.frame(surface, false)
    }
    assert.equal(open(), MAX_H264_SURFACES)
    assert.equal(d.capped.failed, null)
    assert.ok(d.inner.surfaces.has(52) && d.inner.surfaces.has(37) && !d.inner.surfaces.has(36))
    // The surface in use is the one kept, though it was opened first, and a closed one opens again from a key frame.
    made.length = 0
    const busy = new Map<number, number>()
    for (let i = 0; i < 40; i++) {
        d.clock.ms += 16
        busy.set(d.frame(52, false), 52)
        d.frame(100 + i, true)
    }
    assert.ok(d.inner.surfaces.has(52))
    assert.ok([...busy.keys()].every(id => !d.answers.has(id)), 'the surface in use dropped a frame')
    d.frame(3, false)
    assert.ok(!d.inner.surfaces.has(3))
    d.frame(3, true)
    assert.ok(d.inner.surfaces.has(3))
})

test('a decoder that doesn\'t keep its surfaces where the cap looks for them fails H.264 past the cap, rather than open more', () => {
    const decoded: number[] = []
    const inner = {
        failed: null as string | null, reclaimed: false,
        fail (reason: string) { this.failed = reason },
        decode (frame: { id: number, surfaceId: number }, done: (id: number, pixels: null, error?: string) => void) {
            if (this.failed) {
                done(frame.id, null, this.failed)
                return
            }
            decoded.push(frame.surfaceId)
        },
        close () { },
    }
    const capped = cappedH264Decoder(inner, 4)
    const errors: (string | undefined)[] = []
    for (let surface = 0; surface < 6; surface++) {
        capped.decode({ id: surface, surfaceId: surface, keyFrame: true }, (_id: number, _pixels: null, error?: string) => errors.push(error))
    }
    assert.deepEqual(decoded, [0, 1, 2, 3])
    assert.equal(capped.failed, 'the server drew on more than 4 surfaces')
    assert.deepEqual(errors, [capped.failed, capped.failed])
})

test('a decoder that keeps its surfaces without what closing one needs fails H.264 past the cap, rather than throw into IronRDP\'s call', () => {
    // Another IronRDP's surfaces, kept where the cap looks for them but not as it expects (no frames being decoded, no
    // browser decoder): a throw here would reach IronRDP's decode call, which ends the session as a decoding error, one
    // the connection doesn't reconnect without H.264 from.
    const inner = {
        failed: null as string | null, reclaimed: false,
        surfaces: new Map<number, unknown>(),
        fail (reason: string) { this.failed = reason },
        decode (frame: { id: number, surfaceId: number }, done: (id: number, pixels: null, error?: string) => void) {
            if (this.failed) {
                done(frame.id, null, this.failed)
                return
            }
            this.surfaces.set(frame.surfaceId, {})
        },
        close () { },
    }
    const capped = cappedH264Decoder(inner, 2)
    const errors: (string | undefined)[] = []
    assert.doesNotThrow(() => {
        for (let surface = 0; surface < 3; surface++) {
            capped.decode({ id: surface, surfaceId: surface, keyFrame: true }, (_id: number, _pixels: null, error?: string) => errors.push(error))
        }
    })
    assert.equal(capped.failed, 'the server drew on more than 2 surfaces')
    assert.deepEqual(errors, [capped.failed])
})

// The plugin's public decoder options against the actual vendored implementation, with small browser-codec
// stand-ins. No private decoder maps or counters are accessed: lifecycle notifications and accounting belong to
// IronRDP. Runs against the built plugin: npm run build && npm run test:unit.
import { before, test } from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { fileURLToPath, pathToFileURL } from 'node:url'

const require = createRequire(import.meta.url)
const root = fileURLToPath(new URL('../../', import.meta.url))
const { createH264Decoder, MAX_H264_DECODERS } = require('../../dist/h264.js')

const made: FakeVideoDecoder[] = []
class FakeVideoDecoder {
    state = 'unconfigured'
    readonly chunks: { type: string, timestamp: number }[] = []
    private flushed: (() => void) | undefined
    constructor (readonly init: { output: (frame: unknown) => void, error: (e: unknown) => void }) { made.push(this) }
    configure () { this.state = 'configured' }
    decode (chunk: { type: string, timestamp: number }) { this.chunks.push(chunk) }
    flush () { return new Promise<void>(resolve => { this.flushed = resolve }) }
    finishFlush () { this.flushed?.() }
    close () { this.state = 'closed' }
}
const open = () => made.filter(d => d.state !== 'closed').length
const settled = () => new Promise<void>(resolve => setImmediate(resolve))

let WebCodecsH264Decoder: any
before(async () => {
    const g = globalThis as any
    g.VideoDecoder = FakeVideoDecoder
    g.EncodedVideoChunk = class { constructor (init: object) { Object.assign(this, init) } }
    ;({ WebCodecsH264Decoder } = await import(pathToFileURL(root + 'vendor/iron-remote-desktop-rdp.js').href))
})

function decoder () {
    made.length = 0
    const clock = { ms: 0 }
    const failures: string[] = []
    const instance = createH264Decoder(WebCodecsH264Decoder, {
        now: () => clock.ms, stallMs: 3000, onFailure: (reason: string) => failures.push(reason),
    })
    const answers = new Map<number, { pixels: unknown, error?: string }>()
    let id = 0
    const frame = (surfaceId: number, keyFrame: boolean, endedSurfaces?: number[]) => {
        const frameId = ++id
        instance.decode({
            id: frameId, surfaceId, keyFrame, endedSurfaces,
            data: new Uint8Array([0, 0, 0, 1, keyFrame ? 0x65 : 0x41]),
            regions: [], destination: { left: 0, top: 0, right: 2, bottom: 1 },
        }, (done: number, pixels: unknown, error?: string) => {
            assert.ok(!answers.has(done), `frame ${done} answered twice`)
            answers.set(done, { pixels, error })
        })
        return frameId
    }
    return { instance, clock, failures, answers, frame }
}

function picture (timestamp: number) {
    return {
        timestamp, codedWidth: 2, codedHeight: 1, closed: false,
        visibleRect: { x: 0, y: 0, width: 2, height: 1 },
        close () { this.closed = true },
    }
}

test('the factory passes public options and returns the original decoder with all lifecycle hooks', () => {
    let constructed: PublicDecoder | undefined
    class PublicDecoder {
        readonly stats = { pending: 0 }
        readonly ended: number[] = []
        constructor (readonly options: object) { constructed = this }
        endSurfaces (ids: number[]) { this.ended.push(...ids) }
    }
    const now = () => 10
    const onFailure = () => {}
    const instance = createH264Decoder(PublicDecoder, { now, onFailure, stallMs: 1200 })
    assert.ok(constructed)
    assert.equal(instance, constructed)
    assert.deepEqual(instance.options, { now, onFailure, stallMs: 1200, maxDecoders: 16 })
    assert.equal(instance.stats, constructed?.stats)
    instance.endSurfaces([7])
    assert.deepEqual(constructed?.ended, [7])
})

test('the seventeenth active decoder fails H.264, settles every frame once and closes codecs', t => {
    const d = decoder()
    t.after(() => d.instance.close())
    for (let surface = 0; surface <= MAX_H264_DECODERS; surface++) {
        d.clock.ms += 10
        d.frame(surface, true)
    }
    assert.equal(made.length, MAX_H264_DECODERS)
    assert.equal(open(), 0)
    assert.match(d.instance.failed, /more than 16 surfaces/)
    assert.deepEqual(d.failures, [d.instance.failed])
    assert.equal(d.instance.reclaimed, false, 'capacity failures use the no-H.264 fallback')
    assert.equal(d.answers.size, MAX_H264_DECODERS + 1)
    assert.ok([...d.answers.values()].every(a => a.pixels === null && a.error === d.instance.failed))
    assert.equal(d.instance.stats.pending, 0)
})

test('deltas open no codecs and the watchdog fails a bounded waiting surface without another frame', t => {
    t.mock.timers.enable({ apis: ['setInterval'] })
    const d = decoder()
    t.after(() => d.instance.close())
    for (let surface = 0; surface <= MAX_H264_DECODERS; surface++) {
        d.frame(surface, false)
    }
    assert.equal(made.length, 0)
    assert.equal(d.answers.size, MAX_H264_DECODERS + 1)
    assert.equal(d.instance.stats.skipped, MAX_H264_DECODERS + 1)
    assert.equal(d.instance.failed, null)
    d.clock.ms = 3001
    t.mock.timers.tick(250)
    assert.match(d.instance.failed, /no key frame for 3001 ms/)
    assert.deepEqual(d.failures, [d.instance.failed])
})

test('ending a waiting surface clears its watchdog state without requiring a data frame', t => {
    t.mock.timers.enable({ apis: ['setInterval'] })
    const d = decoder()
    t.after(() => d.instance.close())
    d.frame(9, false)
    d.instance.endSurfaces([9])
    d.clock.ms = 3001
    t.mock.timers.tick(250)
    assert.equal(d.instance.failed, null)
    assert.equal(made.length, 0)
    d.frame(9, true)
    assert.equal(made.length, 1)
})

test('standalone surface deletion flushes and settles pending work before releasing its codec', async t => {
    const d = decoder()
    t.after(() => d.instance.close())
    const stats = d.instance.stats
    const id = d.frame(4, true)
    d.instance.endSurfaces([4])
    assert.equal(open(), 1)
    assert.equal(stats.pending, 1)
    made[0].finishFlush()
    await settled()
    assert.equal(open(), 0)
    assert.deepEqual(d.answers.get(id), { pixels: null, error: undefined })
    assert.equal(stats.pending, 0)
    assert.equal(stats.dropped, 1)
    d.frame(4, true)
    assert.equal(open(), 1)
    assert.equal(d.instance.stats, stats, 'statistics retain their identity')
    assert.equal(stats.pending, 1)
    assert.equal(d.instance.failed, null)
})

test('retiring codecs count against the same sixteen-codec capacity until their flush completes', async t => {
    const d = decoder()
    t.after(() => d.instance.close())
    const ids = Array.from({ length: MAX_H264_DECODERS }, (_, id) => id)
    for (const id of ids) { d.frame(id, true) }
    d.instance.endSurfaces(ids)
    assert.equal(open(), MAX_H264_DECODERS)
    d.frame(MAX_H264_DECODERS, true)
    assert.match(d.instance.failed, /more than 16 surfaces/)
    assert.equal(made.length, MAX_H264_DECODERS)
    assert.equal(open(), 0)
    assert.equal(d.answers.size, MAX_H264_DECODERS + 1)
    for (const codec of made) { codec.finishFlush() }
    await settled()
    assert.equal(d.answers.size, MAX_H264_DECODERS + 1, 'late flushes do not complete frames twice')
    assert.equal(d.instance.stats.pending, 0)
})

test('embedded surface endings are applied before a same-ID delta and require a fresh key frame', async t => {
    const d = decoder()
    t.after(() => d.instance.close())
    const first = d.frame(2, true)
    const output = picture(first)
    made[0].init.output(output)
    await settled()
    assert.equal(output.closed, true)
    assert.equal(d.instance.stats.pending, 0)
    assert.equal(d.instance.stats.frames, 1)
    const delta = d.frame(2, false, [2])
    assert.equal(open(), 0)
    assert.equal(made.length, 1)
    assert.deepEqual(d.answers.get(delta), { pixels: null, error: undefined })
    assert.equal(d.instance.stats.skipped, 1)
    d.frame(2, true)
    assert.equal(made.length, 2)
    assert.equal(open(), 1)
    assert.equal(d.instance.failed, null)
})

test('ordinary key frames and deltas on two surfaces preserve order and public statistics', t => {
    const d = decoder()
    t.after(() => d.instance.close())
    const stats = d.instance.stats
    for (let i = 0; i < 4; i++) {
        d.clock.ms += 16
        d.frame(1, i === 0)
        d.frame(2, i === 0)
    }
    assert.equal(made.length, 2)
    assert.deepEqual(made[0].chunks.map(c => c.timestamp), [1, 3, 5, 7])
    assert.deepEqual(made[0].chunks.map(c => c.type), ['key', 'delta', 'delta', 'delta'])
    assert.equal(d.answers.size, 0)
    assert.equal(d.instance.stats, stats)
    assert.equal(stats.pending, 8)
    assert.equal(stats.keyFrames, 2)
    assert.equal(d.instance.failed, null)
})

test('close suppresses late retiring-codec callbacks and closes a late picture', async () => {
    const d = decoder()
    const id = d.frame(5, true)
    d.instance.endSurfaces([5])
    d.instance.close()
    made[0].finishFlush()
    const output = picture(id)
    made[0].init.output(output)
    await settled()
    assert.equal(output.closed, true)
    assert.equal(d.answers.size, 0, 'a closed session must not call its released WASM callbacks')
    assert.equal(open(), 0)
    assert.equal(d.instance.stats.pending, 0)
    assert.deepEqual(d.failures, [])
})

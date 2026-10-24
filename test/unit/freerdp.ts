import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { connect, createServer } from 'node:net'
import { once } from 'node:events'
import { existsSync, readFileSync, readdirSync, lstatSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { createSecureContext, TLSSocket } from 'node:tls'
import { selfSigned } from './support/certificates.js'

const require = createRequire(import.meta.url)
const { FreeRDPFrames, ipcFrame, numbers, decodeNativeFrame, freeRDPRelay, FreeRDPProcess, FreeRDPError, nativeHelperPath, helperEnvironment } = require('../../dist/freerdp.js')
const { nativeKey } = require('../../dist/freerdpView.js')
const { ownRDPClient, rdpClient } = require('../../dist/rdpClient.js')
const { specOf, sessionKey } = require('../../dist/desktops.js')

test('distributed native helpers retain their recorded source, artifact hashes and license notices', () => {
    const root = fileURLToPath(new URL('../../', import.meta.url))
    const binaries = join(root, 'native/bin')
    const hash = (name: string) => createHash('sha256').update(readFileSync(join(root, name))).digest('hex')
    // Source-only development checkouts may not have built a helper yet.
    if (!existsSync(binaries)) return
    for (const platform of readdirSync(binaries)) {
        const dir = join(binaries, platform)
        const record = JSON.parse(readFileSync(join(dir, 'BUILD.json'), 'utf8'))
        assert.deepEqual(record.source, JSON.parse(readFileSync(join(root, 'native/freerdp-source.json'), 'utf8')))
        assert.equal(platform, `${record.platform}-${record.arch}`)
        for (const [source, expected] of Object.entries(record.buildSources)) assert.equal(hash(source), expected, `${source} changed; rebuild FreeRDP`)
        for (const file of record.files) {
            assert.equal(hash(`native/bin/${platform}/${file.path}`), file.sha256, `${platform}/${file.path} changed since build`)
        }
        const listed = record.files.map((f: { path: string }) => f.path).sort()
        const files = (dir: string, prefix = ''): string[] => readdirSync(dir).flatMap(name => {
            const path = join(dir, name), stat = lstatSync(path)
            assert.ok(!stat.isSymbolicLink(), `native bundle cannot contain a link: ${path}`)
            return stat.isDirectory() ? files(path, `${prefix}${name}/`) : [`${prefix}${name}`]
        })
        assert.deepEqual(files(dir).filter(name => name !== 'BUILD.json').sort(), listed)
        for (const license of ['FreeRDP-LICENSE', 'FreeRDP-NOTICE', 'OpenSSL-LICENSE', 'NOTICE']) assert.ok(listed.includes(`licenses/${license}`))
        assert.ok(listed.includes(`tabby-freerdp${record.platform === 'win32' ? '.exe' : ''}`))
    }
})

test('client choice defaults to IronRDP; invalid config never runs an arbitrary backend', () => {
    for (const value of [undefined, null, '', 'auto', 'FreeRDP', 'toString', {}, { toString () { throw new Error('not text') } }]) {
        assert.equal(rdpClient(value), 'ironrdp')
        assert.equal(ownRDPClient(value), undefined)
    }
    assert.equal(rdpClient('freerdp'), 'freerdp')
    const a = specOf({ host: 'pc', client: 'ironrdp' }), b = specOf({ host: 'pc', client: 'freerdp' })
    assert.equal(b.client, 'freerdp')
    assert.equal(sessionKey('rdp', a), sessionKey('rdp', b), 'client changes do not create new credentials/certificate identities')
})

test('the helper receives OS paths and locale without inheriting application/test credentials', t => {
    const before = process.env.TRD_TEST_DIRECT_PASSWORD
    t.after(() => { if (before === undefined) delete process.env.TRD_TEST_DIRECT_PASSWORD; else process.env.TRD_TEST_DIRECT_PASSWORD = before })
    process.env.TRD_TEST_DIRECT_PASSWORD = 'test-only-secret'
    const env = helperEnvironment()
    assert.equal(env.TRD_TEST_DIRECT_PASSWORD, undefined)
    assert.equal(env.PATH, process.env.PATH)
    assert.equal(env.OPENSSL_MODULES, require('node:path').dirname(nativeHelperPath()))
    assert.ok(!Object.keys(env).some(key => /PASSWORD|TOKEN|SECRET|API_KEY/.test(key)))
})

test('IPC handles split headers/bodies, coalesced frames and rejects oversized frames before allocating them', () => {
    const stream = Buffer.concat([ipcFrame('D', numbers(1280, 720)), ipcFrame('N'), ipcFrame('X', numbers(0, 0))])
    const result: unknown[] = []
    const decoder = new FreeRDPFrames()
    for (const byte of stream) decoder.push(Buffer.from([byte]), (type: string, data: Buffer) => result.push([type, data.toString('hex')]))
    assert.deepEqual(result, [['D', numbers(1280, 720).toString('hex')], ['N', ''], ['X', numbers(0, 0).toString('hex')]])
    assert.throws(() => decoder.push(Buffer.from([70, 127, 255, 255, 255]), () => {}), /oversized/)
})

test('native display updates must fit both the tile and the bounded remote screen', () => {
    const frame = Buffer.concat([numbers(10, 20, 2, 1, 800, 600), Buffer.from([255, 0, 0, 255, 0, 255, 0, 255])])
    const decoded = decodeNativeFrame(frame)
    assert.deepEqual([decoded.x, decoded.y, decoded.width, decoded.screenWidth, ...decoded.rgba], [10, 20, 2, 800, 255, 0, 0, 255, 0, 255, 0, 255])
    for (const data of [Buffer.alloc(0), frame.subarray(0, -1), Buffer.concat([numbers(799, 0, 2, 1, 800, 600), Buffer.alloc(8)]),
        Buffer.concat([numbers(0, 0, 1, 1, 0xffffffff, 600), Buffer.alloc(4)])]) assert.throws(() => decodeNativeFrame(data), /display update/)
})

test('native keys retain physical shortcuts and extended scan codes; Unicode supports non-BMP characters', () => {
    const key = { code: 'KeyA', key: 'ä', ctrlKey: false, altKey: false, metaKey: false }
    assert.deepEqual(nativeKey(key, false), { scan: 0x1e, text: '' })
    assert.deepEqual(nativeKey(key, true), { scan: 0, text: 'ä' })
    assert.deepEqual(nativeKey({ ...key, key: '😀' }, true), { scan: 0, text: '😀' })
    assert.deepEqual(nativeKey({ ...key, ctrlKey: true }, true), { scan: 0x1e, text: '' })
    assert.deepEqual(nativeKey({ ...key, code: 'Delete', key: 'Delete' }, true), { scan: 0x153, text: '' })
    assert.equal(nativeKey({ ...key, code: 'Unknown', key: 'Unidentified' }, true), null)
})

test('only explicit credential rejection triggers a saved-password retry', () => {
    assert.equal(new FreeRDPError(0x20014).kind(), 2)
    assert.equal(new FreeRDPError(0x20015).kind(), 2)
    for (const code of [0x20009, 0x20008, 0x2000d]) assert.equal(new FreeRDPError(code).kind(), undefined)
})

test('native input waits until authentication has finished without delaying security decisions', () => {
    const native = new FreeRDPProcess(), writes: Buffer[] = []
    native.child = { stdin: { writableLength: 0, write: (data: Buffer) => writes.push(data) } }
    for (const type of ['M', 'K', 'R', 'N', 'C']) native.send(type, Buffer.from([1]))
    assert.deepEqual(writes.map(data => String.fromCharCode(data[0])), ['N', 'C'])
    native.receive('D', numbers(800, 600), {})
    for (const type of ['M', 'K', 'R']) native.send(type, Buffer.alloc(12))
    assert.deepEqual(writes.map(data => String.fromCharCode(data[0])), ['N', 'C', 'M', 'K', 'R'])
})

test('server-directed session endings do not become reconnectable transport failures', async () => {
    for (const reason of [0, 1, 2, 3, 4, 5, 11, 12]) {
        const native = new FreeRDPProcess()
        native.receive('D', numbers(800, 600), {})
        native.receive('X', numbers(reason ? 0x10000 | reason : 0, reason), {})
        const end = await native.run()
        assert.ok(end.reason())
    }
    for (const code of [0x2000d, 0x10006, 0x10007]) {
        const native = new FreeRDPProcess()
        native.receive('D', numbers(800, 600), {})
        native.receive('X', numbers(code, 0), {})
        await assert.rejects(native.run(), /FreeRDP connection failed/)
    }
})

test('the native relay authenticates before opening any remote stream and closes relayed sockets', async t => {
    const echo = createServer(socket => { socket.on('error', () => {}); socket.pipe(socket) })
    echo.listen(0, '127.0.0.1'); await once(echo, 'listening')
    let opens = 0
    const relay = await freeRDPRelay(async () => { opens++; const socket = connect((echo.address() as any).port, '127.0.0.1'); await once(socket, 'connect'); return socket })
    t.after(() => { relay.close(); echo.close() })
    const wrong = connect(relay.port, '127.0.0.1')
    wrong.on('error', () => {}); wrong.write(Buffer.alloc(64, 48)); await once(wrong, 'close')
    assert.equal(opens, 0)
    const right = connect(relay.port, '127.0.0.1')
    right.on('error', () => {})
    // Authentication can share the first packet with RDP bytes and arrive in multiple chunks.
    right.write(relay.token.slice(0, 30)); right.write(relay.token.slice(30) + 'hello')
    const [data] = await once(right, 'data')
    assert.equal(data.toString(), 'hello')
    assert.equal(opens, 1)
    assert.deepEqual(relay.stats, { bytesIn: 5, bytesOut: 5 })
    const closed = once(right, 'close'); relay.close(); await closed
})

const native = existsSync(nativeHelperPath())

test('a refused SSH/gateway transport preserves its reason for the connection log', async t => {
    const relay = await freeRDPRelay(async () => { throw new Error('SSH forwarding is disabled for this account') })
    t.after(relay.close)
    const socket = connect(relay.port, '127.0.0.1')
    socket.on('error', () => {})
    socket.write(relay.token)
    await once(socket, 'close')
    assert.equal(relay.failure?.message, 'SSH forwarding is disabled for this account')
})
for (const mode of ['without-nla', 'certificate-tls', 'certificate-nla', 'trusted-certificate', 'wrong-name'] as const) {
    test(`native helper refuses ${mode} before sending credentials and can be cancelled`, { skip: !native, timeout: 12000 }, async t => {
        const cert = selfSigned('native.test', 'subjectAltName=DNS:native.test')
        if (!cert) { t.skip('openssl is unavailable'); return }
        const sockets = new Set<any>()
        const requests: Buffer[] = [], application: Buffer[] = []
        const server = createServer(socket => {
            sockets.add(socket); socket.on('error', () => {})
            let request = Buffer.alloc(0)
            const receive = (data: Buffer) => {
                request = Buffer.concat([request, data])
                if (request.length < 4 || request.length < request.readUInt16BE(2)) return
                socket.removeListener('data', receive)
                requests.push(request)
                const response = Buffer.from('030000130ed000000000000200080001000000', 'hex')
                if (mode === 'certificate-nla') response[15] = 2
                socket.write(response)
                const tls = new TLSSocket(socket, { isServer: true, secureContext: createSecureContext({ key: cert.key, cert: cert.cert }) })
                sockets.add(tls); tls.on('error', () => {})
                tls.on('data', data => application.push(Buffer.from(data)))
            }
            socket.on('data', receive)
        })
        server.listen(0, '127.0.0.1'); await once(server, 'listening')
        const process = new FreeRDPProcess()
        t.after(() => { process.shutdown(); for (const socket of sockets) socket.destroy(); server.close() })
        let checked = false, withoutNla = 0, observedValid: boolean | undefined
        await assert.rejects(process.connect({
            host: mode === 'wrong-name' ? 'other.test' : 'native.test', username: 'private-test-username', password: 'private-test-password', domain: 'PRIVATE', width: 800, height: 600, pipeline: false,
            ...mode === 'trusted-certificate' || mode === 'wrong-name' ? { authorities: [cert.cert.toString()] } : {},
            open: async () => {
                const socket = connect((server.address() as any).port, '127.0.0.1'); await once(socket, 'connect')
                // Pointer/key activity while connecting must never be consumed as the certificate/NLA answer.
                process.send('M', numbers(0x0800, 10, 20)); process.send('K', numbers(0, 0x1e, 0))
                return socket
            },
            certificate: (_fp: string, valid: boolean) => { checked = true; observedValid = valid; throw new Error('reject test certificate') },
            withoutNla: () => { withoutNla++; if (mode === 'without-nla') throw new Error('reject TLS sign-in') },
            frame: () => { throw new Error('not connected') },
        }), /FreeRDP/)
        assert.equal(checked, mode !== 'without-nla')
        if (checked) assert.equal(observedValid, mode === 'trusted-certificate', 'trust anchors and the destination name are both verified')
        assert.equal(withoutNla, mode === 'certificate-nla' ? 0 : 1)
        assert.ok(requests.length)
        assert.ok(requests.every(r => !r.includes(Buffer.from('private-test-username')) && !r.includes(Buffer.from('PRIVATE'))))
        assert.equal(application.length, 0, 'no CredSSP or RDP credentials reach the rejected peer')
    })
}

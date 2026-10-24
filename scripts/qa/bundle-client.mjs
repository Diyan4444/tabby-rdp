// Build a transferable client installation without copying credentials, profiles or the whole checkout.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
execFileSync(process.execPath, ['node_modules/typescript/bin/tsc', '-p', 'tsconfig.json'], { cwd: root, stdio: 'inherit' })
fs.mkdirSync(path.join(root, '.qa'), { recursive: true })
const out = fs.mkdtempSync(path.join(root, '.qa/client-install-'))
const plugin = path.join(out, 'client-bundle')
fs.mkdirSync(path.join(plugin, 'node_modules'), { recursive: true })
// Exercise the distributable manifest, metadata and native executable modes, just as npm installation does.
execFileSync(process.execPath, [path.join(root, 'scripts/pack.mjs'), '--pack-destination', out], { cwd: root, stdio: ['ignore', 'pipe', 'inherit'] })
const packages = fs.readdirSync(out).filter(name => name.endsWith('.tgz'))
if (packages.length !== 1) throw new Error('Expected one packed plugin')
const packed = path.join(out, packages[0])
execFileSync('tar', ['-xzf', packed, '-C', plugin, '--strip-components=1'])
fs.rmSync(packed)
for (const file of ['node_modules/semver', 'node_modules/ws']) {
    fs.cpSync(path.join(root, file), path.join(plugin, file), { recursive: true, filter: source => !source.endsWith('.map') })
}
for (const file of ['scripts/qa/client.mjs', 'test/fixtures/smoke-credentials.cjs']) {
    fs.mkdirSync(path.dirname(path.join(out, file)), { recursive: true })
    fs.copyFileSync(path.join(root, file), path.join(out, file))
}
console.log(out)

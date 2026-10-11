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
for (const file of ['dist', 'vendor', 'remote', 'package.json', 'node_modules/semver', 'node_modules/ws']) {
    fs.cpSync(path.join(root, file), path.join(plugin, file), { recursive: true, filter: source => !source.endsWith('.map') })
}
for (const file of ['scripts/qa/client.mjs', 'test/fixtures/smoke-credentials.cjs']) {
    fs.mkdirSync(path.dirname(path.join(out, file)), { recursive: true })
    fs.copyFileSync(path.join(root, file), path.join(out, file))
}
console.log(out)

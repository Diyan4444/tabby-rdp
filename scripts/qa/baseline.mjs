// Local-only, explicit baseline updates. Review and commit PNG changes; the dashboard cannot invoke this command.
import fs from 'node:fs'
import { catalog } from './store.mjs'
import { targetEnvironment, missingSettings, validateTargets } from './matrix.mjs'
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
const selected = process.argv[2] || 'visual-host'
const entry = catalog.find(item => item.id === selected)
if (!entry) throw new Error('Unknown visual test')
const targets = process.env.TRD_QA_TARGETS_FILE ? validateTargets(JSON.parse(fs.readFileSync(process.env.TRD_QA_TARGETS_FILE, 'utf8'))) : {}
const env = targetEnvironment(entry, process.env, targets)
const missing = missingSettings(entry, process.env, targets)
if (missing.length) throw new Error('Missing: ' + missing.join(', '))
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
for (const args of [
    ['node_modules/typescript/bin/tsc', '-p', 'tsconfig.json'],
    ['--import', 'tsx', 'test/run.ts', '--hidden', ...(env.TRD_TEST_CLIENT_CDP_PORT ? ['--port', env.TRD_TEST_CLIENT_CDP_PORT] : []), entry.suite || selected],
]) {
    const result = spawnSync(process.execPath, args, { cwd: root, env: { ...env, TRD_QA_UPDATE_BASELINES: '1' }, stdio: 'inherit' })
    if (result.status !== 0) process.exit(result.status || 1)
}
console.log('Review test/visual/baselines and commit accepted PNG changes with the reason for the update.')

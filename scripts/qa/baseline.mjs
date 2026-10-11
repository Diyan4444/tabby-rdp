// Local-only, explicit baseline updates. Review and commit PNG changes; the dashboard cannot invoke this command.
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
const selected = process.argv[2] || 'visual-host'
if (!['visual-host', 'visual-linux', 'visual-windows'].includes(selected)) throw new Error('Unknown visual test')
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
for (const args of [
    ['node_modules/typescript/bin/tsc', '-p', 'tsconfig.json'],
    ['--import', 'tsx', 'test/run.ts', '--hidden', selected],
]) {
    const result = spawnSync(process.execPath, args, { cwd: root, env: { ...process.env, TRD_QA_UPDATE_BASELINES: '1' }, stdio: 'inherit' })
    if (result.status !== 0) process.exit(result.status || 1)
}
console.log('Review test/visual/baselines and commit accepted PNG changes with the reason for the update.')

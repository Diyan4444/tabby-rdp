import { defineConfig } from '@playwright/test'
import path from 'node:path'

const output = path.resolve(process.env.TRD_QA_RUN_DIR || '.qa/local')
export default defineConfig({
    testDir: '.',
    testMatch: 'host.spec.ts',
    outputDir: path.join(output, 'artifacts'),
    workers: 1,
    retries: 0,
    timeout: 90_000,
    // Missing baselines fail too. Only the explicit local baseline command can write them.
    updateSnapshots: process.env.TRD_QA_UPDATE_BASELINES === '1' ? 'all' : 'none',
    snapshotPathTemplate: '{testDir}/baselines/{arg}{ext}',
    expect: { timeout: 10_000, toHaveScreenshot: { animations: 'disabled', caret: 'hide', scale: 'css', maxDiffPixels: 0 } },
    reporter: [
        ['list'],
        ['./reporter.ts'],
        ['html', { outputFolder: path.join(output, 'report'), open: 'never' }],
    ],
})

import type { Reporter, TestCase, TestResult, FullResult } from '@playwright/test/reporter'
import fs from 'node:fs'
import path from 'node:path'

/** Small machine-readable index; Playwright's HTML report owns detailed steps and comparisons. */
export default class QAReporter implements Reporter {
    private tests: unknown[] = []
    private errors: string[] = []
    onTestEnd (test: TestCase, result: TestResult) {
        this.tests.push({
            title: test.title, status: result.status !== 'passed' && test.annotations.some(a => a.type === 'infrastructure') ? 'infrastructure-failed' : result.status, durationMs: result.duration,
            errors: result.errors.map(e => e.message),
            attachments: result.attachments.map((a, index) => {
                const directory = path.join(this.directory(), 'evidence')
                fs.mkdirSync(directory, { recursive: true })
                const ext = a.contentType === 'image/png' ? '.png' : a.contentType === 'application/zip' ? '.zip' : a.contentType.startsWith('text/') ? '.log' : '.json'
                const file = path.join(directory, `${index}-${a.name.replace(/[^a-zA-Z0-9.-]/g, '_')}${ext}`)
                if (a.path) fs.copyFileSync(a.path, file)
                else if (a.body) fs.writeFileSync(file, a.body)
                else return null
                return { name: a.name, contentType: a.contentType, path: path.relative(this.directory(), file) }
            }).filter(Boolean),
        })
    }
    onError (error: { message?: string }) { this.errors.push(error.message || 'Runner error') }
    directory () { return path.resolve(process.env.TRD_QA_RUN_DIR || '.qa/local') }
    onEnd (result: FullResult) {
        fs.mkdirSync(this.directory(), { recursive: true })
        const file = path.join(this.directory(), 'results.json')
        fs.writeFileSync(file + '.tmp', JSON.stringify({ status: result.status, tests: this.tests, errors: this.errors }, null, 2))
        fs.renameSync(file + '.tmp', file)
    }
}

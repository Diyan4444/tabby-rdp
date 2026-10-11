import fs from 'node:fs'
import path from 'node:path'

// Windows npm is a command script, which execFile cannot launch. Invoke its CLI
// with Node directly so paths stay argument values rather than shell commands.
export function npmCommand () {
    if (process.platform !== 'win32') return { file: 'npm', args: [] }
    const cli = process.env.npm_execpath ?? path.join(path.dirname(process.execPath), 'node_modules/npm/bin/npm-cli.js')
    if (!fs.existsSync(cli)) throw new Error('Cannot locate npm CLI; run this command through npm run or npm exec')
    return { file: process.execPath, args: [cli] }
}

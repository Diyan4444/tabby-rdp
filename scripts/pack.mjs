#!/usr/bin/env node
// Stage npm's selected files, replace only the deterministic metadata files (package.json; format 1 also its shrinkwrap),
// and pack with lifecycle scripts disabled. The source checkout is never mutated.
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'
import { runtimeMetadata } from './package-metadata.mjs'
import { npmCommand } from './npm-command.mjs'
const npm = npmCommand()

const root = path.resolve(fileURLToPath(new URL('..', import.meta.url)))
let destination = process.cwd()
let dryRun = false
const args = process.argv.slice(2)
while (args.length) {
    const arg = args.shift()
    if (arg === '--pack-destination' && args.length) destination = path.resolve(args.shift())
    else if (arg === '--dry-run') dryRun = true
    else throw new Error(`Unknown or incomplete pack argument: ${arg}`)
}
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))
// The committed lock: format 1's shrinkwrap (published, projected), later formats' package-lock.json (never published).
const lockFile = manifest.tabbyRdp?.packageFormat === 1 ? 'npm-shrinkwrap.json' : 'package-lock.json'
const metadata = runtimeMetadata(manifest, JSON.parse(fs.readFileSync(path.join(root, lockFile), 'utf8')))
const stage = fs.mkdtempSync(path.join(os.tmpdir(), 'tabby-rdp-package-'))
try {
    const [selection] = JSON.parse(execFileSync(npm.file, [...npm.args, 'pack', '--dry-run', '--ignore-scripts', '--json'],
        { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] }))
    for (const { path: name } of selection.files) {
        const source = path.resolve(root, name)
        if (!source.startsWith(root + path.sep) || !fs.lstatSync(source).isFile()) {
            throw new Error(`Package entry is not a plain file inside the checkout: ${name}`)
        }
        const target = path.join(stage, name)
        fs.mkdirSync(path.dirname(target), { recursive: true })
        // Preserve executable helpers when staging: writeFileSync's default mode would make the native RDP client
        // non-executable in the tarball even though it works from the source checkout.
        fs.writeFileSync(target, metadata[name] ?? fs.readFileSync(source), { mode: fs.statSync(source).mode & 0o777 })
    }
    for (const [name, data] of Object.entries(metadata)) fs.writeFileSync(path.join(stage, name), data)
    fs.mkdirSync(destination, { recursive: true })
    const [packed] = JSON.parse(execFileSync(npm.file, [...npm.args, 'pack', '--ignore-scripts', '--json',
        '--pack-destination', destination, ...(dryRun ? ['--dry-run'] : [])],
    { cwd: stage, encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] }))
    if (dryRun) for (const file of packed.files) console.log(` ${file.path}`)
    else console.log(packed.filename)
} finally {
    fs.rmSync(stage, { recursive: true, force: true })
}

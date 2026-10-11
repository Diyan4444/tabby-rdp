// Pinned official Tabby assets for disposable GitHub-hosted machines only.
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { execFileSync } from 'node:child_process'
import { sha } from './ai.mjs'
const assets = {
    'darwin-arm64': ['macos-arm64.zip','e98ca6dc69388317a3d33d1a90f575698c767bf3b75440e1b4fbc66a1ff6c0f8'],
    'linux-x64': ['linux-x64.tar.gz','852d788b0914c18c19d067529b92eb7c2be5754b797878f1df825f7089744bb1'],
    'win32-x64': ['portable-x64.zip','6971c3efc316ecad575f4a9c0910074ad9915fd9e6bcceb58f8abfc9ecd440e2'],
}
if(process.env.GITHUB_ACTIONS !== 'true' || !process.env.RUNNER_TEMP || !process.env.GITHUB_ENV) throw new Error('Installer is restricted to disposable Actions runners')
const asset=assets[`${os.platform()}-${os.arch()}`]
if(!asset)throw new Error('Unqualified hosted architecture')
const directory=fs.mkdtempSync(path.join(process.env.RUNNER_TEMP,'tabby-qa-'))
const file=path.join(directory,asset[0])
const response=await fetch(`https://github.com/Eugeny/tabby/releases/download/v1.0.236/tabby-1.0.236-${asset[0]}`,{signal:AbortSignal.timeout(120000)})
if(!response.ok)throw new Error('Tabby asset download failed')
const bytes=Buffer.from(await response.arrayBuffer())
if(sha(bytes)!==asset[1])throw new Error('Tabby asset checksum mismatch')
fs.writeFileSync(file,bytes)
if(process.platform==='darwin')execFileSync('ditto',['-x','-k',file,directory])
else if(process.platform==='win32')execFileSync('tar',['-xf',file,'-C',directory])
else execFileSync('tar',['-xzf',file,'-C',directory])
const find = folder => fs.readdirSync(folder,{withFileTypes:true}).flatMap(d=>d.isDirectory()?find(path.join(folder,d.name)):d.isFile()?[path.join(folder,d.name)]:[])
const executable=find(directory).find(f=>process.platform==='darwin'?f.endsWith('/Tabby.app/Contents/MacOS/Tabby'):path.basename(f)===(process.platform==='win32'?'Tabby.exe':'tabby'))
if(!executable)throw new Error('Tabby executable missing from verified archive')
fs.appendFileSync(process.env.GITHUB_ENV,`TABBY_BIN=${executable}\nTRD_QA_RUN_DIR=${path.join(process.env.RUNNER_TEMP,'tabby-qa-evidence')}\n`)
console.log(`Installed official Tabby 1.0.236 (${process.platform}/${process.arch}); SHA-256 verified`)

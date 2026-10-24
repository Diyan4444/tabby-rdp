// Explicit development build; never runs on plugin install. No credentials or runtime downloads.
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const manifest = JSON.parse(readFileSync(join(root, 'native/freerdp-source.json')))
const args = process.argv.slice(2)
const prefixIndex = args.indexOf('--openssl-prefix')
let openssl = prefixIndex >= 0 ? args.splice(prefixIndex, 2)[1] : process.env.OPENSSL_ROOT_DIR
const run = (file, args, options = {}) => execFileSync(file, args, { cwd: root, stdio: 'inherit', ...options })
const output = (file, args) => execFileSync(file, args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
if (!openssl && process.platform === 'darwin') openssl = output('brew', ['--prefix', 'openssl@3'])
if (!openssl) throw new Error('Pass --openssl-prefix <OpenSSL 3 installation>, including its license text')
openssl = resolve(openssl)
const opensslLicense = ['LICENSE.txt', 'LICENSE', 'share/openssl/copyright', 'share/doc/openssl/copyright'].map(p => join(openssl, p)).find(existsSync)
if (!opensslLicense) throw new Error('The OpenSSL installation must include its license text')
const work = join(root, '.qa', 'freerdp-build')
const archive = join(work, `freerdp-${manifest.version}.tgz`)
const source = join(work, `FreeRDP-${manifest.version}`)
const build = join(work, 'build')
mkdirSync(work, { recursive: true })
if (!existsSync(archive)) {
    const response = await fetch(manifest.url)
    if (!response.ok) throw new Error(`FreeRDP source download failed (${response.status})`)
    writeFileSync(archive, Buffer.from(await response.arrayBuffer()))
}
if (createHash('sha256').update(readFileSync(archive)).digest('hex') !== manifest.sha256) throw new Error('FreeRDP source checksum mismatch')
// Re-extract the verified source on every build, so stale local source edits cannot enter the artifact.
rmSync(source, { recursive: true, force: true })
run('cmake', ['-E', 'tar', 'xzf', archive], { cwd: work })
run('cmake', ['-S', join(root, 'native'), '-B', build, '-DCMAKE_BUILD_TYPE=Release', `-DOPENSSL_ROOT_DIR=${openssl}`, `-DFREERDP_SOURCE_DIR=${source}`, ...args])
run('cmake', ['--build', build, '--config', 'Release', '--parallel', '8', '--target', 'tabby-freerdp'])

function walk(dir) {
    return readdirSync(dir, { withFileTypes: true }).flatMap(e => e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)])
}
const files = walk(build)
const executable = `tabby-freerdp${process.platform === 'win32' ? '.exe' : ''}`
const binary = files.find(p => basename(p) === executable)
if (!binary) throw new Error('CMake did not produce the helper')
const destination = join(root, 'native/bin', `${process.platform}-${process.arch}`)
const stage = join(work, 'stage', `${process.platform}-${process.arch}`)
rmSync(stage, { recursive: true, force: true })
mkdirSync(join(stage, 'licenses'), { recursive: true })
copyFileSync(binary, join(stage, executable))
copyFileSync(join(source, 'LICENSE'), join(stage, 'licenses/FreeRDP-LICENSE'))
copyFileSync(join(source, 'winpr/libwinpr/sysinfo/cpufeatures/NOTICE'), join(stage, 'licenses/FreeRDP-NOTICE'))
copyFileSync(opensslLicense, join(stage, 'licenses/OpenSSL-LICENSE'))
writeFileSync(join(stage, 'licenses/NOTICE'), `This helper uses FreeRDP and WinPR ${manifest.version} (Apache-2.0), https://www.freerdp.com/, and OpenSSL 3 (Apache-2.0), https://www.openssl.org/.\nOriginal license and notice texts accompany this file. The Tabby helper itself is MIT licensed.\n`)
const dependencies = new Map()
const byName = new Map(files.map(p => [basename(p), p]))
for (const dir of [join(openssl, 'lib'), join(openssl, 'bin')]) {
    if (existsSync(dir)) for (const p of walk(dir)) byName.set(basename(p), p)
}
// NTLM needs MD4/RC4 from OpenSSL's legacy provider. This is loaded at runtime and does not appear in otool/ldd.
const providerName = `legacy.${process.platform === 'darwin' ? 'dylib' : process.platform === 'win32' ? 'dll' : 'so'}`
const provider = byName.get(providerName)
if (!provider) throw new Error('OpenSSL must include its legacy provider for Windows NTLM authentication')
copyFileSync(realpathSync(provider), join(stage, providerName))
dependencies.set(providerName, provider)
const allowed = name => name === providerName || /^(?:lib)?(?:freerdp(?:-client)?3|winpr3|ssl|crypto)[-.\d_a-z]*(?:\.dylib|\.so(?:\.\d+)*|\.dll)$/i.test(name)
if (process.platform === 'darwin') {
    const pending = [binary, provider]
    for (let i = 0; i < pending.length; i++) {
        const file = pending[i]
        const target = join(stage, basename(file))
        const deps = output('otool', ['-L', file]).split('\n').slice(1).map(line => line.trim().split(' (')[0])
        for (const dep of deps) {
            if (dep.startsWith('/usr/lib/') || dep.startsWith('/System/Library/')) continue
            const name = basename(dep)
            if (!allowed(name)) throw new Error(`Unreviewed native dependency: ${name}`)
            const found = byName.get(name) ?? (existsSync(dep) ? dep : undefined)
            if (!found) throw new Error(`Cannot locate ${dep}`)
            if (!dependencies.has(name)) {
                dependencies.set(name, found)
                copyFileSync(realpathSync(found), join(stage, name))
                pending.push(found)
            }
            run('install_name_tool', ['-change', dep, `@loader_path/${name}`, target])
        }
        if (file !== binary && file !== provider) run('install_name_tool', ['-id', `@loader_path/${basename(file)}`, target])
    }
    for (const file of [...dependencies.keys(), executable]) run('codesign', ['--force', '--sign', '-', join(stage, file)])
} else if (process.platform === 'linux') {
    // Keep libc and the target distro's system libraries, bundle FreeRDP/WinPR/OpenSSL beside the helper.
    const pending = [binary, provider]
    for (let i = 0; i < pending.length; i++) {
        for (const line of output('ldd', [pending[i]]).split('\n')) {
            if (/=> not found/.test(line)) throw new Error(`Missing native dependency: ${line.trim()}`)
            const match = /^\s*(\S+) => (\/\S+)/.exec(line)
            if (!match) continue
            if (!allowed(match[1])) {
                if (!/^lib(?:c|m|pthread|dl|rt|z|resolv|anl|util|gcc_s)\.so(?:\.|$)/.test(match[1])) throw new Error(`Unreviewed native dependency: ${match[1]}`)
                continue
            }
            if (!dependencies.has(match[1])) { dependencies.set(match[1], match[2]); copyFileSync(realpathSync(match[2]), join(stage, match[1])); pending.push(match[2]) }
        }
    }
    for (const file of [...dependencies.keys(), executable]) run('patchelf', ['--set-rpath', '$ORIGIN', join(stage, file)])
} else if (process.platform === 'win32') {
    // MSVC's dependency inventory also catches a build that accidentally links an unreviewed codec DLL.
    const pending = [binary, provider]
    for (let i = 0; i < pending.length; i++) {
        for (const line of output('dumpbin', ['/DEPENDENTS', pending[i]]).split('\n')) {
            const name = /^\s+([^\s]+\.dll)\s*$/i.exec(line)?.[1]
            const systemRoot = process.env.SystemRoot || process.env.WINDIR
            if (name && systemRoot && existsSync(join(systemRoot, 'System32', name))) continue
            if (!name || /^(?:api-ms-|ext-ms-|kernel32|user32|gdi32|advapi32|shell32|ole32|oleaut32|ws2_32|crypt32|secur32|ncrypt|bcrypt|normaliz|rpcrt4|version|winmm|msvcrt|vcruntime\d+|ucrtbase)/i.test(name)) continue
            if (!allowed(name)) throw new Error(`Unreviewed native dependency: ${name}`)
            const found = [...byName].find(([key]) => key.toLowerCase() === name.toLowerCase())?.[1]
            if (!found) throw new Error(`Cannot locate ${name}`)
            if (!dependencies.has(name)) { dependencies.set(name, found); copyFileSync(found, join(stage, name)); pending.push(found) }
        }
    }
} else throw new Error(`Unsupported native platform: ${process.platform}`)
const version = output(join(stage, executable), ['--version'])
const artifacts = walk(stage).map(p => ({ path: p.slice(stage.length + 1).replaceAll('\\', '/'), sha256: createHash('sha256').update(readFileSync(p)).digest('hex') }))
const buildSources = Object.fromEntries(['native/main.c', 'native/options.cmake', 'native/CMakeLists.txt', 'scripts/build-freerdp.mjs',
    'native/openssl-source.json', 'scripts/build-freerdp-ci.mjs'].map(p =>
    [p, createHash('sha256').update(readFileSync(join(root, p))).digest('hex')]))
const opensslSource = join(openssl, 'tabby-source.json')
writeFileSync(join(stage, 'BUILD.json'), JSON.stringify({ source: manifest,
    opensslSource: existsSync(opensslSource) ? JSON.parse(readFileSync(opensslSource)) : null,
    version, platform: process.platform, arch: process.arch, buildSources, files: artifacts }, null, 2) + '\n')
rmSync(destination, { recursive: true, force: true })
mkdirSync(dirname(destination), { recursive: true })
renameSync(stage, destination)
console.log(`Built ${destination}: ${version}`)

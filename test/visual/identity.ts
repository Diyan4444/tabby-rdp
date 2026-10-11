import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { expect } from '@playwright/test'
import { runtimeMetadata } from '../../scripts/package-metadata.mjs'

export interface ClientIdentity { platform: string, arch: string, release: string, pluginSha256: string }

/** Read the actual Tabby process, even when the test driver is on another OS. */
export async function clientIdentity (ev: (script: string) => Promise<unknown>): Promise<ClientIdentity> {
    const actual = await ev('return {platform:process.platform,arch:process.arch,release:require("os").release()}') as Omit<ClientIdentity, 'pluginSha256'>
    if (process.env.TRD_TEST_EXPECT_CLIENT) expect(actual.platform, 'Actual native Tabby client OS').toBe(process.env.TRD_TEST_EXPECT_CLIENT)
    // A remote CDP session must exercise this checkout's built plugin, not yesterday's installation.
    const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
    const files: string[] = ['package.json']
    const metadata = process.env.TRD_TEST_PACKED === '1'
        ? runtimeMetadata(JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')),
            JSON.parse(fs.readFileSync(path.join(root, 'npm-shrinkwrap.json'), 'utf8'))) : null
    if (metadata) files.push('npm-shrinkwrap.json')
    const walk = (dir: string) => { for (const entry of fs.readdirSync(path.join(root, dir), { withFileTypes: true })) {
        const file = `${dir}/${entry.name}`
        if (entry.isDirectory()) walk(file)
        else if (!file.endsWith('.map')) files.push(file)
    } }
    for (const directory of ['dist', 'remote', 'vendor']) walk(directory)
    files.sort()
    const hash = crypto.createHash('sha256')
    for (const file of files) {
        hash.update(file)
        hash.update(metadata && file in metadata ? metadata[file as keyof typeof metadata] : fs.readFileSync(path.join(root, file)))
    }
    const expected = hash.digest('hex')
    const digest = await ev(`const fs=require('fs'),p=require('path'),root=p.join(process.env.TABBY_CONFIG_DIRECTORY,'plugins','node_modules','tabby-rdp'),h=require('crypto').createHash('sha256');
        for(const f of ${JSON.stringify(files)}) {h.update(f);h.update(fs.readFileSync(p.join(root,f)))} return h.digest('hex')`)
    expect(digest, 'Actual client plugin bytes match the tested checkout').toBe(expected)
    return { ...actual, pluginSha256: digest as string }
}

export const kdeEncoderPatch = crypto.createHash('sha256').update(fs.readFileSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../testbed/linux/kpipewire-krdp-color.patch'))).digest('hex')
export const kdeFreerdpPatch = crypto.createHash('sha256').update(fs.readFileSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../testbed/linux/krdp-freerdp-compat.patch'))).digest('hex')

interface LibraryReceipt { sourceCommit: string, patchSha256: string, librarySha256: string, loadedLibrarySha256: string }

export function verifyLinuxIdentity (actual: { os: string, version: string, point: string, gnome?: string, grd?: string, xfce?: string, xrdp?: string, xorgxrdp?: string, plasma?: string, kwin?: string, krdp?: string, pipewire?: string, session?: string, freerdp?: string, loadedFreerdp?: string, encoder?: LibraryReceipt, server?: LibraryReceipt }) {
    for (const [field, setting] of [['os', 'OS'], ['version', 'VERSION'], ['point', 'POINT']] as const) {
        const expected = process.env[`TRD_TEST_EXPECT_${setting}`]
        if (expected) expect(actual[field], `Actual remote ${field}`).toBe(expected)
    }
    if (process.env.TRD_TEST_EXPECT_GNOME) {
        expect(actual.gnome?.match(/\b(\d+)\./)?.[1], 'Actual GNOME Shell major').toBe(process.env.TRD_TEST_EXPECT_GNOME)
        expect(actual.grd?.match(/\b(\d+)\./)?.[1], 'Actual GNOME Remote Desktop major').toBe(process.env.TRD_TEST_EXPECT_GNOME)
    }
    if (process.env.TRD_TEST_EXPECT_STACK === 'xrdp') {
        expect(actual.xfce, 'Installed Xfce session').toMatch(/^4\./)
        expect(actual.xorgxrdp, 'Installed xorgxrdp backend').toMatch(/^\d+\.\d+/)
        const version = actual.xrdp?.match(/^(\d+)\.(\d+)/)
        expect(!!version && (Number(version[1]) > 0 || Number(version[2]) >= 10), 'xrdp 0.10+ required for live resize').toBe(true)
    }
    if (process.env.TRD_TEST_EXPECT_STACK === 'krdp') {
        for (const field of ['plasma', 'kwin', 'krdp'] as const) expect(actual[field], `Installed KDE ${field}`).toMatch(/^6\.7\./)
        expect(actual.pipewire, 'Installed PipeWire').toMatch(/^1\./)
        expect(actual.session, 'Actual Plasma session uses Wayland').toBe('wayland')
        expect(actual.freerdp, 'Qualified FreeRDP dependency').toBe('3.32.1')
        expect(actual.loadedFreerdp, 'Actual mapped FreeRDP dependency').toBe(actual.freerdp)
        expect(actual.server?.sourceCommit, 'Private KRDP upstream revision').toBe('270dcf01851229134f74fa7d90ac338ec788ec67')
        expect(actual.server?.patchSha256, 'Private KRDP uses the reviewed compatibility patch').toBe(kdeFreerdpPatch)
        expect(actual.server?.librarySha256, 'Recorded KRDP binary digest').toMatch(/^[a-f0-9]{64}$/)
        expect(actual.server?.loadedLibrarySha256, 'Actual loaded KRDP bytes match the build receipt').toBe(actual.server?.librarySha256)
        expect(actual.encoder?.sourceCommit, 'Private encoder upstream revision').toBe('6318082fe449b50e701abc4d91308c2371cf8741')
        expect(actual.encoder?.patchSha256, 'Private encoder uses the reviewed color patch').toBe(kdeEncoderPatch)
        expect(actual.encoder?.librarySha256, 'Recorded encoder binary digest').toMatch(/^[a-f0-9]{64}$/)
        expect(actual.encoder?.loadedLibrarySha256, 'Actual loaded encoder bytes match the build receipt').toBe(actual.encoder?.librarySha256)
    }
}

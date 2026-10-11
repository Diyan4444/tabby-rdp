import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { expect } from '@playwright/test'

export interface ClientIdentity { platform: string, arch: string, release: string, pluginSha256: string }

/** Read the actual Tabby process, even when the test driver is on another OS. */
export async function clientIdentity (ev: (script: string) => Promise<unknown>): Promise<ClientIdentity> {
    const actual = await ev('return {platform:process.platform,arch:process.arch,release:require("os").release()}') as Omit<ClientIdentity, 'pluginSha256'>
    if (process.env.TRD_TEST_EXPECT_CLIENT) expect(actual.platform, 'Actual native Tabby client OS').toBe(process.env.TRD_TEST_EXPECT_CLIENT)
    // A remote CDP session must exercise this checkout's built plugin, not yesterday's installation.
    const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
    const files: string[] = ['package.json']
    const walk = (dir: string) => { for (const entry of fs.readdirSync(path.join(root, dir), { withFileTypes: true })) {
        const file = `${dir}/${entry.name}`
        if (entry.isDirectory()) walk(file)
        else if (!file.endsWith('.map')) files.push(file)
    } }
    for (const directory of ['dist', 'remote', 'vendor']) walk(directory)
    files.sort()
    const hash = crypto.createHash('sha256')
    for (const file of files) { hash.update(file); hash.update(fs.readFileSync(path.join(root, file))) }
    const expected = hash.digest('hex')
    const digest = await ev(`const fs=require('fs'),p=require('path'),root=p.join(process.env.TABBY_CONFIG_DIRECTORY,'plugins','node_modules','tabby-rdp'),h=require('crypto').createHash('sha256');
        for(const f of ${JSON.stringify(files)}) {h.update(f);h.update(fs.readFileSync(p.join(root,f)))} return h.digest('hex')`)
    expect(digest, 'Actual client plugin bytes match the tested checkout').toBe(expected)
    return { ...actual, pluginSha256: digest as string }
}

export function verifyLinuxIdentity (actual: { os: string, version: string, point: string, gnome?: string, grd?: string, xfce?: string, xrdp?: string, xorgxrdp?: string }) {
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
}

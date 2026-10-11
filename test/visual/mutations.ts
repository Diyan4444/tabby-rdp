import { expect, type TestInfo } from '@playwright/test'
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { preserveColorProfile } from './png.js'

// Reuse the PNG codec already pinned with Playwright; no second image dependency.
const require = createRequire(import.meta.url)
const { PNG } = require(path.join(path.dirname(require.resolve('playwright-core/package.json')), 'lib/utilsBundle.js'))
type Choice = { id: string, layer: string, category: string, value: number, seed: null, expectedFailure: string }
type Detector = { id: string, failed: boolean, message?: string }
type Trial = Record<string, unknown> & { id: string, control: boolean, complete: boolean, restored: boolean, detectors: Detector[] }
type Ev = (script: string) => Promise<unknown>

function difference(before: Buffer, after: Buffer) {
    const a = PNG.sync.read(before), b = PNG.sync.read(after)
    if (a.width !== b.width || a.height !== b.height) throw new Error('Capture dimensions changed; fixed viewport required')
    const diff = new PNG({ width: a.width, height: a.height })
    let changed = 0, left = a.width, top = a.height, right = 0, bottom = 0
    for (let i = 0; i < a.data.length; i += 4) {
        const delta = Math.max(...[0,1,2,3].map(c => Math.abs(a.data[i+c]-b.data[i+c])))
        if (delta > 8) { changed++; const x = i/4%a.width, y = Math.floor(i/4/a.width); left=Math.min(left,x); right=Math.max(right,x); top=Math.min(top,y); bottom=Math.max(bottom,y) }
        diff.data[i] = delta; diff.data[i+1] = delta ? 40 : 0; diff.data[i+2] = 0; diff.data[i+3] = 255
    }
    return { changedPixels: changed, bounds: changed ? { left, top, right, bottom } : null, png: PNG.sync.write(diff) as Buffer }
}

// Deliberately no choice, layer, expected outcome or mutation metadata in this interface.
// The screenshot comparator and assertFrame are the same technologies as normal RDP checkpoints.
async function detect(actual: Buffer, snapshot: string, frameAssertion: () => Promise<void>): Promise<Detector[]> {
    const results: Detector[] = []
    for (const [id, check] of [
        ['screenshot', async () => { expect(actual).toMatchSnapshot(snapshot, { maxDiffPixels: 0 }) }],
        ['frame-state', frameAssertion],
    ] as const) {
        try { await check(); results.push({ id, failed: false }) }
        catch (error) {
            if (!error || typeof error !== 'object' || !('matcherResult' in error)) throw error
            results.push({ id, failed: true, message: String(error).slice(0, 4000) })
        }
    }
    return results
}

export async function campaign(options: {
    info: TestInfo, capture: () => Promise<Buffer>, ev: Ev, snapshot: string,
    frameAssertion: () => Promise<void>, control: (value: object) => Promise<unknown>,
    sequence: () => Promise<number | undefined>, settle: () => Promise<void>,
}) {
    const { info, capture, ev, snapshot, frameAssertion, control, sequence, settle } = options
    const choices: Choice[] = JSON.parse(process.env.TRD_QA_MUTATIONS || '[]')
    if (!choices.length) return
    const expectedPath = info.snapshotPath(snapshot)
    if (!fs.existsSync(expectedPath)) throw new Error('Campaign requires an existing reviewed baseline')
    const reference = fs.readFileSync(expectedPath)
    const trials: Trial[] = []
    const save = () => fs.writeFileSync(path.join(process.env.TRD_QA_RUN_DIR!, 'mutation-results.json'), JSON.stringify({ version: 1, trials }, null, 2))
    const attach = async (name: string, png: Buffer) => info.attach(name, { body: png, contentType: 'image/png' })
    const restore = async () => {
        await ev('globalThis.__trdMutationRestore?.()')
        await control({ reset: true, mutation: '' })
        await expect.poll(sequence).toBe(0)
        await settle()
    }
    try {
        for (const choice of [null, ...choices, null]) {
            await restore()
            const before = await capture()
            const trial: Trial = { ...(choice || {}), id: choice?.id || (trials.length ? 'healthy-after' : 'healthy-before'), control: !choice,
                startedAt: new Date().toISOString(), complete: false, restored: false, detectors: [] }
            trials.push(trial); save()
            const prefix = `experiment-${trials.length}-${trial.id}`
            await attach(`${prefix}-before`, before)
            await attach(`${prefix}-expected`, reference)
            const started = performance.now()
            try {
                if (choice?.id === 'missing') {
                    await control({ mutation: 'missing' })
                    // Wait for observed pixels rather than treating command acknowledgement as manifestation.
                    await expect.poll(async () => difference(before, await capture()).changedPixels).toBeGreaterThan(100)
                } else if (choice && choice.id !== 'text') {
                    await ev(`const choice=${JSON.stringify(choice)};
                        const cv=H.canvasElement(H.pane), ctx=cv.getContext('2d');
                        const original=ctx.putImageData, saved=ctx.getImageData(0,0,cv.width,cv.height), style=cv.getAttribute('style');
                        let overlay=null, timer=null;
                        const restore=()=>{clearTimeout(timer);ctx.putImageData=original;original.call(ctx,saved,0,0);if(style===null)cv.removeAttribute('style');else cv.setAttribute('style',style);overlay?.remove();delete globalThis.__trdMutationRestore};
                        globalThis.__trdMutationRestore=restore;timer=setTimeout(restore,30000);
                        if(['crop','color','blank','freeze','stale'].includes(choice.id)){
                            ctx.putImageData=function(image,x,y){
                                if(choice.id==='freeze'||choice.id==='stale')return;
                                original.call(ctx,image,x,y);
                                if(choice.id==='crop'){ctx.fillStyle='#000';ctx.fillRect(cv.width-choice.value,0,choice.value,cv.height)}
                                if(choice.id==='blank'){ctx.fillStyle='#000';ctx.fillRect(0,0,cv.width,cv.height)}
                                if(choice.id==='color'){const d=ctx.getImageData(x,y,image.width,image.height);for(let i=0;i<d.data.length;i+=4){const r=d.data[i];d.data[i]=d.data[i+2];d.data[i+2]=r}original.call(ctx,d,x,y)}
                            };ctx.putImageData(saved,0,0);
                        }
                        if(['offset','alignment','scale','geometry'].includes(choice.id)){
                            cv.style.transformOrigin='0 0';cv.style.transform=choice.id==='scale'?'scale('+choice.value/100+')':choice.id==='geometry'?'scaleX('+choice.value/100+')':'translateX('+choice.value+'px)';
                        }
                        if(['overlay','dialog'].includes(choice.id)){
                            overlay=document.createElement('div');overlay.setAttribute('data-qa-mutation','');
                            overlay.style.cssText='position:absolute;z-index:9999;pointer-events:none;left:180px;top:160px;width:'+choice.value+'px;height:160px;background:#eee;color:#111;padding:24px;font:20px sans-serif;box-sizing:border-box;border:2px solid #555';
                            overlay.textContent=choice.id==='dialog'?'Tabby has closed unexpectedly. Send problem report?':'Unexpected opaque overlay';
                            cv.parentElement.append(overlay);
                        }`)
                    if (choice.id === 'freeze' || choice.id === 'stale') {
                        // Both start from an observed earlier frame. Freeze suppresses future blits;
                        // stale explicitly restores that earlier bitmap after the remote state advances.
                        await control({ advance: choice.value })
                        await expect.poll(sequence).toBe(choice.value)
                        if (choice.id === 'stale') await ev('const cv=H.canvasElement(H.pane); const restore=globalThis.__trdMutationRestore; restore(); const ctx=cv.getContext("2d"),old=ctx.getImageData(0,0,cv.width,cv.height),put=ctx.putImageData; ctx.putImageData=()=>{put.call(ctx,old,0,0)}; const timer=setTimeout(()=>globalThis.__trdMutationRestore?.(),30000); globalThis.__trdMutationRestore=()=>{clearTimeout(timer);ctx.putImageData=put;delete globalThis.__trdMutationRestore}; put.call(ctx,old,0,0)')
                    }
                }
                // Fixed viewport capture preserves frontend displacement/clipping, unlike an element
                // screenshot which can follow a translated/scaled bounding box and hide the defect.
                let actual = await capture()
                if (choice?.id === 'text') {
                    const png = PNG.sync.read(actual), size = choice.value
                    for(let y=36;y<110;y+=size) for(let x=60;x<700;x+=size) {
                        const source=(y*png.width+x)*4
                        for(let dy=0;dy<size;dy++) for(let dx=0;dx<size;dx++) {
                            const target=((y+dy)*png.width+x+dx)*4
                            png.data.copy(png.data,target,source,source+4)
                        }
                    }
                    actual=preserveColorProfile(actual, PNG.sync.write({ ...png, gamma: 0 }))
                }
                await attach(`${prefix}-actual`, actual)
                const delta = difference(before, actual)
                await attach(`${prefix}-manifestation-diff`, delta.png)
                const currentSequence = await sequence()
                const temporal = choice && ['freeze','stale'].includes(choice.id)
                let secondChangedPixels: number | null = null
                if (temporal) {
                    await new Promise(resolve=>setTimeout(resolve,250))
                    const second=await capture()
                    secondChangedPixels=difference(before,second).changedPixels
                    await attach(`${prefix}-temporal-second`,second)
                }
                if (typeof currentSequence !== 'number' || !await ev('return RD.desktop.isConnected(H.pane)')) throw new Error('Remote state/connection unavailable; not a detector result')
                const manifestation = { manifested: !!choice && (temporal ? currentSequence === choice.value && delta.changedPixels === 0 && secondChangedPixels === 0 : delta.changedPixels > 0),
                    changedPixels: delta.changedPixels, secondChangedPixels, bounds: delta.bounds, remoteSequence: currentSequence,
                    method: temporal ? 'Remote sequence advanced; displayed prior image remained unchanged' : 'Independent before/after visible RGBA difference (threshold 8); inspect bounds and images',
                    coverage: choice?.layer === 'screenshot-evaluator' ? 'Captured-image sensitivity only; not RDP rendering coverage' : 'Live real-RDP session' }
                trial.manifestation = manifestation
                // Evaluator receives pixels, baseline identity and an ordinary frame/state assertion only.
                trial.detectors = await detect(actual, snapshot, frameAssertion)
                if (!await ev('return RD.desktop.isConnected(H.pane)')) throw new Error('Connection lost during evaluation; experiment incomplete')
                trial.latencyMs = performance.now()-started
                trial.complete = true
                trial.classification = !choice ? (trial.detectors.some(d=>d.failed) ? 'false-positive' : 'healthy')
                    : !manifestation.manifested ? 'not-manifested' : trial.detectors.some(d=>d.failed) ? 'detected' : 'escaped'
            } finally {
                try {
                await restore()
                const restored = await capture()
                await attach(`${prefix}-restored`, restored)
                const checks = await detect(restored, snapshot, frameAssertion)
                trial.restored = checks.every(d=>!d.failed)
                trial.restorationDetectors = checks
                } finally { trial.finishedAt = new Date().toISOString(); save() }
                expect(trial.restored, 'Healthy baseline and decoded state restored after experiment').toBe(true)
            }
        }
    } finally {
        try { await restore() } finally {
            save()
            await info.attach('mutation-results', { body: JSON.stringify({ version: 1, trials }, null, 2), contentType: 'application/json' })
        }
    }
    expect(trials.filter(t=>t.control).every(t=>t.classification==='healthy'), 'Healthy controls stay healthy').toBe(true)
    expect(trials.filter(t=>!t.control).every(t=>t.classification==='detected'), 'Every requested defect manifests and is detected; inspect escapes/exclusions').toBe(true)
}

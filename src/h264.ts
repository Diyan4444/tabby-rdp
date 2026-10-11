/**
 * IronRDP's H.264 decoder for the graphics pipeline (its `WebCodecsH264Decoder`, patch 0008), held to a number of
 * surfaces (security review, finding 3).
 *
 * The decoder opens a browser `VideoDecoder` (a thread and its buffers, in Tabby's window) for each surface the server
 * sends a frame for, and closes none until the session ends: not when the server deletes the surface, nor when it
 * resets the graphics. It also opens one for a frame that isn't a key frame, which it can't start from. A server that
 * sends a key frame for each of thousands of surfaces has the window open as many decoders (2,000 took it from 10
 * threads to 2,011, and 135 MB to 963), and more would freeze it, with every tab in it.
 *
 * Wrapped here, rather than in the patch, so that it needs no `vendor/` rebuild:
 * - A surface the decoder hasn't opened gets a decoder only with a key frame. Other frames for it are dropped, as the
 *   decoder drops those it can't start from (their regions keep their pixels); a surface still without a key frame
 *   after the decoder's own stall time fails the decoder, as its watchdog would have, and the connection goes on
 *   without H.264 (see RemoteDesktopService). As many such surfaces are waited on as may be open: frames for further
 *   ones are dropped without being waited on, since dropping them keeps nothing (so those never fail the decoder).
 * - At most MAX_H264_SURFACES are open. A new one past that closes the one that has gone longest without a frame: a
 *   real desktop draws on one surface, two at most, and the others are the ones the server deleted or reset away, which
 *   the decoder never closes. Its frames still being decoded are dropped, and a frame for it later opens it again from
 *   a key frame. Should the decoder no longer keep its surfaces where this looks for them (another IronRDP), a new
 *   surface past the cap fails the decoder instead.
 *
 * Everything else goes to the decoder as it is, and `failed` and `reclaimed` are the decoder's: the connection reads
 * those as it ends (see RemoteDesktopService).
 */

/** Surfaces one decoder may have open at once (see the file's note). */
export const MAX_H264_SURFACES = 16

/** A frame, as IronRDP hands the decoder one (see patch 0008). */
interface H264Frame {
    id: number
    surfaceId: number
    keyFrame: boolean
}

type Done = (id: number, pixels: Uint8Array | null, error?: string) => void

/** What the decoder keeps of a surface it opened, as far as closing one goes (see patch 0008). */
interface OpenSurface {
    decoder: { state?: string, close (): void }
    pending: Map<number, { done: Done }>
}

export interface H264Decoder {
    readonly failed: string | null
    readonly reclaimed: boolean
    readonly stats: unknown
    decode (frame: H264Frame, done: Done): void
    close (): void
}

export function cappedH264Decoder (decoder: any, cap = MAX_H264_SURFACES): H264Decoder {
    const now: () => number = typeof decoder.now === 'function' ? () => decoder.now() : () => performance.now()
    const stallMs: number = typeof decoder.stallMs === 'number' ? decoder.stallMs : 3000
    // When each open surface last had a frame, oldest first (a Map keeps the order things were set in).
    const used = new Map<number, number>()
    // Since when each surface not open yet has had frames and no key frame: no more of them than of surfaces open.
    const waiting = new Map<number, number>()
    const surfaces = (): Map<number, OpenSurface> | null => decoder.surfaces instanceof Map ? decoder.surfaces : null

    const fail = (reason: string) => {
        if (typeof decoder.fail === 'function') {
            decoder.fail(reason)
        } else {
            decoder.close()
        }
    }

    /**
     * Closes the surface that has gone longest without a frame; false if the decoder's surfaces can't be reached, or
     * one isn't kept as this expects (its frames being decoded, its browser decoder): then the decoder fails (see the
     * file's note) rather than this throw into IronRDP's call, which would end the session as a decoding error, one the
     * connection doesn't reconnect without H.264 from.
     */
    const closeOldest = (): boolean => {
        const open = surfaces()
        const oldest = used.keys().next()
        if (!open || oldest.done) {
            return false
        }
        used.delete(oldest.value)
        const surface = open.get(oldest.value)
        if (!surface) {
            return true
        }
        open.delete(oldest.value)
        try {
            for (const [id, frame] of [...surface.pending]) {
                surface.pending.delete(id)
                if (decoder.stats) {
                    decoder.stats.pending--
                }
                frame.done(id, null)
            }
            if (surface.decoder.state !== 'closed') {
                surface.decoder.close()
            }
        } catch {
            return false
        }
        return true
    }

    return {
        get failed () { return decoder.failed ?? null },
        get reclaimed () { return !!decoder.reclaimed },
        /** The decoder's own counts (frames, latency), as the live suites read them. */
        get stats () { return decoder.stats },
        decode (frame: H264Frame, done: Done): void {
            if ((decoder.failed !== null && decoder.failed !== undefined) || decoder.closed) {
                decoder.decode(frame, done)
                return
            }
            const surface = frame.surfaceId
            const isOpen = surfaces()?.has(surface) ?? used.has(surface)
            if (!isOpen) {
                if (!frame.keyFrame) {
                    const since = waiting.get(surface) ?? now()
                    if (!waiting.has(surface) && waiting.size < cap) {
                        waiting.set(surface, since)
                    }
                    if (now() - since > stallMs) {
                        fail(`no key frame for surface ${surface} in ${Math.round(now() - since)} ms`)
                        decoder.decode(frame, done)
                        return
                    }
                    done(frame.id, null)
                    return
                }
                waiting.delete(surface)
                while ((surfaces()?.size ?? used.size) >= cap) {
                    if (!closeOldest()) {
                        fail(`the server drew on more than ${cap} surfaces`)
                        decoder.decode(frame, done)
                        return
                    }
                }
            }
            used.delete(surface)
            used.set(surface, now())
            decoder.decode(frame, done)
        },
        close (): void {
            decoder.close()
        },
    }
}

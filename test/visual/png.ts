/** Retain the capture's color interpretation when re-encoding pixel mutations.
 * pngjs emits pixel data but drops ICC/cICP metadata. The encoder must use gamma: 0
 * so the original color chunks below are the single authoritative profile.
 */
export function preserveColorProfile(original: Buffer, encoded: Buffer): Buffer {
    const profile: Buffer[] = []
    for (let offset = 8; offset < original.length;) {
        const length = original.readUInt32BE(offset)
        const type = original.toString('ascii', offset + 4, offset + 8)
        if (offset + length + 12 > original.length) throw new Error('Truncated PNG chunk')
        if (['iCCP', 'sRGB', 'gAMA', 'cHRM', 'cICP'].includes(type)) profile.push(original.subarray(offset, offset + length + 12))
        offset += length + 12
    }
    // Both inputs are validated PNGs from the existing capture/PNG codec; IHDR is 13 bytes.
    return Buffer.concat([encoded.subarray(0, 33), ...profile, encoded.subarray(33)])
}

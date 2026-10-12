// The built-in-only publication helper is also exercised by the TypeScript tests.
export const PACKAGE_FORMATS: number[]
export function runtimeMetadata (manifest: Record<string, unknown>, lock: Record<string, unknown>): {
    'package.json': Buffer
    /** Format 1 only. */
    'npm-shrinkwrap.json'?: Buffer
}

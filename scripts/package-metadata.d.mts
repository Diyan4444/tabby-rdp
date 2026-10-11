// The built-in-only publication helper is also exercised by the TypeScript tests.
export function runtimeMetadata (manifest: Record<string, unknown>, lock: Record<string, unknown>): {
    'package.json': Buffer
    'npm-shrinkwrap.json': Buffer
}

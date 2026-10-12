// Deterministic publication metadata. Build/test dependencies stay in the checkout;
// consumers install only the plugin's reviewed runtime dependency tree.
//
// Format 1 (0.5.5): package.json without development metadata, and a runtime-only npm-shrinkwrap.json projected
// from the committed one.
// Format 2: package.json without development metadata, and no shrinkwrap: every runtime dependency is pinned to an
// exact version and has no dependencies of its own (the lock says so), so package.json alone fixes what is installed.
// The development lock is package-lock.json, which npm never publishes.
export const PACKAGE_FORMATS = [1, 2]

const EXACT = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?$/

/** What a lock says of the package itself agrees with the manifest: name, version and runtime dependencies. */
function agrees (manifest, lock) {
    return lock.lockfileVersion === 3 && lock.name === manifest.name && lock.version === manifest.version &&
        lock.packages?.['']?.version === manifest.version &&
        JSON.stringify(lock.packages[''].dependencies ?? {}) === JSON.stringify(manifest.dependencies ?? {})
}

function withoutDevelopment (manifest) {
    const pkg = structuredClone(manifest)
    delete pkg.devDependencies
    delete pkg.scripts
    return Buffer.from(JSON.stringify(pkg, null, 2) + '\n')
}

/**
 * The published metadata files for `manifest` (package.json as committed), given the committed lock: format 1's
 * shrinkwrap, format 2's package-lock.json.
 */
export function runtimeMetadata (manifest, lock) {
    const format = manifest.tabbyRdp?.packageFormat
    if (!PACKAGE_FORMATS.includes(format)) {
        throw new Error(`Expected tabbyRdp.packageFormat ${PACKAGE_FORMATS.join(' or ')}`)
    }
    if (!lock || !agrees(manifest, lock)) {
        throw new Error(`Runtime package and ${format === 1 ? 'shrinkwrap' : 'lock'} metadata disagree`)
    }
    if (format === 1) {
        const runtimeLock = structuredClone(lock)
        delete runtimeLock.packages[''].devDependencies
        for (const [name, entry] of Object.entries(runtimeLock.packages)) {
            if (name && entry.dev === true) {
                delete runtimeLock.packages[name]
            }
        }
        return {
            'package.json': withoutDevelopment(manifest),
            'npm-shrinkwrap.json': Buffer.from(JSON.stringify(runtimeLock, null, 2) + '\n'),
        }
    }
    // Without a published lock, nothing but the manifest decides what is installed: each runtime dependency exact,
    // as the lock has it, and none with dependencies of its own (whose ranges would float).
    const dependencies = Object.entries(manifest.dependencies ?? {})
    for (const [name, version] of dependencies) {
        if (!EXACT.test(version)) {
            throw new Error(`Runtime dependency ${name} is ${version}: pin it to an exact version`)
        }
        const locked = lock.packages[`node_modules/${name}`]
        if (!locked || locked.version !== version || locked.dev === true) {
            throw new Error(`Runtime dependency ${name} ${version} is not what the lock installs`)
        }
        if (Object.keys(locked.dependencies ?? {}).length || Object.keys(locked.optionalDependencies ?? {}).length) {
            throw new Error(`Runtime dependency ${name} has dependencies of its own, which package.json can't pin`)
        }
    }
    for (const [name, entry] of Object.entries(lock.packages)) {
        if (name && entry.dev !== true && entry.devOptional !== true && !dependencies.some(([dependency]) => name === `node_modules/${dependency}`)) {
            throw new Error(`${name} is installed at run time but isn't a pinned runtime dependency`)
        }
    }
    return { 'package.json': withoutDevelopment(manifest) }
}

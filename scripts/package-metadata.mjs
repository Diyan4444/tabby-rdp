// Deterministic publication metadata. Build/test dependencies stay in the checkout;
// consumers install only the plugin's reviewed runtime dependency tree.
export function runtimeMetadata (manifest, lock) {
    if (manifest.tabbyRdp?.packageFormat !== 1) {
        throw new Error('Expected tabbyRdp.packageFormat 1')
    }
    if (lock.lockfileVersion !== 3 || lock.name !== manifest.name || lock.version !== manifest.version ||
        lock.packages?.['']?.version !== manifest.version ||
        JSON.stringify(lock.packages[''].dependencies) !== JSON.stringify(manifest.dependencies)) {
        throw new Error('Runtime package and shrinkwrap metadata disagree')
    }
    const pkg = structuredClone(manifest)
    delete pkg.devDependencies
    delete pkg.scripts
    const runtimeLock = structuredClone(lock)
    delete runtimeLock.packages[''].devDependencies
    for (const [name, entry] of Object.entries(runtimeLock.packages)) {
        if (name && entry.dev === true) {
            delete runtimeLock.packages[name]
        }
    }
    return {
        'package.json': Buffer.from(JSON.stringify(pkg, null, 2) + '\n'),
        'npm-shrinkwrap.json': Buffer.from(JSON.stringify(runtimeLock, null, 2) + '\n'),
    }
}

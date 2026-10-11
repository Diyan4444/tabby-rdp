const $ = id => document.getElementById(id)
let selected = null
let lastDetail = ''
const labels = { passed: 'Passed', failed: 'Failed', skipped: 'Skipped', 'infrastructure-failed': 'Infrastructure failure', cancelled: 'Cancelled', running: 'Running', 'not-run': 'Not executed', timedOut: 'Timed out', interrupted: 'Interrupted' }
function node (tag, text, className) {
    const element = document.createElement(tag)
    if (text !== undefined) element.textContent = text
    if (className) element.className = className
    return element
}
function link (label, href) { const a = node('a', label); a.href = href; a.target = '_blank'; a.rel = 'noopener'; return a }
function artifactURL (run, file) { return `/runs/${encodeURIComponent(run.id)}/${file.split(/[\\/]/).map(encodeURIComponent).join('/')}` }
async function api (url, value) {
    const response = await fetch(url, value === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(value) })
    const result = await response.json()
    if (!response.ok) {
        if (response.status === 401) { $('login').hidden = false; $('workspace').hidden = true }
        throw new Error(result.error)
    }
    return result
}
function message (error) { $('message').textContent = error?.message || '' }
$('login').onsubmit = async event => {
    event.preventDefault()
    try { await api('/api/login', { token: $('token').value }); $('token').value = ''; message(); await refresh() } catch (error) { message(error) }
}
$('run').onclick = async () => {
    $('run').disabled = true
    try { const run = await api('/api/runs', { test: 'visual-host' }); selected = run.id; message(); await refresh() } catch (error) { message(error); $('run').disabled = false }
}
$('cancel').onclick = async () => { try { await api('/api/cancel', {}); message(new Error('Cancellation requested. Waiting for cleanup…')); await refresh() } catch (error) { message(error) } }
function showRun (run) {
    const signature = JSON.stringify(run)
    if (signature === lastDetail) return
    lastDetail = signature
    const detail = $('detail')
    detail.dataset.runId = run.id
    detail.replaceChildren()
    detail.append(node('p', 'RUN EVIDENCE', 'eyebrow'), node('h2', labels[run.status], `status ${run.status}`))
    detail.append(node('p', `${new Date(run.startedAt).toLocaleString()} · ${run.durationMs === undefined ? run.stage : (run.durationMs / 1000).toFixed(1) + ' s'}`, 'muted'))
    detail.append(node('code', `${run.commit.slice(0, 12)}${run.dirty ? ' + uncommitted changes' : ''} · ${run.platform}`))
    if (run.reason) detail.append(node('p', run.reason, 'reason'))
    const links = node('div', undefined, 'links')
    links.append(link('Execution log ↗', artifactURL(run, 'execution.log')))
    if (run.tests.some(t => t.status !== 'not-run')) links.append(link('Playwright report & trace viewer ↗', artifactURL(run, 'report/index.html')))
    detail.append(links)
    for (const test of run.tests) {
        detail.append(node('h3', test.title), node('p', labels[test.status] || test.status, `status ${test.status}`))
        for (const error of test.errors || []) detail.append(node('pre', error, 'error'))
        const attachments = node('div', undefined, 'links')
        for (const a of test.attachments || []) {
            if (a.contentType !== 'image/png') attachments.append(link(a.name === 'trace' ? 'Download trace.zip ↗' : `${a.name} ↗`, artifactURL(run, a.path)))
        }
        detail.append(attachments)
        const gallery = node('div', undefined, 'gallery')
        // Show canonical actual/expected first; Playwright also attaches diff images on a mismatch.
        for (const a of (test.attachments || []).filter(a => a.contentType === 'image/png')) {
            const figure = node('figure')
            const caption = node('figcaption', a.name)
            const aLink = link('', artifactURL(run, a.path))
            const img = node('img'); img.src = aLink.href; img.alt = `${a.name}: ${test.title}`; img.loading = 'lazy'
            aLink.append(img); figure.append(caption, aLink); gallery.append(figure)
        }
        detail.append(gallery)
    }
}
async function refresh () {
    const data = await api('/api/runs')
    $('login').hidden = true; $('workspace').hidden = false
    $('run').disabled = !!data.active; $('cancel').hidden = !data.active
    $('run').textContent = data.active ? 'Test running…' : 'Run visual test'
    const summary = $('summary'); summary.replaceChildren()
    for (const [title, value] of [['Latest run', data.runs[0] ? labels[data.runs[0].status] : 'Not executed'], ['Passed', data.runs.filter(r => r.status === 'passed').length], ['Failed', data.runs.filter(r => r.status === 'failed').length], ['Infrastructure failures', data.runs.filter(r => r.status === 'infrastructure-failed').length]]) {
        const item = node('div', undefined, 'metric'); item.append(node('span', title, 'muted'), node('strong', String(value))); summary.append(item)
    }
    const history = $('history'); history.replaceChildren()
    if (!data.runs.length) history.append(node('p', 'No runs yet. Execute the visual test to begin.', 'muted'))
    if (!selected || !data.runs.some(r => r.id === selected)) selected = data.runs[0]?.id
    for (const run of data.runs) {
        const row = node('button', undefined, `run-row${selected === run.id ? ' selected' : ''}`)
        row.append(node('span', labels[run.status], `status ${run.status}`), node('span', new Date(run.startedAt).toLocaleString(), 'muted'), node('code', run.commit.slice(0, 8) + (run.dirty ? ' + changes' : '')))
        row.onclick = () => { selected = run.id; lastDetail = ''; refresh().catch(message) }
        history.append(row)
    }
    const run = data.runs.find(r => r.id === selected)
    if (run) showRun(run)
}
refresh().catch(message)
setInterval(() => { if (!$('workspace').hidden) refresh().catch(message) }, 2000)

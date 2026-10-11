const $ = id => document.getElementById(id)
let selected = null
let lastDetail = ''
let mutationCatalogLoaded = false
let aiState = {}
let executionActive = false
const runLabel = run => run.mutations && run.status === 'passed' ? 'Campaign completed' : labels[run.status]
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
    try { const run = await api('/api/runs', { test: $('environment').value }); selected = run.id; message(); await refresh() } catch (error) { message(error); $('run').disabled = false }
}
$('campaign').onclick = async () => {
    const mutations = [...document.querySelectorAll('[data-mutation]:checked')].map(input=>({id:input.dataset.mutation,value:Number($('value-'+input.dataset.mutation).value)}))
    try { const run = await api('/api/campaigns', { test: $('environment').value, mutations }); selected=run.id; message(); await refresh() } catch(error) { message(error) }
}
$('cancel').onclick = async () => { try { await api('/api/cancel', {}); message(new Error('Cancellation requested. Waiting for cleanup…')); await refresh() } catch (error) { message(error) } }
$('ai-cancel').onclick = async () => { try { await api('/api/ai/cancel', {}); await refresh() } catch (error) { message(error) } }
function showAI(run, detail) {
    const section = node('section', undefined, 'ai-review'); section.id = 'ai-review'
    section.append(node('h3', 'AI findings · advisory'))
    const button = node('button', 'Review screenshots with AI', 'secondary'); button.id = 'ai-review-run'
    button.onclick = async () => { try { await api('/api/ai/reviews', { runId: run.id }); message(); await refresh() } catch (error) { message(error) } }
    section.append(button)
    const review = run.ai
    if (!review) section.append(node('p', 'Not evaluated. Screenshot evidence is sent to OpenAI only when review is requested; logs and traces are retained locally.', 'muted'))
    else {
        section.append(node('p', `${review.status} · ${review.detector.model} · ${review.detector.version} · ${new Date(review.startedAt).toLocaleString()}`))
        section.append(link('Review JSON ↗', artifactURL(run, `ai-reviews/${review.id}.json`)))
        if (review.reason) section.append(node('p', review.reason, 'reason'))
        section.append(node('p', `Test result remains ${runLabel(run)}. This review diagnoses visible symptoms; it does not establish infrastructure health or root cause.`, 'muted'))
        const metrics = node('details'); metrics.append(node('summary', 'AI detection breakdown, exclusions and escapes'), node('pre', JSON.stringify(review.metrics, null, 2), 'metrics')); section.append(metrics)
        if (run.aiHistory?.length) {
            const history = node('details'); history.append(node('summary', 'Previous AI evaluations'))
            for (const entry of run.aiHistory) history.append(node('p', `${entry.status} · ${entry.detector.version} · ${new Date(entry.startedAt).toLocaleString()}`), link('Evaluation JSON ↗', artifactURL(run, `ai-reviews/${entry.id}.json`)))
            section.append(history)
        }
        for (const item of review.cases) {
            const row = node('details', undefined, 'ai-case'); row.dataset.case = item.id
            const result = item.review
            row.append(node('summary', `${item.id}: ${result?.verdict || item.status}${result ? ` · confidence ${Math.round(result.confidence * 100)}%${result.cached ? ' · cached' : ''}` : ''}`))
            if (item.reason || item.excluded) row.append(node('p', item.reason || item.excluded, 'reason'))
            if (result) {
                row.append(node('p', 'Observed: ' + result.observations))
                if (result.hypotheses) row.append(node('p', 'Hypotheses: ' + result.hypotheses, 'muted'))
                if (result.limitations) row.append(node('p', 'Limits: ' + result.limitations, 'muted'))
                row.append(node('p', `${result.latencyMs} ms · ${result.estimatedUSD === null ? 'Codex subscription allowance' : `estimated $${result.estimatedUSD.toFixed(6)} original request`} · ${result.findings.length} finding(s)`, 'muted'))
                for (const finding of result.findings) row.append(node('p', `${finding.category} · ${finding.severity} · confidence ${Math.round(finding.confidence * 100)}%: ${finding.explanation}`))
                const gallery = node('div', undefined, 'gallery')
                for (const evidence of item.images) {
                    const figure = node('figure'); figure.append(node('figcaption', evidence.role))
                    const frame = node('div', undefined, 'ai-image'), a = link('', artifactURL(run, evidence.path))
                    const img = node('img'); img.src = a.href; img.alt = `${item.id} ${evidence.role}`; img.loading = 'lazy'; a.append(img); frame.append(a)
                    for (const finding of result.findings.filter(f => f.image === evidence.role && f.region)) {
                        const box = node('span', undefined, 'ai-region'), r = finding.region
                        box.style.left = `${r.x * 100}%`; box.style.top = `${r.y * 100}%`; box.style.width = `${r.width * 100}%`; box.style.height = `${r.height * 100}%`; box.title = finding.category; box.setAttribute('aria-label', finding.category + ' region'); frame.append(box)
                    }
                    figure.append(frame); gallery.append(figure)
                }
                row.append(gallery)
            }
            section.append(row)
        }
    }
    detail.append(section)
}
function showRun (run) {
    const signature = JSON.stringify(run)
    if (signature === lastDetail) return
    lastDetail = signature
    const detail = $('detail')
    detail.dataset.runId = run.id
    detail.replaceChildren()
    detail.append(node('p', 'RUN EVIDENCE', 'eyebrow'), node('h2', runLabel(run), `status ${run.status}`))
    detail.append(node('p', `${new Date(run.startedAt).toLocaleString()} · ${run.durationMs === undefined ? run.stage : (run.durationMs / 1000).toFixed(1) + ' s'}`, 'muted'))
    detail.append(node('p', `${run.environment || 'Local Tabby'} · ${run.coverage}`, 'muted'))
    detail.append(node('code', `${run.commit.slice(0, 12)}${run.dirty ? ' + uncommitted changes' : ''} · Test driver: ${run.platform}`))
    if (run.reason) detail.append(node('p', run.reason, 'reason'))
    const links = node('div', undefined, 'links')
    links.append(link('Execution log ↗', artifactURL(run, 'execution.log')))
    if (run.tests.some(t => t.status !== 'not-run')) links.append(link('Playwright report & trace viewer ↗', artifactURL(run, 'report/index.html')))
    detail.append(links)
    showAI(run, detail)
    if (run.mutations) {
        detail.append(node('h3', 'Mutation detection results'))
        const repeat=node('button','Reproduce campaign','secondary'); repeat.id='reproduce-campaign'; repeat.disabled=!!document.querySelector('#cancel:not([hidden])');
        repeat.onclick=async()=>{try{const next=await api('/api/campaigns',{test:run.test,mutations:run.mutations.map(m=>({id:m.id,value:m.value}))});selected=next.id;await refresh()}catch(error){message(error)}}
        detail.append(repeat)
        detail.append(node('p', 'Parameters: '+run.mutations.map(m=>`${m.id} ${m.parameter}=${m.value} (${m.layer})`).join('; '),'muted'))
        if (!run.experiments?.length) detail.append(node('p',run.status==='running' ? 'Executing controls and mutations; live stage is recorded in the execution log.' : 'No completed experiment evidence. Not executed / incomplete.','muted'))
        for (const trial of run.experiments || []) {
            const caught=trial.detectors.filter(d=>d.failed).map(d=>d.id).join(', ') || 'none'
            detail.append(node('p',`${trial.id}: ${trial.classification || 'incomplete'} · manifested: ${trial.manifestation?.manifested ?? 'control'} · caught by: ${caught} · restored: ${trial.restored} · observation ${Math.round(trial.latencyMs || 0)} ms`))
        }
        detail.append(node('pre',JSON.stringify(run.effectiveness || {},null,2),'metrics'))
    }
    for (const test of run.tests) {
        detail.append(node('h3', test.title), node('p', labels[test.status] || test.status, `status ${test.status}`))
        for (const error of test.errors || []) detail.append(node('pre', error, 'error'))
        const attachments = node('div', undefined, 'links')
        for (const a of test.attachments || []) {
            if (a.contentType !== 'image/png') attachments.append(link(a.name === 'trace' ? 'Download trace.zip ↗' : `${a.name} ↗`, artifactURL(run, a.path)))
        }
        detail.append(attachments)
        const gallery = node('div', undefined, 'gallery')
        const diagnostic = node('details'); diagnostic.append(node('summary', 'Raw canvas and resize filmstrip'))
        const diagnosticGallery = node('div', undefined, 'gallery'); diagnostic.append(diagnosticGallery)
        // Show canonical actual/expected first; Playwright also attaches diff images on a mismatch.
        for (const a of (test.attachments || []).filter(a => a.contentType === 'image/png')) {
            const figure = node('figure')
            const caption = node('figcaption', a.name)
            const aLink = link('', artifactURL(run, a.path))
            const img = node('img'); img.src = aLink.href; img.alt = `${a.name}: ${test.title}`; img.loading = 'lazy'
            aLink.append(img); figure.append(caption, aLink); (/raw-canvas|^resize-\d/.test(a.name) ? diagnosticGallery : gallery).append(figure)
        }
        detail.append(gallery)
        if (diagnosticGallery.childElementCount) detail.append(diagnostic)
    }
}
async function refresh () {
    const data = await api('/api/runs')
    aiState = data.ai || {}; executionActive = !!data.active || !!aiState.active
    $('ai-status').textContent = `${aiState.configured ? 'Configured' : 'Not configured: ' + (aiState.provider === 'codex' ? 'Codex ChatGPT sign-in required' : 'OpenAI API key required')} · ${aiState.model || ''} · ${aiState.provider === 'codex' ? `ChatGPT subscription · ${aiState.requests}/${aiState.maxRequests} review requests · ${aiState.tokens} tokens reported` : `estimated $${(aiState.estimatedUSD || 0).toFixed(4)} + $${(aiState.reservedUSD || 0).toFixed(2)} reserved / $${aiState.budgetUSD || 0} lifetime limit`}${aiState.active ? ' · Reviewing screenshots…' : ''}`
    $('ai-cancel').hidden = !aiState.active
    const aiMetrics = aiState.metrics || {}
    $('ai-metrics').replaceChildren(...[['AI detected', `${aiMetrics.detected || 0}/${aiMetrics.manifested || 0}`], ['Healthy false positives', `${aiMetrics.falsePositives || 0}/${aiMetrics.controls || 0}`], ['Pending / failed', aiMetrics.pendingOrFailed || 0], ['Abstentions', aiMetrics.abstentions || 0]].map(([label, value]) => { const box = node('div', undefined, 'metric'); box.append(node('span', label), node('strong', String(value))); return box }))
    if (!mutationCatalogLoaded) {
        for (const mutation of data.mutations || []) {
            const cell=node('div');const label=node('label'); const check=node('input');check.type='checkbox';check.dataset.mutation=mutation.id;check.checked=mutation.id==='crop';
            label.append(check,document.createTextNode(' '+mutation.name));
            const parameter=node('label',mutation.parameter+' · '+mutation.layer);parameter.htmlFor='value-'+mutation.id;
            const values=node('select');values.id=parameter.htmlFor;
            for(const value of mutation.values){const option=node('option',String(value));option.value=String(value);values.append(option)}
            cell.append(label,parameter,values);$('mutation-choices').append(cell)
        }
        mutationCatalogLoaded=true
    }
    const rate=value=>value===null || value===undefined ? 'No evidence' : (100*value).toFixed(1)+'%'
    const metrics=data.effectiveness || {}
    $('effectiveness').replaceChildren(...[['Detection',rate(metrics.detectionRate)],['Manifested',metrics.manifested || 0],['Control false positives',rate(metrics.falsePositiveRate)],['Escapes',metrics.escaped?.length || 0]].map(([label,value])=>{const box=node('div',undefined,'metric');box.append(node('span',label),node('strong',String(value)));return box}))
    $('mutation-metrics').textContent=JSON.stringify({metrics,history:data.trends},null,2)
    $('login').hidden = true; $('workspace').hidden = false
    const choice = $('environment').value
    $('environment').replaceChildren(...data.catalog.map(item => { const option = node('option', item.name + (item.configured ? '' : ' — Not configured')); option.value = item.id; return option }))
    if (choice) $('environment').value = choice
    const showCoverage = () => { const item = data.catalog.find(item => item.id === $('environment').value); $('campaign').disabled=!!data.active || (item.suite || item.id)==='visual-host'; $('mutation-scope').textContent=(item.suite || item.id)==='visual-host' ? 'Select a real RDP desktop to enable mutations.' : 'One serialized campaign; fixed catalog values only. Screenshot/evaluator defects do not qualify RDP rendering.'; $('coverage').textContent = item.coverage + (item.configured ? '' : ' · Missing: ' + item.missing.join(', ')) }
    $('environment').onchange = showCoverage; showCoverage()
    const environments = $('environments'); environments.replaceChildren()
    for (const item of data.catalog) {
        const latest = data.runs.find(run => run.test === item.id && !run.mutations)
        const card = node('div', undefined, 'metric'); card.append(node('span', item.environment, 'muted'), node('strong', latest ? labels[latest.status] : 'Not executed'), node('span', item.configured ? 'Configured' : 'Not configured', 'muted'))
        if (latest) { const actual = latest.tests.flatMap(t => t.attachments || []).find(a => a.name === 'actual'); if (actual) { const preview = node('img'); preview.src = artifactURL(latest, actual.path); preview.alt = item.environment + ' latest screenshot'; card.append(preview) }; const button = node('button', 'View evidence', 'secondary'); button.onclick = () => { selected = latest.id; lastDetail = ''; refresh().catch(message) }; card.append(button) }
        environments.append(card)
    }
    $('run').disabled = !!data.active; $('cancel').hidden = !data.active
    $('run').textContent = data.active ? 'Test running…' : 'Run visual test'
    const summary = $('summary'); summary.replaceChildren()
    for (const [title, value] of [['Latest run', data.runs[0] ? runLabel(data.runs[0]) : 'Not executed'], ['Passed', data.runs.filter(r => !r.mutations && r.status === 'passed').length], ['Failed', data.runs.filter(r => !r.mutations && r.status === 'failed').length], ['Infrastructure failures', data.runs.filter(r => r.status === 'infrastructure-failed').length]]) {
        const item = node('div', undefined, 'metric'); item.append(node('span', title, 'muted'), node('strong', String(value))); summary.append(item)
    }
    const history = $('history'); history.replaceChildren()
    if (!data.runs.length) history.append(node('p', 'No runs yet. Execute the visual test to begin.', 'muted'))
    if (!selected || !data.runs.some(r => r.id === selected)) selected = data.runs[0]?.id
    for (const run of data.runs) {
        const row = node('button', undefined, `run-row${selected === run.id ? ' selected' : ''}`)
        row.dataset.runId = run.id
        row.append(node('span', (run.mutations ? 'Campaign · ' : '') + (run.environment || 'Local Tabby')), node('span', runLabel(run), `status ${run.status}`), node('span', new Date(run.startedAt).toLocaleString(), 'muted'), node('code', run.commit.slice(0, 8) + (run.dirty ? ' + changes' : '')))
        if (run.ai) row.append(node('span', `AI ${run.ai.status} · ${run.ai.cases.filter(c => c.review?.verdict === 'anomaly').length} advisory anomalies`, 'muted'))
        row.onclick = () => { selected = run.id; lastDetail = ''; refresh().catch(message) }
        history.append(row)
    }
    const run = data.runs.find(r => r.id === selected)
    if (run) showRun(run)
    if ($('reproduce-campaign')) $('reproduce-campaign').disabled=executionActive
    if ($('ai-review-run')) $('ai-review-run').disabled=executionActive || !aiState.configured || run?.stage !== 'finished'
    if (aiState.active) { $('run').disabled = true; $('campaign').disabled = true }
}
refresh().catch(message)
setInterval(() => { if (!$('workspace').hidden) refresh().catch(message) }, 2000)

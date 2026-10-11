import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
const exec = promisify(execFile)
export const repository = 'meanaverage/tabby-rdp'
// Read-only GitHub integration through the operator's existing gh login. Never checks out PR code.
export async function githubContext(commit, request = async endpoint => {
    const {stdout} = await exec('gh',['api',endpoint],{timeout:10000,maxBuffer:1_000_000,env:{...process.env,GH_PROMPT_DISABLED:'1'}})
    return JSON.parse(stdout)
}) {
    if (!/^[a-f0-9]{40}$/.test(commit)) throw new Error('Invalid commit')
    const base = {repository,commit,url:`https://github.com/${repository}/commit/${commit}`,checkedAt:new Date().toISOString()}
    try {
        const [prs, ci] = await Promise.all([request(`repos/${repository}/commits/${commit}/pulls?per_page=20`),request(`repos/${repository}/actions/workflows/ci.yml/runs?head_sha=${commit}&per_page=20`)])
        return {...base,status:'available',pullRequests:prs.map(p=>({number:p.number,url:`https://github.com/${repository}/pull/${p.number}`,state:p.state})),ci:(ci.workflow_runs || []).filter(r=>r.head_sha===commit).map(r=>({id:r.id,status:r.status,conclusion:r.conclusion,event:r.event,branch:r.head_branch,url:`https://github.com/${repository}/actions/runs/${r.id}`}))}
    } catch { return {...base,status:'unavailable',pullRequests:[],ci:[],reason:'GitHub lookup unavailable or commit not published. No CI/PR association inferred.'} }
}

export async function hostedContext(commit) {
    const request = async endpoint => {
        const {stdout}=await exec('gh',['api',endpoint],{timeout:10000,maxBuffer:1_000_000,env:{...process.env,GH_PROMPT_DISABLED:'1'}})
        return JSON.parse(stdout)
    }
    if(!/^[a-f0-9]{40}$/.test(commit))throw new Error('Invalid commit')
    try {
        const result=await request(`repos/${repository}/actions/workflows/visual-qa.yml/runs?head_sha=${commit}&per_page=5`)
        const runs=[]
        for(const r of (result.workflow_runs || []).filter(r=>r.head_sha===commit).slice(0,3)) {
            const jobs=await request(`repos/${repository}/actions/runs/${r.id}/jobs?per_page=20`)
            runs.push({id:r.id,commit:r.head_sha,status:r.status,conclusion:r.conclusion,url:`https://github.com/${repository}/actions/runs/${r.id}`,
                jobs:(jobs.jobs || []).map(j=>({name:j.name,status:j.status,conclusion:j.conclusion,url:`https://github.com/${repository}/actions/runs/${r.id}/job/${j.id}`,startedAt:j.started_at,finishedAt:j.completed_at}))})
        }
        return {status:'available',runs,coverage:'Native functional/settings smoke; screenshots and traces are hosted artifacts. No hosted baseline or private RDP qualification.'}
    } catch {return {status:'unavailable',runs:[],coverage:'Hosted workflow not published or GitHub unavailable; no execution claimed.'}}
}

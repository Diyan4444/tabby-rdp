// Logged-in macOS user service. Keeps the existing private configuration and auth store local.
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import {fileURLToPath} from 'node:url'
import {execFileSync} from 'node:child_process'
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..'),data=path.join(root,'.qa')
const label='org.tabbyrdp.visual-qa',domain=`gui/${process.getuid?.()}`
if(process.platform!=='darwin')throw new Error('This installer is for a logged-in macOS operator; see operations documentation for other hosts')
const action=process.argv[2]
if(!['install','stop','restart','status'].includes(action))throw new Error('Usage: node scripts/qa/service.mjs install|stop|restart|status')
const file=path.join(data,'service.plist')
if(action==='status')execFileSync('launchctl',['print',`${domain}/${label}`],{stdio:'inherit'})
else if(action==='stop')execFileSync('launchctl',['bootout',`${domain}/${label}`],{stdio:'inherit'})
else {
    const token=fs.readFileSync(path.join(data,'token'),'utf8').trim()
    try {
        const response=await fetch('http://127.0.0.1:4317/api/runs',{headers:{Authorization:`Bearer ${token}`},signal:AbortSignal.timeout(3000)})
        if(!response.ok)throw new Error('Dashboard ownership check failed')
        const state=await response.json()
        if(state.active||state.ai.active||state.automation?.active)throw new Error('Wait for active QA work before restarting')
    } catch(error) {if(error.cause?.code!=='ECONNREFUSED')throw error}
    // Never stop a different process if a stale PID was reused.
    const pidFile=path.join(data,'server.pid')
    if(fs.existsSync(pidFile)) {
        const pid=Number(fs.readFileSync(pidFile,'utf8'))
        let command=''
        try{command=execFileSync('ps',['-p',String(pid),'-o','command='],{encoding:'utf8'}).trim()}catch{}
        if(command && ![`${process.execPath} scripts/qa/server.mjs`,`${process.execPath} ${root}/scripts/qa/server.mjs`,'node scripts/qa/server.mjs'].includes(command))throw new Error('PID belongs to another command')
        try{execFileSync('launchctl',['bootout',`${domain}/${label}`],{stdio:'ignore'})}catch{}
        if(command)try{process.kill(pid,'SIGTERM')}catch{}
        for(let i=0;i<100&&fs.existsSync(pidFile);i++)await new Promise(r=>setTimeout(r,100))
        if(fs.existsSync(pidFile)&&command)throw new Error('Previous server did not stop')
    }
    const env={PATH:process.env.PATH,HOME:process.env.HOME,TRD_QA_DATA:data,TRD_QA_AI_PROVIDER:'codex',
        TRD_QA_ENV_FILE:path.join(data,'private/environments.json'),TRD_QA_TARGETS_FILE:path.join(data,'private/targets.json'),TRD_QA_AUTOMATION_FILE:path.join(data,'private/automation.json')}
    if(process.env.CODEX_HOME)env.CODEX_HOME=process.env.CODEX_HOME
    for(const key of ['TRD_QA_ENV_FILE','TRD_QA_TARGETS_FILE','TRD_QA_AUTOMATION_FILE'])if(!fs.existsSync(env[key]))throw new Error('Private configuration missing: '+key)
    const xml=s=>String(s).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;')
    fs.writeFileSync(file,`<?xml version="1.0" encoding="UTF-8"?><!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd"><plist version="1.0"><dict>
<key>Label</key><string>${label}</string><key>ProgramArguments</key><array><string>${xml(process.execPath)}</string><string>${xml(root+'/scripts/qa/server.mjs')}</string></array>
<key>WorkingDirectory</key><string>${xml(root)}</string><key>EnvironmentVariables</key><dict>${Object.entries(env).map(([k,v])=>`<key>${k}</key><string>${xml(v)}</string>`).join('')}</dict>
<key>RunAtLoad</key><true/><key>KeepAlive</key><true/><key>ThrottleInterval</key><integer>30</integer><key>ProcessType</key><string>Interactive</string>
<key>StandardOutPath</key><string>${xml(data+'/server.log')}</string><key>StandardErrorPath</key><string>${xml(data+'/server.log')}</string></dict></plist>`,{mode:0o600})
    const installed=path.join(os.homedir(),'Library','LaunchAgents',label+'.plist')
    fs.mkdirSync(path.dirname(installed),{recursive:true})
    fs.copyFileSync(file,installed);fs.chmodSync(installed,0o600)
    execFileSync('launchctl',['bootstrap',domain,installed],{stdio:'inherit'})
    console.log('Private QA user service installed. Configuration contains paths only; no copied OpenAI credentials.')
}

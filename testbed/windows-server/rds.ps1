<#
.SYNOPSIS
Makes a Windows Server test machine a Remote Desktop Session Host with its own Remote Desktop license server, for
tabby-rdp's test of the licensing exchange an RDS host runs (issue #106; the rds suite). Run after ..\windows\setup.ps1.

.DESCRIPTION
Two stages, since the roles need a restart:

- roles: installs the Remote Desktop Session Host and Remote Desktop Licensing roles, sets the licensing mode to Per
  Device and the license server to this machine through the policy keys (what Group Policy writes), leaves a task that
  runs the second stage at startup, and restarts.
- configure (at startup, as SYSTEM): makes the Remote Desktop service depend on the license server's and restarts it
  once the license server runs, then writes C:\tabby-rdp\rds-ready.txt. Started before the license server, as it was
  at every boot on Windows Server 2022, the Remote Desktop service found none, ended each exchange with
  STATUS_VALID_CLIENT and issued nothing; restarted after it, it issues. (Set through the Remote Desktop Services WMI
  settings instead of the policy keys, Windows Server 2022 issued nothing either way.)

The license server isn't activated: an unactivated one still issues temporary Per Device licenses (its event 18 says
so), which is the whole exchange (Server License Request, platform challenge, a new license) that a plain Windows
machine skips with one message. No licenses are bought or installed; the evaluation's 180 days are the limit.

What it does is logged to C:\tabby-rdp\rds.log.

.PARAMETER Stage
roles (the default) or configure.
#>
[CmdletBinding()]
param(
    [ValidateSet('roles', 'configure')] [string] $Stage = 'roles'
)
$ErrorActionPreference = 'Stop'
$home_ = 'C:\tabby-rdp'
New-Item -ItemType Directory -Force -Path $home_ | Out-Null
function Log ([Parameter(ValueFromPipeline)] $line) {
    process {
        $text = "$(Get-Date -Format 'HH:mm:ss') $line"
        Add-Content -Path "$home_\rds.log" -Value $text
        Write-Host $text
    }
}
function Step ([string] $what, [scriptblock] $do) {
    Log "== $what"
    try { & $do } catch { Log "FAILED: ${what}: $_"; throw }
}

if ($Stage -eq 'roles') {
    Copy-Item -Force $PSCommandPath "$home_\rds.ps1"
    Set-ItemProperty "$home_\rds.ps1" -Name IsReadOnly -Value $false  # as copied from a disc
    Step 'Remote Desktop Session Host and Remote Desktop Licensing' {
        Install-WindowsFeature RDS-RD-Server, RDS-Licensing, RDS-Licensing-UI -IncludeManagementTools | Out-String | Log
    }
    Step 'Per Device licensing, this machine as the license server' {
        $policy = 'HKLM:\SOFTWARE\Policies\Microsoft\Windows NT\Terminal Services'
        New-Item -Path $policy -Force | Out-Null
        Set-ItemProperty -Path $policy -Name LicensingMode -Value 2 -Type DWord      # 2: Per Device, 4: Per User
        Set-ItemProperty -Path $policy -Name LicenseServers -Value $env:COMPUTERNAME -Type String
    }
    Step 'the second stage, at startup' {
        $action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument "-NoProfile -ExecutionPolicy Bypass -File `"$home_\rds.ps1`" -Stage configure"
        Register-ScheduledTask -TaskName 'tabby-rdp-rds' -Action $action -Trigger (New-ScheduledTaskTrigger -AtStartup) `
            -User 'SYSTEM' -RunLevel Highest -Force | Out-Null
    }
    Log 'restarting'
    Restart-Computer -Force
    return
}

Step 'the Remote Desktop service after the license server, now and at every start' {
    $deps = @((Get-Service TermService).ServicesDependedOn | Select-Object -ExpandProperty Name)
    if ($deps -notcontains 'TermServLicensing') { sc.exe config TermService depend= (($deps + 'TermServLicensing') -join '/') | Log }
    (Get-Service TermServLicensing).WaitForStatus('Running', [TimeSpan]::FromMinutes(5))
    Start-Sleep -Seconds 10
    Restart-Service TermService -Force
    $ts = Get-WmiObject Win32_TerminalServiceSetting -Namespace root\cimv2\terminalservices
    Log "licensing type $($ts.LicensingType) (policy: $($ts.PolicySourceLicensingType)), license servers $($ts.GetSpecifiedLicenseServerList().SpecifiedLSList -join ',')"
}
Step 'A marker for the tests' {
    Set-Content -Path "$home_\rds-ready.txt" -Value "RDSH + RD Licensing (Per Device, unactivated) on $env:COMPUTERNAME"
}
Log 'done'

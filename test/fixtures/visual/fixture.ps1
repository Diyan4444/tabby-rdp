param([Parameter(Mandatory=$true)][string]$Directory,[int]$LifetimeSeconds=300)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms, System.Drawing
Add-Type -Namespace VisualQA -Name Dpi -MemberDefinition '[DllImport("user32.dll")] public static extern IntPtr SetProcessDpiAwarenessContext(IntPtr c);'
[VisualQA.Dpi]::SetProcessDpiAwarenessContext([IntPtr]-4) | Out-Null
$f = New-Object Windows.Forms.Form
$f.Text = 'Tabby Visual QA Fixture'; $f.FormBorderStyle = 'None'; $f.WindowState = 'Maximized'; $f.TopMost = $true; $f.KeyPreview = $true
$script:state = @{version=1; sequence=0; input='initial'; platform='windows'; font='Segoe UI'; scale=1}
$script:mutation = ''
$script:mutationUntil = Get-Date
$started = Get-Date
function Publish {
    $script:state | ConvertTo-Json -Compress | Set-Content -Encoding UTF8 (Join-Path $Directory 'state.json')
}
function Rect($g,$x,$y,$w,$h,$rgb) {
    $b = New-Object Drawing.SolidBrush ([Drawing.Color]::FromArgb($rgb[0],$rgb[1],$rgb[2]))
    $g.FillRectangle($b,[int]$x,[int]$y,[int]$w,[int]$h); $b.Dispose()
}
function Text($g,$x,$y,$text,$size=20) {
    $font = New-Object Drawing.Font 'Segoe UI', $size, ([Drawing.FontStyle]::Regular), ([Drawing.GraphicsUnit]::Pixel)
    $g.DrawString($text,$font,[Drawing.Brushes]::AliceBlue,[float]$x,[float]$y); $font.Dispose()
}
$f.Add_Paint({
    $g=$_.Graphics; $w=$f.ClientSize.Width; $h=$f.ClientSize.Height
    $script:state.bounds=@{x=$f.Left;y=$f.Top;width=$w;height=$h}; $script:state.width=$w; $script:state.height=$h; $script:state.scale=$g.DpiX/96; $script:state.ready=$true
    $g.TextRenderingHint=[Drawing.Text.TextRenderingHint]::AntiAliasGridFit
    Rect $g 0 0 $w $h @(18,26,42)
    Rect $g 0 0 48 48 @(220,40,60); Rect $g ($w-48) 0 48 48 @(30,200,80)
    Rect $g 0 ($h-48) 48 48 @(40,80,220); Rect $g ($w-48) ($h-48) 48 48 @(240,200,40)
    Text $g 64 38 'TABBY / REAL RDP VISUAL QA' 24
    Text $g 64 80 'Aa Bb 0123456789  |  Text, geometry, gradients' 16
    $rect=New-Object Drawing.Rectangle 64,132,($w-128),80
    $gradient=New-Object Drawing.Drawing2D.LinearGradientBrush $rect,([Drawing.Color]::FromArgb(30,100,200)),([Drawing.Color]::FromArgb(240,200,40)),0
    $g.FillRectangle($gradient,$rect); $gradient.Dispose()
    $colors=@(@(255,0,0),@(0,255,0),@(0,0,255),@(255,255,255),@(128,128,128),@(0,0,0))
    for($i=0;$i -lt $colors.Length;$i++){ Rect $g (64+$i*80) 240 64 64 $colors[$i] }
    Text $g 64 320 ('REMOTE FRAME {0:D2}' -f $script:state.sequence)
    if($script:mutation -ne 'missing'){ Rect $g 64 ($h-116) 220 48 @(36,66,102); Text $g 80 ($h-108) 'Advance frame' 18 }
    $color=if($script:state.sequence%2 -eq 0){@(30,100,200)}else{@(240,200,40)}
    Rect $g ($w-160) ($h-144) 80 64 $color
    Publish
})
$f.Add_MouseDown({ if($_.X -ge 64 -and $_.X -lt 284 -and $_.Y -ge $f.ClientSize.Height-116 -and $_.Y -lt $f.ClientSize.Height-68){$script:state.sequence++;$script:state.input='mouse';$f.Invalidate()} })
$f.Add_KeyDown({ if($_.KeyCode -eq 'Space'){$script:state.sequence++;$script:state.input='keyboard';$f.Invalidate()} })
$f.Add_Shown({ $f.Activate(); $f.BringToFront(); $f.Focus() | Out-Null })
$f.Add_Resize({ $f.Invalidate() })
$timer=New-Object Windows.Forms.Timer; $timer.Interval=100
$timer.Add_Tick({
    $file=Join-Path $Directory 'command.json'
    if(Test-Path $file){
        try {$command=Get-Content -Raw $file | ConvertFrom-Json; Remove-Item -LiteralPath $file} catch {$command=$null}
        if($command.capture){
            $bitmap=New-Object Drawing.Bitmap $f.ClientSize.Width,$f.ClientSize.Height
            $graphics=[Drawing.Graphics]::FromImage($bitmap)
            $graphics.CopyFromScreen($f.PointToScreen([Drawing.Point]::Empty),[Drawing.Point]::Empty,$f.ClientSize)
            $bitmap.Save((Join-Path $Directory 'guest.png'),[Drawing.Imaging.ImageFormat]::Png)
            $graphics.Dispose();$bitmap.Dispose()
            $script:state.captureId++;$script:state.sessionId=[Diagnostics.Process]::GetCurrentProcess().SessionId
            Publish
        }
        if($command.quit){$f.Close()}
        if($null -ne $command.mutation){$script:mutation=$command.mutation;$script:mutationUntil=(Get-Date).AddSeconds(30);$f.Invalidate()}
        if($command.advance){$script:state.sequence += [int]$command.advance;$f.Invalidate()}
        if($command.reset){$script:state.sequence=0;$script:state.input='reset';$f.Invalidate()}
    }
    if($script:mutation -and (Get-Date) -gt $script:mutationUntil){$script:mutation='';$f.Invalidate()}
    if(((Get-Date)-$started).TotalSeconds -gt $LifetimeSeconds){$f.Close()}
}); $timer.Start()
try {[Windows.Forms.Application]::Run($f)} finally {$timer.Dispose();$script:state.ready=$false;Publish;$f.Dispose()}

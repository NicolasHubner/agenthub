# Launch AgentHub on Windows: build if needed, serve the PWA + backend,
# then open the browser.
$ErrorActionPreference = "Stop"

$Root = Split-Path -Parent $PSScriptRoot
$Port = if ($env:AGENTHUB_PORT) { $env:AGENTHUB_PORT } else { "3070" }
$Bin  = Join-Path $Root "target\release\agenthub.exe"
$Ui   = Join-Path $Root "ui\dist"
$Url  = "http://127.0.0.1:$Port"

if (-not (Test-Path (Join-Path $Ui "index.html"))) {
  Write-Host "agenthub: building UI..."
  Push-Location (Join-Path $Root "ui"); npm install; npm run build; Pop-Location
}

if (-not (Test-Path $Bin)) {
  Write-Host "agenthub: building backend..."
  Push-Location $Root; cargo build --release --bin agenthub; Pop-Location
}

$env:AGENTHUB_UI_DIR = $Ui
$env:AGENTHUB_PORT = $Port
if (-not $env:AGENTHUB_WORKSPACE) { $env:AGENTHUB_WORKSPACE = (Get-Location).Path }

$proc = Start-Process -FilePath $Bin -PassThru
Start-Sleep -Seconds 1
Start-Process $Url
Write-Host "agenthub: $Url (close this window to stop)"
$proc.WaitForExit()

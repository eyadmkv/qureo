$ErrorActionPreference = 'Stop'
$ProjectRoot = $PSScriptRoot
Set-Location $ProjectRoot

Write-Host 'QStudy CLI 0.6.0 setup' -ForegroundColor Cyan

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    throw 'Node.js is not installed. Install Node.js 22.12 or newer, reopen PowerShell, then retry.'
}
$NodeVersion = [version](node -p "process.versions.node")
if ($NodeVersion -lt [version]'22.12.0') { throw "Node.js 22.12 or newer is required. Detected $(node --version)." }
if (-not (Get-Command npm -ErrorAction SilentlyContinue)) { throw 'npm was not found. Repair your Node.js installation and retry.' }
if (-not (Get-Command pwsh -ErrorAction SilentlyContinue)) { throw 'PowerShell 7 (pwsh) is required for Windows DPAPI session encryption.' }

New-Item -ItemType Directory -Force -Path '.\data' | Out-Null
foreach ($LegacyFile in @('.\src\browser.js', '.\src\extractor.js')) {
    if (Test-Path $LegacyFile) { Remove-Item -LiteralPath $LegacyFile -Force }
}

Write-Host '[1/3] Installing HTTP client dependencies and removing unused browser packages...' -ForegroundColor Yellow
npm install
if ($LASTEXITCODE -ne 0) { throw 'npm install failed.' }
npm prune
if ($LASTEXITCODE -ne 0) { throw 'npm prune failed.' }

Write-Host '[2/3] Checking source files...' -ForegroundColor Yellow
npm run check
if ($LASTEXITCODE -ne 0) { throw 'JavaScript syntax validation failed.' }

Write-Host '[3/3] Registering qstudy, qureo and sprix commands...' -ForegroundColor Yellow
npm link
if ($LASTEXITCODE -ne 0) { throw 'npm link failed.' }

Write-Host ''
Write-Host 'Setup complete. No Playwright package or browser driver is installed.' -ForegroundColor Green
Write-Host 'Next: qstudy login'
Write-Host 'Then: qstudy sync'
Write-Host 'Then: qstudy dashboard'
Write-Host "Your QStudy data directory is $env:LOCALAPPDATA\QStudy"
Write-Host 'Course export: .\exports\qureo-export.json'

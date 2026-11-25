$ErrorActionPreference = 'Stop'
$ProjectRoot = $PSScriptRoot
Set-Location $ProjectRoot

Write-Host 'QUREO Personal CLI 0.3.0 setup' -ForegroundColor Cyan

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    throw 'Node.js is not installed. Install Node.js 22 or newer, reopen PowerShell, then retry.'
}
$NodeMajor = [int](node -p "process.versions.node.split('.')[0]")
if ($NodeMajor -lt 22) { throw "Node.js 22 or newer is required. Detected $(node --version)." }
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

Write-Host '[3/3] Registering the private qureo command...' -ForegroundColor Yellow
npm link
if ($LASTEXITCODE -ne 0) { throw 'npm link failed.' }

Write-Host ''
Write-Host 'Setup complete. No browser or Playwright installation is required.' -ForegroundColor Green
Write-Host 'Next: qureo login'
Write-Host 'Then: qureo sync'
Write-Host 'Then: qureo export'
Write-Host 'Your SQLite database stays in .\data\qureo.db'
Write-Host 'Course export: .\exports\qureo-export.json'

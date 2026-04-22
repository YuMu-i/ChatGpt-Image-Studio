Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent $PSScriptRoot
$webDir = Join-Path $repoRoot "web"
$backendDir = Join-Path $repoRoot "backend"

Write-Host "[1/4] Running backend tests..."
Push-Location $backendDir
go test ./...
Pop-Location

Write-Host "[2/4] Ensuring frontend dependencies..."
Push-Location $webDir
if (-not (Test-Path "node_modules")) {
  npm ci
}

Write-Host "[3/5] Running frontend type check..."
npx tsc --noEmit

Write-Host "[4/5] Running frontend lint..."
npm run lint

Write-Host "[5/5] Running frontend production build..."
npm run build
Pop-Location

Write-Host "Checks complete."

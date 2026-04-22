Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent $PSScriptRoot
$webDir = Join-Path $repoRoot "web"
$backendDir = Join-Path $repoRoot "backend"

Write-Host "[1/4] Running backend tests..."
Push-Location $backendDir
go test ./...
Pop-Location

Write-Host "[2/4] Running frontend type check..."
Push-Location $webDir
npx tsc --noEmit

Write-Host "[3/4] Running frontend lint..."
npm run lint

Write-Host "[4/4] Running frontend production build..."
npm run build
Pop-Location

Write-Host "Checks complete."

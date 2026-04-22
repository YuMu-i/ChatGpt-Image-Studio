Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent $PSScriptRoot
$webDir = Join-Path $repoRoot "web"
$backendDir = Join-Path $repoRoot "backend"

Write-Host "[1/2] Building frontend static assets..."
Push-Location $webDir
npm ci
npm run build
Pop-Location

Write-Host "[2/2] Starting backend on configured port..."
Push-Location $backendDir
go run .
Pop-Location

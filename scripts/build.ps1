Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent $PSScriptRoot
$webDir = Join-Path $repoRoot "web"
$backendDir = Join-Path $repoRoot "backend"
$distDir = Join-Path $repoRoot "dist"

Write-Host "[1/2] Building frontend..."
Push-Location $webDir
npm ci
npm run build
Pop-Location

Write-Host "[2/2] Building backend..."
New-Item -ItemType Directory -Path $distDir -Force | Out-Null
Push-Location $backendDir
go build -o (Join-Path $distDir "chatgpt2api-studio.exe") .
Pop-Location

Write-Host "Build complete: $distDir"

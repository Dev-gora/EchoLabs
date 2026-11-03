# first-run helper for the EchoLabs frontend
# Run this from artifacts/fusion-coach after cloning or unzipping the project.
# This file is meant to be shared with other machines; it is not a package install script for the project itself.

$ErrorActionPreference = 'Stop'

function Write-Step {
    param([string]$Message)
    Write-Host "`n==> $Message" -ForegroundColor Green
}

function Write-Ok {
    param([string]$Message)
    Write-Host "    OK: $Message" -ForegroundColor Cyan
}

function Write-Fail {
    param([string]$Message)
    Write-Host "    FAIL: $Message" -ForegroundColor Red
}

Write-Step '1) Ensure Node.js is available'
$nodeVersion = (node --version 2>$null)
if (-not $nodeVersion) {
    Write-Fail 'Node.js was not found on PATH.'
    Write-Host '    Install Node.js from https://nodejs.org and then run this script again.' -ForegroundColor Yellow
    exit 1
}
Write-Ok "Node.js $nodeVersion"

Write-Step '2) Install frontend dependencies'
if (-not (Test-Path 'node_modules' -PathType Container)) {
    Write-Host '    Running npm install (this may take a while the first time)...' -ForegroundColor Yellow
    npm install
    if ($LASTEXITCODE -ne 0) {
        Write-Fail 'npm install failed.'
        exit 1
    }
} else {
    Write-Ok 'node_modules already exists, skipping install'
}

Write-Step '3) Prepare local environment file'
$envPath = Join-Path $PSScriptRoot '.env'
$envExamplePath = Join-Path $PSScriptRoot '.env.example'

if (-not (Test-Path $envPath)) {
    if (Test-Path $envExamplePath) {
        Copy-Item -Path $envExamplePath -Destination $envPath -Force
        Write-Ok 'Copied .env.example -> .env'
    } else {
        @"
VITE_CLERK_PUBLISHABLE_KEY=pk_test_ZmFpdGhmdWwtZ25hdC03NTY1LmNsZXJrLmFjY291bnRzLmRldiQ
"@ | Set-Content -Path $envPath -Encoding utf8 -NoNewline
        Write-Ok 'Created .env with the provided Clerk publishable key'
    }
} else {
    Write-Ok '.env already exists, leaving it alone'
}

Write-Step '4) Start the dev server'
Write-Host '    The app will serve on http://localhost:5000 by default.' -ForegroundColor Yellow
npm run dev

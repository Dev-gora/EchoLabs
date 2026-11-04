# EchoLabs launcher.
#
# Starts the ASR service, the API server and the Vite dev server as hidden
# background processes, waits until the web port answers, opens the browser in
# its own tab, then exits. Nothing is left open in a console window.
#
# Stop everything with stop_fusion.bat (or scripts/fusion/stop.ps1).
# Logs: .tmp/logs/{asr,api,web}.log
# PIDs: .tmp/fusion-pids.json

$ErrorActionPreference = 'Stop'

$Root = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$StateDir = Join-Path $Root '.tmp'
$LogDir = Join-Path $StateDir 'logs'
$PidFile = Join-Path $StateDir 'fusion-pids.json'

$AsrPort = 8002
$ApiPort = 5002
$WebPort = 5174

New-Item -ItemType Directory -Force -Path $LogDir | Out-Null

function Stop-ListenersOnPort([int]$Port) {
    Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue |
        Select-Object -ExpandProperty OwningProcess -Unique |
        ForEach-Object {
            if ($_ -and $_ -ne 0) {
                Stop-Process -Id $_ -Force -ErrorAction SilentlyContinue
            }
        }
}

function Stop-PreviousRun {
    if (Test-Path $PidFile) {
        try {
            $saved = Get-Content $PidFile -Raw | ConvertFrom-Json
            foreach ($savedId in @($saved.asr, $saved.api, $saved.web)) {
                if ($savedId) {
                    Stop-Process -Id $savedId -Force -ErrorAction SilentlyContinue
                }
            }
        } catch {
            # A corrupt state file is not worth failing the launch over.
        }
        Remove-Item $PidFile -Force -ErrorAction SilentlyContinue
    }

    foreach ($port in @($AsrPort, $ApiPort, $WebPort)) {
        Stop-ListenersOnPort -Port $port
    }
}

function Start-Hidden([string]$Name, [string]$WorkDir, [string]$Command) {
    $log = Join-Path $LogDir "$Name.log"
    Remove-Item $log -Force -ErrorAction SilentlyContinue

    $process = Start-Process -FilePath 'cmd.exe' `
        -ArgumentList @('/c', "$Command > `"$log`" 2>&1") `
        -WorkingDirectory $WorkDir `
        -WindowStyle Hidden `
        -PassThru

    Write-Host ("    started {0,-4} (pid {1})" -f $Name, $process.Id)
    return $process.Id
}

function Wait-ForPort([int]$Port, [int]$TimeoutSeconds) {
    $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
    while ((Get-Date) -lt $deadline) {
        $client = New-Object System.Net.Sockets.TcpClient
        try {
            $client.Connect('127.0.0.1', $Port)
            return $true
        } catch {
            Start-Sleep -Milliseconds 500
        } finally {
            $client.Dispose()
        }
    }
    return $false
}

Write-Host 'EchoLabs - starting the local stack'
Stop-PreviousRun

$pids = [ordered]@{ asr = $null; api = $null; web = $null }

# ASR service (optional: only when Python and its packages are installed)
$python = Get-Command python -ErrorAction SilentlyContinue
if ($python) {
    & $python.Source -c 'import fastapi, uvicorn' 2>$null | Out-Null
    if ($LASTEXITCODE -eq 0) {
        $pids.asr = Start-Hidden -Name 'asr' `
            -WorkDir (Join-Path $Root 'artifacts\asr-service') `
            -Command "set ASR_PORT=$AsrPort&& `"$($python.Source)`" app.py"
    } else {
        Write-Host '    skipped asr (pip install -r artifacts\asr-service\requirements.txt)'
    }
} else {
    Write-Host '    skipped asr (python is not on PATH)'
}

# API server
if (Test-Path (Join-Path $Root 'artifacts\api-server\dist\index.mjs')) {
    $pids.api = Start-Hidden -Name 'api' `
        -WorkDir (Join-Path $Root 'artifacts\api-server') `
        -Command "set PORT=$ApiPort&& set ASR_SERVICE_URL=http://127.0.0.1:$AsrPort&& node --enable-source-maps ./dist/index.mjs"
} else {
    Write-Host '    skipped api (run pnpm --filter @workspace/api-server run build first)'
}

# Frontend
$pids.web = Start-Hidden -Name 'web' `
    -WorkDir (Join-Path $Root 'artifacts\fusion-coach') `
    -Command "set API_PROXY_TARGET=http://127.0.0.1:$ApiPort&& npx --yes vite --config vite.config.ts --host 127.0.0.1 --port $WebPort --strictPort"

$pids | ConvertTo-Json | Set-Content -Path $PidFile -Encoding utf8

if (Wait-ForPort -Port $WebPort -TimeoutSeconds 90) {
    $url = "http://localhost:$WebPort"
    Write-Host "EchoLabs is live at $url"
    Write-Host 'Stop it later with stop_fusion.bat'
    if ($env:ECHOLABS_NO_BROWSER -ne '1') {
        Start-Process $url
    }
} else {
    Write-Warning "The web server did not answer on port $WebPort. See .tmp\logs\web.log"
}

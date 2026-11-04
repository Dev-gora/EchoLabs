# Stops everything start_fusion.bat launched.
# Kills the recorded PIDs, then anything still listening on the EchoLabs ports.

$ErrorActionPreference = 'Stop'

$Root = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$PidFile = Join-Path $Root '.tmp\fusion-pids.json'

function Stop-ListenersOnPort([int]$Port) {
    Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue |
        Select-Object -ExpandProperty OwningProcess -Unique |
        ForEach-Object {
            if ($_ -and $_ -ne 0) {
                Stop-Process -Id $_ -Force -ErrorAction SilentlyContinue
            }
        }
}

if (Test-Path $PidFile) {
    try {
        $saved = Get-Content $PidFile -Raw | ConvertFrom-Json
        foreach ($savedId in @($saved.asr, $saved.api, $saved.web)) {
            if ($savedId) {
                Stop-Process -Id $savedId -Force -ErrorAction SilentlyContinue
            }
        }
    } catch {
        # Nothing to stop if the state file is unreadable.
    }
    Remove-Item $PidFile -Force -ErrorAction SilentlyContinue
}

foreach ($port in @(8002, 5002, 5174)) {
    Stop-ListenersOnPort -Port $port
}

Write-Host 'EchoLabs stopped.'

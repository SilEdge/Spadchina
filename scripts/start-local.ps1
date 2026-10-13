param(
    [switch]$SkipFrontend
)

$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$backendRoot = Join-Path $projectRoot 'backend'
$envFile = Join-Path $backendRoot '.env'

if (Test-Path -LiteralPath $envFile) {
    foreach ($line in Get-Content -LiteralPath $envFile) {
        if ($line -match '^([A-Z][A-Z0-9_]*)=(.*)$') {
            [Environment]::SetEnvironmentVariable($Matches[1], $Matches[2], 'Process')
        }
    }
}

function Test-LocalPort([int]$port) {
    return [bool](Get-NetTCPConnection -State Listen -LocalPort $port -ErrorAction SilentlyContinue)
}

if (-not (Test-LocalPort 8081)) {
    $binary = Join-Path $env:TEMP 'spadchina-backend-local.exe'
    Push-Location $backendRoot
    try {
        & go build -o $binary .
        if ($LASTEXITCODE -ne 0) { throw 'Go backend build failed' }
    } finally {
        Pop-Location
    }
    Start-Process -FilePath $binary -WorkingDirectory $backendRoot -WindowStyle Hidden `
        -RedirectStandardOutput (Join-Path $backendRoot 'server.stdout.log') `
        -RedirectStandardError (Join-Path $backendRoot 'server.stderr.log') | Out-Null
}

if (-not $SkipFrontend -and -not (Test-LocalPort 5173)) {
    Start-Process -FilePath (Get-Command npm.cmd).Source -ArgumentList 'run', 'dev' `
        -WorkingDirectory $projectRoot -WindowStyle Hidden `
        -RedirectStandardOutput (Join-Path $projectRoot 'frontend-dev.log') `
        -RedirectStandardError (Join-Path $projectRoot 'frontend-dev.err.log') | Out-Null
}

if ($env:NGROK_URL) {
    $existingTunnel = Get-CimInstance Win32_Process -Filter "Name='ngrok.exe'" |
        Where-Object { $_.CommandLine -like "*$($env:NGROK_URL)*" }
    if (-not $existingTunnel) {
        $proxyVariables = @('HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY', 'http_proxy', 'https_proxy', 'all_proxy')
        $previousProxy = @{}
        try {
            foreach ($name in $proxyVariables) {
                $previousProxy[$name] = [Environment]::GetEnvironmentVariable($name, 'Process')
                [Environment]::SetEnvironmentVariable($name, $null, 'Process')
            }
            Start-Process -FilePath (Get-Command ngrok).Source `
                -ArgumentList 'http', '8081', '--url', $env:NGROK_URL `
                -WorkingDirectory $projectRoot -WindowStyle Hidden `
                -RedirectStandardOutput (Join-Path $projectRoot 'ngrok.log') `
                -RedirectStandardError (Join-Path $projectRoot 'ngrok.err.log') | Out-Null
        } finally {
            foreach ($name in $proxyVariables) {
                [Environment]::SetEnvironmentVariable($name, $previousProxy[$name], 'Process')
            }
        }
    }
}

$health = $null
for ($attempt = 0; $attempt -lt 20; $attempt++) {
    try {
        $health = Invoke-RestMethod -Uri 'http://127.0.0.1:8081/api/health' -TimeoutSec 3
        if ($health.status -eq 'ok') { break }
    } catch { }
    Start-Sleep -Milliseconds 500
}
if ($health.status -ne 'ok') { throw 'Backend health check failed' }
Write-Output 'Backend: http://127.0.0.1:8081/api/health (ok)'
if (-not $SkipFrontend) { Write-Output 'Site: http://localhost:5173' }
if ($env:NGROK_URL) {
    $tunnelHealth = $null
    for ($attempt = 0; $attempt -lt 20; $attempt++) {
        try {
            $tunnelHealth = Invoke-RestMethod -Uri "$($env:NGROK_URL)/api/health" `
                -Headers @{ 'ngrok-skip-browser-warning' = 'true' } -TimeoutSec 3
            if ($tunnelHealth.status -eq 'ok') { break }
        } catch { }
        Start-Sleep -Milliseconds 500
    }
    if ($tunnelHealth.status -ne 'ok') { throw 'Ngrok tunnel health check failed' }
    Write-Output "Tunnel: $($env:NGROK_URL) (ok)"
}

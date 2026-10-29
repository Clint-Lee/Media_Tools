$ErrorActionPreference = 'Stop'
# Project-local tool runtime; does not replace system Node or read browser credentials.
$projectDirectory = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$toolDirectory = Join-Path $projectDirectory '.runtime/js-node'
$nodeExecutable = Join-Path $toolDirectory 'node.exe'
if (Test-Path -LiteralPath $nodeExecutable) {
    $installedVersion = & $nodeExecutable --version
    if ($LASTEXITCODE -eq 0 -and $installedVersion -match '^v(2[2-9]|[3-9][0-9])\.') {
        Write-Host "Project yt-dlp JavaScript runtime ready: $installedVersion"
        exit 0
    }
    throw 'Existing project JS runtime is incompatible; inspect .runtime/js-node before reinstalling.'
}
$nodeVersion = '24.22.2'
$archiveName = "node-v$nodeVersion-win-x64.zip"
$expectedHash = 'CA1BFF5D8EAD13C9F2EA404A176DB46BD430704D5B5113734049FA365E7799E2'
New-Item -ItemType Directory -Force $toolDirectory | Out-Null
$archiveFile = Join-Path $toolDirectory $archiveName
if (-not (Test-Path -LiteralPath $archiveFile)) {
    Invoke-WebRequest -Uri "https://nodejs.org/dist/v$nodeVersion/$archiveName" -OutFile $archiveFile -TimeoutSec 90
}
if ((Get-FileHash -LiteralPath $archiveFile -Algorithm SHA256).Hash -ne $expectedHash) {
    throw 'Node archive checksum mismatch; no executable was installed. Inspect the retained archive.'
}
Expand-Archive -LiteralPath $archiveFile -DestinationPath $toolDirectory -Force
Copy-Item -LiteralPath (Join-Path $toolDirectory "node-v$nodeVersion-win-x64/node.exe") -Destination $nodeExecutable
& $nodeExecutable --version
if ($LASTEXITCODE -ne 0) { throw 'Project JS runtime could not start.' }
Write-Host 'yt-dlp will use this project-local Node when the application runs under Node <22.'

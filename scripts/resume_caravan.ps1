$ErrorActionPreference = 'Continue'

$projectRoot = Split-Path -Parent $PSScriptRoot
$dataDirectory = Join-Path $projectRoot 'data\Caravan'
$logsDirectory = Join-Path $projectRoot 'logs'
$partialArchive = Join-Path $dataDirectory 'Caravan-nc.tar.gz.partial'
$archive = Join-Path $dataDirectory 'Caravan-nc.tar.gz'
$statusPath = Join-Path $logsDirectory 'download_status.txt'
$errorLog = Join-Path $logsDirectory 'transfer\resume_errors.log'
$sourceUrl = 'https://zenodo.org/records/15529786/files/Caravan-nc.tar.gz?download=1'
$expectedBytes = [int64]24775734275
$expectedMd5 = 'ad3a7767db059f218380e9cce5f72452'

New-Item -ItemType Directory -Path (Split-Path -Parent $errorLog) -Force |
    Out-Null
New-Item -ItemType Directory -Path $logsDirectory -Force | Out-Null

while (
    (-not (Test-Path -LiteralPath $partialArchive)) -or
    ((Get-Item -LiteralPath $partialArchive).Length -lt $expectedBytes)
) {
    & curl.exe --location --fail --retry 10 --retry-all-errors `
        --retry-delay 10 --continue-at - --output $partialArchive $sourceUrl `
        2>> $errorLog
    if (
        $LASTEXITCODE -eq 0 -and
        (Test-Path -LiteralPath $partialArchive) -and
        (Get-Item -LiteralPath $partialArchive).Length -ge $expectedBytes
    ) {
        break
    }
    Start-Sleep -Seconds 15
}

$actualMd5 = (Get-FileHash -LiteralPath $partialArchive -Algorithm MD5).Hash.ToLowerInvariant()
if (
    (Get-Item -LiteralPath $partialArchive).Length -eq $expectedBytes -and
    $actualMd5 -eq $expectedMd5
) {
    Move-Item -LiteralPath $partialArchive -Destination $archive -Force
    'complete and checksum verified' | Set-Content -LiteralPath $statusPath
} else {
    "size or checksum mismatch: $actualMd5" | Set-Content -LiteralPath $statusPath
    exit 1
}

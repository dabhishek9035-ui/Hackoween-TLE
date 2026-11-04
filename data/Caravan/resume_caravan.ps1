$ErrorActionPreference = 'Continue'
$targetPath = Join-Path $PSScriptRoot 'Caravan-nc.tar.gz.partial'
$targetSize = [int64]24775734275
$sourceUrl = 'https://zenodo.org/records/15529786/files/Caravan-nc.tar.gz?download=1'
$errorLog = Join-Path $PSScriptRoot 'resume-errors.log'

while ((-not (Test-Path -LiteralPath $targetPath)) -or ((Get-Item -LiteralPath $targetPath).Length -lt $targetSize)) {
    & curl.exe --location --fail --retry 10 --retry-all-errors --retry-delay 10 --continue-at - --output $targetPath $sourceUrl 2>> $errorLog
    if ($LASTEXITCODE -eq 0 -and (Test-Path -LiteralPath $targetPath) -and ((Get-Item -LiteralPath $targetPath).Length -ge $targetSize)) {
        break
    }
    Start-Sleep -Seconds 15
}

if ((Get-Item -LiteralPath $targetPath).Length -eq $targetSize) {
    $digest = (Get-FileHash -LiteralPath $targetPath -Algorithm MD5).Hash.ToLowerInvariant()
    if ($digest -eq 'ad3a7767db059f218380e9cce5f72452') {
        Move-Item -LiteralPath $targetPath -Destination (Join-Path $PSScriptRoot 'Caravan-nc.tar.gz') -Force
        'complete and checksum verified' | Set-Content -LiteralPath (Join-Path $PSScriptRoot 'download.status.txt')
    } else {
        "checksum mismatch: $digest" | Set-Content -LiteralPath (Join-Path $PSScriptRoot 'download.status.txt')
    }
}

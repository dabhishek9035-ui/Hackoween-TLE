$ErrorActionPreference = 'Stop'

$projectRoot = Split-Path -Parent $PSScriptRoot
$dataDirectory = Join-Path $projectRoot 'data\Caravan'
$modelsDirectory = Join-Path $projectRoot 'models'
$reportsDirectory = Join-Path $projectRoot 'reports'
$logsDirectory = Join-Path $projectRoot 'logs'
$partialArchive = Join-Path $dataDirectory 'Caravan-nc.tar.gz.partial'
$archive = Join-Path $dataDirectory 'Caravan-nc.tar.gz'
$expectedBytes = [int64]24775734275
$scanner = Join-Path $PSScriptRoot 'scan_missingness.py'
$splitGenerator = Join-Path $PSScriptRoot 'generate_public_split.py'
$attributeScanner = Join-Path $PSScriptRoot 'summarize_attributes.py'
$trainingScript = Join-Path $projectRoot 'train.py'
$statusPath = Join-Path $logsDirectory 'download_status.txt'
$scanLog = Join-Path $logsDirectory 'missingness_scan.log'
$trainingLog = Join-Path $logsDirectory 'full_benchmark.log'

$venvPython = Join-Path $projectRoot '.venv\Scripts\python.exe'
if (Test-Path -LiteralPath $venvPython) {
    $python = $venvPython
} else {
    $python = (Get-Command python -ErrorAction Stop).Source
}

New-Item -ItemType Directory -Path $modelsDirectory -Force | Out-Null
New-Item -ItemType Directory -Path $reportsDirectory -Force | Out-Null
New-Item -ItemType Directory -Path $logsDirectory -Force | Out-Null

function Invoke-PythonStep {
    param(
        [Parameter(Mandatory = $true)][string]$ScriptPath,
        [Parameter(Mandatory = $true)][string]$LogPath,
        [switch]$Append
    )

    $savedPreference = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    if ($Append) {
        & $python -u $ScriptPath *>> $LogPath
    } else {
        & $python -u $ScriptPath *> $LogPath
    }
    $stepExitCode = $LASTEXITCODE
    $ErrorActionPreference = $savedPreference
    return $stepExitCode
}

while ($true) {
    if (
        (Test-Path -LiteralPath $archive) -and
        (Get-Item -LiteralPath $archive).Length -eq $expectedBytes
    ) {
        break
    }

    if (
        (Test-Path -LiteralPath $partialArchive) -and
        (Get-Item -LiteralPath $partialArchive).Length -eq $expectedBytes
    ) {
        Start-Sleep -Seconds 60
        if (
            (Test-Path -LiteralPath $archive) -and
            (Get-Item -LiteralPath $archive).Length -eq $expectedBytes
        ) {
            break
        }
        if (
            (Test-Path -LiteralPath $partialArchive) -and
            (Get-Item -LiteralPath $partialArchive).Length -eq $expectedBytes
        ) {
            Move-Item -LiteralPath $partialArchive -Destination $archive `
                -Force -ErrorAction SilentlyContinue
            if (
                (Test-Path -LiteralPath $archive) -and
                (Get-Item -LiteralPath $archive).Length -eq $expectedBytes
            ) {
                break
            }
        }
    }

    $downloadedBytes = 0
    if (Test-Path -LiteralPath $archive) {
        $downloadedBytes = (Get-Item -LiteralPath $archive).Length
    } elseif (Test-Path -LiteralPath $partialArchive) {
        $downloadedBytes = (Get-Item -LiteralPath $partialArchive).Length
    }
    $percent = 100 * $downloadedBytes / $expectedBytes
    "Downloading Caravan: $downloadedBytes of $expectedBytes bytes ($('{0:N1}' -f $percent)%)." |
        Set-Content -LiteralPath $statusPath
    Start-Sleep -Seconds 60
}

'Archive size complete; checksum and full missingness scan running.' |
    Set-Content -LiteralPath $statusPath
$stepExitCode = Invoke-PythonStep -ScriptPath $scanner -LogPath $scanLog
if ($stepExitCode -ne 0) {
    "Archive verification or missingness scan failed ($stepExitCode). See $scanLog and finalizer.stderr.log." |
        Set-Content -LiteralPath $statusPath
    exit $stepExitCode
}

'Archive verified; rebuilding the catchment inventory and public split.' |
    Set-Content -LiteralPath $statusPath
$stepExitCode = Invoke-PythonStep `
    -ScriptPath $splitGenerator -LogPath $scanLog -Append
if ($stepExitCode -ne 0) {
    "Catchment inventory/split generation failed ($stepExitCode). See $scanLog." |
        Set-Content -LiteralPath $statusPath
    exit $stepExitCode
}

'Catchment inventory rebuilt; indexing attribute tables.' |
    Set-Content -LiteralPath $statusPath
$stepExitCode = Invoke-PythonStep `
    -ScriptPath $attributeScanner -LogPath $scanLog -Append
if ($stepExitCode -ne 0) {
    "Attribute inventory failed ($stepExitCode). See $scanLog." |
        Set-Content -LiteralPath $statusPath
    exit $stepExitCode
}

$preliminaryModels = Join-Path $modelsDirectory 'preliminary_partial_archive'
$preliminaryReports = Join-Path $reportsDirectory 'preliminary_partial_archive'
New-Item -ItemType Directory -Path $preliminaryModels -Force | Out-Null
New-Item -ItemType Directory -Path $preliminaryReports -Force | Out-Null

Get-ChildItem -LiteralPath $modelsDirectory -Filter 'caravan_streamflow_h*d.cbm' |
    ForEach-Object {
        Copy-Item -LiteralPath $_.FullName -Destination $preliminaryModels -Force
    }
foreach ($reportName in @('benchmark_metrics.json', 'per_catchment_metrics.csv')) {
    $reportPath = Join-Path $reportsDirectory $reportName
    if (Test-Path -LiteralPath $reportPath) {
        Copy-Item -LiteralPath $reportPath -Destination $preliminaryReports -Force
    }
}

'Archive, missingness, inventory, split, and attributes verified. Training all horizons.' |
    Set-Content -LiteralPath $statusPath
$stepExitCode = Invoke-PythonStep `
    -ScriptPath $trainingScript -LogPath $trainingLog
if ($stepExitCode -ne 0) {
    "Full 1/3/5-day benchmark training failed ($stepExitCode). See $trainingLog and finalizer.stderr.log." |
        Set-Content -LiteralPath $statusPath
    exit $stepExitCode
}

'Archive verified; full inventory, attributes, and coverage saved; 1-, 3-, and 5-day models and metrics saved.' |
    Set-Content -LiteralPath $statusPath

# Compatibility entry point; the maintained downloader lives under scripts/.
$projectRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$resumeScript = Join-Path $projectRoot 'scripts\resume_caravan.ps1'
& $resumeScript
exit $LASTEXITCODE

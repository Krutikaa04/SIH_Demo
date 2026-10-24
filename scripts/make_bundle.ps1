# Builds a portable, offline demo bundle (zip) to copy to a second laptop / USB stick.
# Run from the project root:   powershell -ExecutionPolicy Bypass -File scripts\make_bundle.ps1
$root = Split-Path -Parent $PSScriptRoot
$stage = Join-Path $env:TEMP "aicte_icmd_bundle"
$zip = Join-Path $root "AICTE_ICMD_demo_bundle.zip"
if (Test-Path $stage) { Remove-Item $stage -Recurse -Force }
New-Item -ItemType Directory $stage | Out-Null

python -m pip download -r (Join-Path $root "requirements.txt") -d (Join-Path $root "vendor\wheels")
if ($LASTEXITCODE -ne 0) { throw "Downloading the pinned runtime wheelhouse failed" }

$exclude = @("node_modules", "__pycache__", ".git", "demo.db", "uploads", "AICTE_ICMD_demo_bundle.zip", ".venv", ".pytest_cache", ".coverage")
Get-ChildItem $root -Force | Where-Object { $exclude -notcontains $_.Name } | ForEach-Object {
  if ($_.PSIsContainer) {
    robocopy $_.FullName (Join-Path $stage $_.Name) /E /XD node_modules __pycache__ uploads .venv .pytest_cache /XF demo.db /NFL /NDL /NJH /NJS /NP | Out-Null
  } else { Copy-Item $_.FullName $stage }
}
if (Test-Path $zip) { Remove-Item $zip -Force }
Compress-Archive -Path (Join-Path $stage "*") -DestinationPath $zip
Write-Host "Bundle ready: $zip"
Write-Host "On the other laptop: unzip, double-click start_demo.bat (needs Python 3.12+; no internet needed)."

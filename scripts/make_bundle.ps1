
# Builds a portable, offline demo bundle (zip) to copy to a second laptop / USB stick.
# Run from the project root: powershell -ExecutionPolicy Bypass -File scripts\make_bundle.ps1

$root = Split-Path -Parent $PSScriptRoot
$stage = Join-Path $env:TEMP "aicte_icmd_bundle"
$zip = Join-Path $root "AICTE_ICMD_demo_bundle.zip"

if (Test-Path $stage) {
  Remove-Item $stage -Recurse -Force
}
New-Item -ItemType Directory $stage | Out-Null

# Make sure the offline Python wheelhouse exists.
$wheelhouse = Join-Path $root "vendor\wheels"
if (-not (Test-Path $wheelhouse)) {
  New-Item -ItemType Directory $wheelhouse -Force | Out-Null
  python -m pip download -r (Join-Path $root "requirements.txt") -d $wheelhouse
  if ($LASTEXITCODE -ne 0) {
    throw "Downloading Python dependencies failed."
  }
}

# Build the frontend if the production files are missing.
$distIndex = Join-Path $root "frontend\dist\index.html"
if (-not (Test-Path $distIndex)) {
  if (-not (Get-Command npm -ErrorAction SilentlyContinue)) {
    throw "Frontend build is missing. Install Node.js and npm, then run npm run build in frontend."
  }

  Write-Host "Frontend build missing. Building frontend..."
  Push-Location (Join-Path $root "frontend")
  try {
    if (Test-Path "package-lock.json") {
      npm ci
    } else {
      npm install
    }
    if ($LASTEXITCODE -ne 0) {
      throw "Frontend dependency installation failed."
    }

    npm run build
    if ($LASTEXITCODE -ne 0) {
      throw "Frontend build failed."
    }
  } finally {
    Pop-Location
  }
}

if (-not (Test-Path $distIndex)) {
  throw "Frontend build did not produce frontend\dist\index.html."
}

# Copy the project, including the locally built frontend/dist directory.
$exclude = @(
  "node_modules",
  "__pycache__",
  ".git",
  "demo.db",
  "uploads",
  "AICTE_ICMD_demo_bundle.zip"
)

Get-ChildItem $root -Force |
  Where-Object { $exclude -notcontains $_.Name } |
  ForEach-Object {
    if ($_.PSIsContainer) {
      robocopy $_.FullName (Join-Path $stage $_.Name) /E /XD node_modules __pycache__ uploads /XF demo.db /NFL /NDL /NJH /NJS /NP | Out-Null
      if ($LASTEXITCODE -ge 8) {
        throw "Failed to copy folder: $($_.Name)"
      }
    } else {
      Copy-Item $_.FullName $stage
    }
  }

if (Test-Path $zip) {
  Remove-Item $zip -Force
}

Compress-Archive -Path (Join-Path $stage "*") -DestinationPath $zip

Write-Host "Bundle ready: $zip"
Write-Host "On the other laptop: unzip and double-click start_demo.bat (needs Python 3.11+; no internet needed)."

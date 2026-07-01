param(
  [string]$BuildDir = "app/build/windows/x64/runner/Release",
  [string]$CertificatePath,
  [string]$Password,
  [string]$OutputDir = "release-artifacts/windows"
)

$ErrorActionPreference = "Stop"

if ([string]::IsNullOrWhiteSpace($CertificatePath) -or [string]::IsNullOrWhiteSpace($Password)) {
  Write-Host "Signing certificate not provided; skipping Windows code signing."
  exit 0
}

if (-not (Test-Path $CertificatePath)) {
  throw "Certificate file not found: $CertificatePath"
}

if (-not (Test-Path $BuildDir)) {
  throw "Windows build directory not found: $BuildDir"
}

$signtool = Get-Command signtool.exe -ErrorAction SilentlyContinue
if (-not $signtool) {
  $signtoolCandidates = Get-ChildItem -Path "C:\Program Files (x86)\Windows Kits\10\bin" -Recurse -Filter signtool.exe -ErrorAction SilentlyContinue |
    Sort-Object FullName -Descending
  if ($signtoolCandidates) {
    $signtool = $signtoolCandidates[0].FullName
  }
}

if (-not $signtool) {
  throw "signtool.exe was not found. Install the Windows SDK or run this script on a Windows machine with signing tools."
}

$filesToSign = Get-ChildItem -Path $BuildDir -Recurse -Include *.exe,*.dll | Select-Object -ExpandProperty FullName
if (-not $filesToSign) {
  throw "No .exe or .dll files found in $BuildDir"
}

New-Item -ItemType Directory -Force -Path $OutputDir | Out-Null

foreach ($file in $filesToSign) {
  Write-Host "Signing $file"
  & $signtool sign /fd SHA256 /td SHA256 /tr http://timestamp.digicert.com /f $CertificatePath /p $Password $file
  if ($LASTEXITCODE -ne 0) {
    throw "Failed to sign $file"
  }
}

$mainExe = Get-ChildItem -Path $BuildDir -File -Filter *.exe | Select-Object -First 1
if ($mainExe) {
  Copy-Item $mainExe.FullName -Destination (Join-Path $OutputDir "localsend-bridge.exe") -Force
}

$zipPath = Join-Path $OutputDir "localsend-bridge-windows.zip"
Compress-Archive -Path (Join-Path $BuildDir "*") -DestinationPath $zipPath -Force

Write-Host "Created signed Windows archive: $zipPath"

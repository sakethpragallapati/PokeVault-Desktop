# Builds PokeVault-Setup.exe: the self-contained app (no .NET needed on the PC) packed into a small installer.
# Usage (from this folder):  powershell -ExecutionPolicy Bypass -File build-installer.ps1
$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot
$out = Join-Path $root 'dist'
$stage = Join-Path $out 'stage'
if (Test-Path $out) { Remove-Item -Recurse -Force $out }
New-Item -ItemType Directory -Force $stage | Out-Null

Write-Host '1/4 Publishing the app (self-contained, win-x64)...'
dotnet publish (Join-Path $root 'PokeVault.csproj') -c Release -r win-x64 --self-contained true `
  -p:DebugType=none -p:PublishReadyToRun=false -o (Join-Path $stage 'app')
if ($LASTEXITCODE) { throw 'publish failed' }

Write-Host '2/4 Packing it...'
$zip = Join-Path $stage 'app.zip'
Add-Type -AssemblyName System.IO.Compression.FileSystem
[System.IO.Compression.ZipFile]::CreateFromDirectory((Join-Path $stage 'app'), $zip, [System.IO.Compression.CompressionLevel]::Optimal, $false)

Write-Host '3/4 Building the uninstaller...'
dotnet build (Join-Path $root 'installer\Setup.csproj') -c Release -p:SetupName=Uninstall -o (Join-Path $stage 'uninstall')
if ($LASTEXITCODE) { throw 'uninstaller build failed' }

Write-Host '4/4 Building the installer...'
dotnet build (Join-Path $root 'installer\Setup.csproj') -c Release -p:SetupName=PokeVault-Setup `
  "-p:Payload=$zip" "-p:Uninstaller=$(Join-Path $stage 'uninstall\Uninstall.exe')" -o (Join-Path $stage 'setup')
if ($LASTEXITCODE) { throw 'installer build failed' }
Copy-Item (Join-Path $stage 'setup\PokeVault-Setup.exe') $out
$size = [math]::Round((Get-Item (Join-Path $out 'PokeVault-Setup.exe')).Length / 1MB, 1)
Write-Host "Done: dist\PokeVault-Setup.exe ($size MB)"

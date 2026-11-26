@echo off
rem Opens the installed PokeVault desktop app (your vault lives in %USERPROFILE%\PokeVault).
if exist "%LOCALAPPDATA%\Programs\PokeVault\PokeVault.exe" (
  start "" "%LOCALAPPDATA%\Programs\PokeVault\PokeVault.exe"
) else (
  echo PokeVault isn't installed yet. Download PokeVault-Setup.exe from the project's Releases page,
  echo or build it with:  powershell -ExecutionPolicy Bypass -File build-installer.ps1
  pause
)

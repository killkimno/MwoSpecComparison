@echo off
chcp 65001 >nul
cd /d "%~dp0"

powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$ErrorActionPreference='Stop';" ^
  "$root=(Get-Location).Path;" ^
  "$pidFile=Join-Path $root '.local-preview-server.pid';" ^
  "if (-not (Test-Path -LiteralPath $pidFile)) { Write-Host 'No local preview PID file found.'; exit 0 }" ^
  "$pidValue=(Get-Content -LiteralPath $pidFile -ErrorAction SilentlyContinue | Select-Object -First 1);" ^
  "if (-not ($pidValue -as [int])) { Remove-Item -LiteralPath $pidFile -Force; Write-Host 'Removed invalid PID file.'; exit 0 }" ^
  "$pidNumber=[int]$pidValue;" ^
  "$proc=Get-CimInstance Win32_Process -Filter \"ProcessId=$pidNumber\" -ErrorAction SilentlyContinue;" ^
  "if ($proc -and $proc.CommandLine -match 'local_preview_server\.ps1') { Stop-Process -Id $pidNumber -Force; Write-Host \"Stopped local preview server PID $pidNumber.\" } else { Write-Host 'PID file did not point to the local preview server.' }" ^
  "Remove-Item -LiteralPath $pidFile -Force -ErrorAction SilentlyContinue"

pause

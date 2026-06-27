@echo off
chcp 65001 >nul
cd /d "%~dp0"

powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$ErrorActionPreference='Stop';" ^
  "$root=(Get-Location).Path;" ^
  "$port=8000;" ^
  "$pidFile=Join-Path $root '.local-preview-server.pid';" ^
  "$serverScript=Join-Path $root 'tools\local_preview_server.ps1';" ^
  "$publicRoot=Join-Path $root 'public';" ^
  "$existing=Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue;" ^
  "if ($existing) { Write-Host \"Port $port is already in use. Opening http://127.0.0.1:$port/.\"; Start-Process \"http://127.0.0.1:$port/\"; exit 0 }" ^
  "if (-not (Test-Path -LiteralPath $serverScript)) { throw \"Missing local preview server: $serverScript\" }" ^
  "$argText=\"-NoProfile -ExecutionPolicy Bypass -File `\"$serverScript`\" -Port $port -Root `\"$publicRoot`\"\";" ^
  "$proc=Start-Process -FilePath 'powershell.exe' -ArgumentList $argText -WorkingDirectory $root -WindowStyle Hidden -PassThru;" ^
  "Set-Content -LiteralPath $pidFile -Value $proc.Id -Encoding ASCII;" ^
  "Start-Sleep -Seconds 1;" ^
  "Write-Host \"Local preview server started: http://127.0.0.1:$port/ (PID $($proc.Id))\";" ^
  "Start-Process \"http://127.0.0.1:$port/\""

pause

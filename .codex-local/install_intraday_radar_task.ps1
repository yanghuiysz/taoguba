$ErrorActionPreference = "Stop"

$taskName = "Taoguba Intraday Radar 5min"
$repo = "D:\github\taoguba"
$runner = Join-Path $repo ".codex-local\run_intraday_radar_task.ps1"

if (-not (Test-Path $runner)) {
  throw "Runner script not found: $runner"
}

$action = "powershell.exe -NoProfile -ExecutionPolicy Bypass -File `"$runner`""

$previousErrorActionPreference = $ErrorActionPreference
$ErrorActionPreference = "Continue"
schtasks.exe /Delete /TN $taskName /F 2>$null | Out-Null
$ErrorActionPreference = $previousErrorActionPreference
schtasks.exe /Create /TN $taskName /SC MINUTE /MO 5 /TR $action /F | Out-Null

Write-Output "Installed scheduled task: $taskName"
Write-Output "It runs every 5 minutes. The runner script skips weekends and non-trading windows."
Write-Output "Log file: $env:USERPROFILE\.codex\automation-logs\taoguba-intraday-radar.log"

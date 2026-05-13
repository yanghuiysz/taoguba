$ErrorActionPreference = "Stop"

$taskName = "Taoguba Intraday Radar 5min"
schtasks.exe /Delete /TN $taskName /F | Out-Null
Write-Output "Deleted scheduled task: $taskName"

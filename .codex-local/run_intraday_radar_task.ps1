$ErrorActionPreference = "Stop"

$repo = "D:\github\taoguba"
$logDir = Join-Path $env:USERPROFILE ".codex\automation-logs"
$logFile = Join-Path $logDir "taoguba-intraday-radar.log"
$lockFile = Join-Path $env:TEMP "taoguba-intraday-radar.lock"

New-Item -ItemType Directory -Path $logDir -Force | Out-Null

function Write-TaskLog {
  param([string]$Message)
  $stamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
  Add-Content -Path $logFile -Value "[$stamp] $Message" -Encoding UTF8
}

$now = Get-Date
$day = $now.DayOfWeek
$minutes = $now.Hour * 60 + $now.Minute

$inWeekday = $day -ne "Saturday" -and $day -ne "Sunday"
$inMorning = $minutes -ge (9 * 60 + 30) -and $minutes -le (11 * 60 + 30)
$inAfternoon = $minutes -ge (13 * 60) -and $minutes -le (15 * 60 + 5)

if (-not $inWeekday) {
  Write-TaskLog "Skip: weekend."
  exit 0
}

if (-not ($inMorning -or $inAfternoon)) {
  Write-TaskLog "Skip: outside trading window."
  exit 0
}

if (Test-Path $lockFile) {
  $age = $now - (Get-Item $lockFile).LastWriteTime
  if ($age.TotalMinutes -lt 10) {
    Write-TaskLog "Skip: previous run still active."
    exit 0
  }
  Remove-Item -LiteralPath $lockFile -Force
}

New-Item -ItemType File -Path $lockFile -Force | Out-Null

try {
  Set-Location $repo
  $date = $now.ToString("yyyyMMdd")
  Write-TaskLog "Start intraday radar refresh date=$date."

  $updateOutput = & python "scripts\update_daily_data.py" --date $date --intraday-custom --intraday-radar-only --custom-sleep 0 2>&1
  $updateCode = $LASTEXITCODE
  $updateOutput | ForEach-Object { Write-TaskLog "update: $_" }
  if ($updateCode -ne 0) {
    Write-TaskLog "Failed: update_daily_data.py exit code $updateCode."
    exit $updateCode
  }

  $validateOutput = & python "scripts\validate_web_data.py" 2>&1
  $validateCode = $LASTEXITCODE
  $validateOutput | ForEach-Object { Write-TaskLog "validate: $_" }
  if ($validateCode -ne 0) {
    Write-TaskLog "Failed: validate_web_data.py exit code $validateCode."
    exit $validateCode
  }

  Write-TaskLog "Success: intraday radar refreshed date=$date."
} finally {
  Remove-Item -LiteralPath $lockFile -Force -ErrorAction SilentlyContinue
}

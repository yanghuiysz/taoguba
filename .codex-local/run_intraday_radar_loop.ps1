$ErrorActionPreference = "Continue"

$repo = "D:\github\taoguba"
$logDir = Join-Path $env:USERPROFILE ".codex\automation-logs"
$logFile = Join-Path $logDir "taoguba-intraday-radar.log"
$lockFile = Join-Path $env:TEMP "taoguba-intraday-radar.lock"
$sleepSeconds = 60

New-Item -ItemType Directory -Path $logDir -Force | Out-Null

function Write-TaskLog {
  param([string]$Message)
  $stamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
  Add-Content -Path $logFile -Value "[$stamp] $Message" -Encoding UTF8
}

Write-TaskLog "=== Intraday radar loop started (interval=${sleepSeconds}s) ==="

while ($true) {
  $now = [System.TimeZoneInfo]::ConvertTimeBySystemTimeZoneId((Get-Date), 'China Standard Time')
  $day = $now.DayOfWeek
  $minutes = $now.Hour * 60 + $now.Minute

  $inWeekday = $day -ne "Saturday" -and $day -ne "Sunday"
  $inMorning = $minutes -ge (9 * 60 + 30) -and $minutes -le (11 * 60 + 30)
  $inAfternoon = $minutes -ge (13 * 60) -and $minutes -le (15 * 60 + 5)

  if (-not $inWeekday) {
    # Weekend: sleep longer to reduce CPU
    Start-Sleep -Seconds 300
    continue
  }

  if (-not ($inMorning -or $inAfternoon)) {
    Start-Sleep -Seconds $sleepSeconds
    continue
  }

  # Check lock
  if (Test-Path $lockFile) {
    $age = $now - (Get-Item $lockFile).LastWriteTime
    if ($age.TotalMinutes -lt 10) {
      Start-Sleep -Seconds $sleepSeconds
      continue
    }
    Remove-Item -LiteralPath $lockFile -Force -ErrorAction SilentlyContinue
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
      Remove-Item -LiteralPath $lockFile -Force -ErrorAction SilentlyContinue
      Start-Sleep -Seconds $sleepSeconds
      continue
    }

    $validateOutput = & python "scripts\validate_web_data.py" 2>&1
    $validateCode = $LASTEXITCODE
    $validateOutput | ForEach-Object { Write-TaskLog "validate: $_" }
    if ($validateCode -ne 0) {
      Write-TaskLog "Failed: validate_web_data.py exit code $validateCode."
    }

    Write-TaskLog "Success: intraday radar refreshed date=$date."
  } catch {
    Write-TaskLog "Error: $_"
  } finally {
    Remove-Item -LiteralPath $lockFile -Force -ErrorAction SilentlyContinue
  }

  Start-Sleep -Seconds $sleepSeconds
}

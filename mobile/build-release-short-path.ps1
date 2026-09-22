$ErrorActionPreference = "Stop"

$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot ".." )).Path
$drive = "M:"

try {
  $existing = subst $drive 2>$null
  if ($LASTEXITCODE -eq 0) {
    subst $drive /d | Out-Null
  }

  subst $drive $projectRoot | Out-Null
  Push-Location "$drive\mobile\android"
  .\gradlew.bat assembleRelease --no-daemon
}
finally {
  Pop-Location -ErrorAction SilentlyContinue
  subst $drive /d | Out-Null
}

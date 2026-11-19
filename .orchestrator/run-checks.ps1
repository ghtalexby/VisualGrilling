param([string[]]$Checks)
$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path $PSScriptRoot -Parent
Set-Location -LiteralPath $repoRoot
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$logRoot = Join-Path $PSScriptRoot "checks-$stamp"
New-Item -ItemType Directory -Path $logRoot | Out-Null
$previousHub = $env:GRILL_HUB_HOME
$results = @()
try {
  foreach ($check in $Checks) {
    $env:GRILL_HUB_HOME = Join-Path ([System.IO.Path]::GetTempPath()) ('grill-single-session-' + [guid]::NewGuid())
    $started = Get-Date
    $log = Join-Path $logRoot "$check.log"
    & node "dev/$check.mjs" *> $log
    $code = $LASTEXITCODE
    $row = [pscustomobject]@{ check=$check; exitCode=$code; seconds=[math]::Round(((Get-Date)-$started).TotalSeconds,2); log=$log; hub=$env:GRILL_HUB_HOME }
    $results += $row
    $results | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath (Join-Path $logRoot 'results.json') -Encoding utf8
    Write-Output "$check exit=$code seconds=$($row.seconds)"
    if ($code -ne 0) { Get-Content -LiteralPath $log -Tail 20 }
  }
} finally { $env:GRILL_HUB_HOME = $previousHub }
if ($results.Where({ $_.exitCode -ne 0 }).Count) { exit 1 }

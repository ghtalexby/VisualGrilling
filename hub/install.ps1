[CmdletBinding()]
param(
  [string]$StagingDir,
  [switch]$NoRegister,
  [switch]$NoBrowser,
  [ValidateSet('Developer','Store')][string]$Mode = 'Developer',
  [string]$StoreExtensionId,
  [string]$CodexPath
)
$ErrorActionPreference = 'Stop'
$repo = Split-Path -Parent $PSScriptRoot
if ($StagingDir -and (!$NoRegister -or !$NoBrowser)) { throw 'Staging requires -NoRegister -NoBrowser.' }
if ($Mode -eq 'Store' -and $StoreExtensionId -notmatch '^[a-p]{32}$') { throw 'Store mode requires a published Chrome Web Store extension ID.' }
$dataDir = if ($StagingDir) { [IO.Path]::GetFullPath($StagingDir) } elseif ($env:GRILL_HUB_HOME) { [IO.Path]::GetFullPath($env:GRILL_HUB_HOME) } else { Join-Path $env:LOCALAPPDATA 'VisualGrilling\Hub' }
$installDir = Join-Path $dataDir 'install'
$null = New-Item -ItemType Directory -Force -Path $installDir
# Protect the installation and secrets before creating credentials or executable files.
$sid = [Security.Principal.WindowsIdentity]::GetCurrent().User
$acl = New-Object Security.AccessControl.DirectorySecurity
$acl.SetOwner($sid)
$acl.SetAccessRuleProtection($true, $false)
$rule = New-Object Security.AccessControl.FileSystemAccessRule($sid, 'FullControl', 'ContainerInherit,ObjectInherit', 'None', 'Allow')
$acl.AddAccessRule($rule)
([IO.DirectoryInfo]$installDir).SetAccessControl($acl)
$nodeSource = (Get-Command node.exe -ErrorAction Stop).Source
$nodeVersion = & $nodeSource -p 'process.versions.node'
if ([int]($nodeVersion.Split('.')[0]) -lt 18) { throw 'Node.js 18 or later is required.' }
$nodePath = Join-Path $installDir 'node.exe'
if (!(Test-Path -LiteralPath $nodePath)) { Copy-Item -LiteralPath $nodeSource -Destination $nodePath }
$installedNodeVersion = & $nodePath -p 'process.versions.node'
if ([int]($installedNodeVersion.Split('.')[0]) -lt 18) { throw 'Installed Node.js is too old. Stop the Hub before replacing install/node.exe.' }
$skillSource = Join-Path $repo 'skills\grill'
$skillDest = Join-Path $installDir 'skills\grill'
$null = New-Item -ItemType Directory -Force -Path $skillDest
Copy-Item -Path (Join-Path $skillSource '*') -Destination $skillDest -Recurse -Force
Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'native.mjs') -Destination (Join-Path $installDir 'native.mjs') -Force
$extensionDir = Join-Path $installDir 'extension'
$null = New-Item -ItemType Directory -Force -Path $extensionDir
Copy-Item -Path (Join-Path $PSScriptRoot 'extension\*') -Destination $extensionDir -Recurse -Force
$key = Get-Content -LiteralPath (Join-Path $PSScriptRoot 'extension-key.json') -Raw | ConvertFrom-Json
$extensionId = if ($Mode -eq 'Store') { $StoreExtensionId } else { $key.extensionId }
$manifestPath = Join-Path $extensionDir 'manifest.json'
$extensionManifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
if ($Mode -eq 'Developer' -and $extensionManifest.key -ne $key.key) { throw 'Developer extension manifest key does not match native origin.' }
$origin = "chrome-extension://$extensionId/"
$configPath = Join-Path $installDir 'installation.json'
$previous = if (Test-Path -LiteralPath $configPath) { Get-Content -LiteralPath $configPath -Raw | ConvertFrom-Json } else { $null }
$random = New-Object byte[] 32
$rng = [Security.Cryptography.RandomNumberGenerator]::Create()
try { $rng.GetBytes($random) } finally { $rng.Dispose() }
$config = [ordered]@{
  installationId = if ($previous -and $previous.installationId) { $previous.installationId } else { [guid]::NewGuid().ToString() }
  secret = ([BitConverter]::ToString($random)).Replace('-','').ToLowerInvariant()
  epoch = [guid]::NewGuid().ToString()
  extensionId = $extensionId
  nodePath = $nodePath
  servicePath = Join-Path $skillDest 'hub\service.mjs'
  dataDir = $dataDir
}
# Resolve a real executable or JavaScript entry point now; Chrome need not inherit a terminal PATH.
$codexCandidate = $CodexPath
if (!$codexCandidate -and $env:CODEX_MANAGED_PACKAGE_ROOT) {
  $managedEntry = Join-Path $env:CODEX_MANAGED_PACKAGE_ROOT 'bin\codex.js'
  if (Test-Path -LiteralPath $managedEntry) { $codexCandidate = $managedEntry }
}
if (!$codexCandidate) {
  $codexCommand = Get-Command codex -ErrorAction SilentlyContinue
  if ($codexCommand) {
    if ([IO.Path]::GetExtension($codexCommand.Source) -eq '.exe') { $codexCandidate = $codexCommand.Source }
    else {
      $npmEntry = Join-Path (Split-Path -Parent $codexCommand.Source) 'node_modules\@openai\codex\bin\codex.js'
      if (Test-Path -LiteralPath $npmEntry) { $codexCandidate = $npmEntry }
    }
  }
}
if ($codexCandidate) {
  $codexCandidate = (Get-Item -LiteralPath $codexCandidate).FullName
  switch ([IO.Path]::GetExtension($codexCandidate).ToLowerInvariant()) {
    '.exe' { $config.codexCommand = $codexCandidate; $config.codexArgs = @() }
    '.js' { $config.codexCommand = $nodePath; $config.codexArgs = @($codexCandidate) }
    default { throw 'CodexPath must be a native .exe or a JavaScript .js entry point, never a shell wrapper.' }
  }
} else { Write-Warning 'Codex executable was not found. Re-run with -CodexPath before using background Play.' }
if (!(Test-Path -LiteralPath $config.servicePath)) { throw 'Hub service is missing from the skill package.' }
$utf8 = New-Object Text.UTF8Encoding($false)
$source = Get-Content -LiteralPath (Join-Path $PSScriptRoot 'NativeHost.cs') -Raw
$source = $source.Replace('@@NODE@@', $nodePath.Replace('"','""')).Replace('@@SCRIPT@@', (Join-Path $installDir 'native.mjs').Replace('"','""')).Replace('@@CONFIG@@', $configPath.Replace('"','""')).Replace('@@ORIGIN@@', $origin)
$compiler = Join-Path ([Runtime.InteropServices.RuntimeEnvironment]::GetRuntimeDirectory()) 'csc.exe'
if (!(Test-Path -LiteralPath $compiler)) { $compiler = Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe' }
if (!(Test-Path -LiteralPath $compiler)) { throw '.NET Framework C# compiler is required.' }
$buildId = [guid]::NewGuid().ToString('N')
$sourceFile = Join-Path $installDir "NativeHost-$buildId.cs"
$hostPath = Join-Path $installDir "native-host-$buildId.exe"
[IO.File]::WriteAllText($sourceFile, $source, $utf8)
try {
  & $compiler /nologo /target:winexe "/out:$hostPath" $sourceFile
  if ($LASTEXITCODE -ne 0) { throw 'Native launcher compilation failed.' }
} finally { Remove-Item -LiteralPath $sourceFile -Force }
$nativeManifest = [ordered]@{ name = 'com.visualgrilling.hub'; description = 'VisualGrilling local boards'; path = $hostPath; type = 'stdio'; allowed_origins = @($origin) }
$nativeManifestPath = Join-Path $installDir 'native-host.json'
function Write-AtomicJson($destination, $value) {
  $temporary = "$destination.$([guid]::NewGuid().ToString('N')).tmp"
  [IO.File]::WriteAllText($temporary, ($value | ConvertTo-Json -Depth 12), $utf8)
  if (Test-Path -LiteralPath $destination) {
    $backup = "$temporary.bak"
    [IO.File]::Replace($temporary, $destination, $backup)
    Remove-Item -LiteralPath $backup -Force
  } else { [IO.File]::Move($temporary, $destination) }
}
Write-AtomicJson $configPath $config
Write-AtomicJson $nativeManifestPath $nativeManifest
if (!$NoRegister) {
  $registryPath = 'HKCU:\Software\Google\Chrome\NativeMessagingHosts\com.visualgrilling.hub'
  $null = New-Item -Path $registryPath -Force
  Set-Item -LiteralPath $registryPath -Value $nativeManifestPath
}
Write-Host "Local component prepared: $installDir"
if ($NoRegister) { Write-Host 'Fixture mode: Chrome registration was not changed.' }
if ($Mode -eq 'Developer') {
  Write-Host "Developer setup requires Chrome confirmation: open chrome://extensions, enable Developer mode, click Load unpacked, and select $extensionDir"
  Write-Host 'After reinstall, reload the extension. It binds automatically when opened; no secret copying is required.'
  if (!$NoBrowser) { Start-Process 'chrome.exe' -ArgumentList 'chrome://extensions' -WindowStyle Hidden }
} else {
  Write-Host 'Complete installation on the Chrome Web Store page and confirm Add extension in Chrome.'
  if (!$NoBrowser) { Start-Process "https://chromewebstore.google.com/detail/$extensionId" -WindowStyle Hidden }
}
Write-Host 'Open the extension to verify connectivity. This installer does not claim browser or post-reboot verification.'

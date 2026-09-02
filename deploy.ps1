param(
  [Parameter(ValueFromRemainingArguments = $true)]
  [string[]]$ArgsRest
)
$ErrorActionPreference = 'Stop'
$env:NODE_USE_ENV_PROXY = '1'
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $here

function Get-PortableNode {
  $homeDir = Join-Path $here 'work\tools\node'
  if (Test-Path $homeDir) {
    $exe = Get-ChildItem -LiteralPath $homeDir -Filter node.exe -Recurse -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($exe) { return $exe.FullName }
  }
  $ver = '22.20.0'
  $arch = if ($env:PROCESSOR_ARCHITECTURE -eq 'ARM64') { 'arm64' } else { 'x64' }
  $name = "node-v$ver-win-$arch.zip"
  $urls = @(
    "https://nodejs.org/dist/v$ver/$name",
    "https://npmmirror.com/mirrors/node/v$ver/$name",
    "https://cdn.npmmirror.com/binaries/node/v$ver/$name"
  )
  $tools = Join-Path $here 'work\tools'
  New-Item -ItemType Directory -Force -Path $tools | Out-Null
  $zip = Join-Path $tools $name
  $ok = $false
  foreach ($url in $urls) {
    try {
      Write-Host "Download $url"
      Invoke-WebRequest -Uri $url -OutFile $zip -UseBasicParsing
      $ok = $true
      break
    } catch {
      Write-Host "failed: $($_.Exception.Message)"
    }
  }
  if (-not $ok) { throw 'Failed to download Node.js 22. Install from https://nodejs.org/ and retry.' }
  $unpack = Join-Path $tools ('node-unpack-' + [DateTimeOffset]::UtcNow.ToUnixTimeSeconds())
  New-Item -ItemType Directory -Force -Path $unpack | Out-Null
  tar -xf $zip -C $unpack
  if (-not $?) {
    Expand-Archive -LiteralPath $zip -DestinationPath $unpack -Force
  }
  New-Item -ItemType Directory -Force -Path $homeDir | Out-Null
  $top = Get-ChildItem -LiteralPath $unpack | Select-Object -First 1
  if ($top.PSIsContainer) {
    Copy-Item -Path (Join-Path $top.FullName '*') -Destination $homeDir -Recurse -Force
  } else {
    Copy-Item -Path (Join-Path $unpack '*') -Destination $homeDir -Recurse -Force
  }
  Remove-Item -Recurse -Force $unpack -ErrorAction SilentlyContinue
  Remove-Item -Force $zip -ErrorAction SilentlyContinue
  $exe = Get-ChildItem -LiteralPath $homeDir -Filter node.exe -Recurse -ErrorAction SilentlyContinue | Select-Object -First 1
  if (-not $exe) { throw 'Portable Node extract failed' }
  return $exe.FullName
}

$node = Get-Command node -ErrorAction SilentlyContinue
if ($node) {
  & node .\deploy.mjs @ArgsRest
  exit $LASTEXITCODE
}
Write-Host 'Need Node.js 22+. Downloading portable Node...'
$exe = Get-PortableNode
& $exe .\deploy.mjs @ArgsRest
exit $LASTEXITCODE
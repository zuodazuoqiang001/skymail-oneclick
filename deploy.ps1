param(
  [Parameter(ValueFromRemainingArguments = $true)]
  [string[]]$ArgsRest
)
$ErrorActionPreference = 'Stop'
$env:NODE_USE_ENV_PROXY = '1'
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$node = Get-Command node -ErrorAction SilentlyContinue
if (-not $node) {
  Write-Host 'Need Node.js 20+  https://nodejs.org/'
  exit 1
}
Set-Location $here
node .\deploy.mjs @ArgsRest
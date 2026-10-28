# Windows wrapper: .\install.ps1 [-Target both|claude|opencode] [-Scope user|project] [-Level full] [-ScoutModel provider/model]
#                  [-Codegraph | -NoCodegraph] [-CodegraphCli <path>] [-OpencodeVersion 1|2] [-Squeeze | -NoSqueeze]
#                  [-Guard | -NoGuard] [-Project <dir>] [-Uninstall] [-DryRun]
param(
  [ValidateSet('', 'both', 'claude', 'opencode')][string]$Target = '',
  [ValidateSet('user', 'project')][string]$Scope = 'user',
  [ValidateSet('', 'lite', 'full', 'ultra')][string]$Level = '',
  [string]$ScoutModel = '',
  [string]$CodegraphCli = '',
  [string]$Project = '',
  [ValidateSet('', '1', '2')][string]$OpencodeVersion = '',
  [switch]$Codegraph, [switch]$NoCodegraph,
  [switch]$Squeeze, [switch]$NoSqueeze, [switch]$Guard, [switch]$NoGuard, [switch]$Uninstall, [switch]$DryRun
)
if (-not (Get-Command node -ErrorAction SilentlyContinue)) { Write-Error 'wesh needs Node.js 18+ (https://nodejs.org)'; exit 1 }
$a = @('--scope', $Scope)
if ($Level) { $a += @('--level', $Level) }
if ($Target) { $a += @('--target', $Target) }
if ($ScoutModel) { $a += @('--scout-model', $ScoutModel) }
if ($Squeeze) { $a += '--squeeze' }
if ($NoSqueeze) { $a += '--no-squeeze' }
if ($NoGuard) { $a += '--no-guard' }
if ($Codegraph) { $a += '--codegraph' }
if ($NoCodegraph) { $a += '--no-codegraph' }
# A trailing backslash would escape the closing quote when Windows PowerShell 5.1 passes the path to node.
if ($CodegraphCli) { $a += @('--codegraph-cli', ($CodegraphCli -replace '(?<!:)\\+$', '')) }
if ($Project) { $a += @('--project', ($Project -replace '(?<!:)\\+$', '')) }
if ($OpencodeVersion) { $a += @('--opencode-version', $OpencodeVersion) }
if ($Guard) { $a += '--guard' }
if ($Uninstall) { $a += '--uninstall' }
if ($DryRun) { $a += '--dry-run' }
node (Join-Path $PSScriptRoot 'install.mjs') @a
exit $LASTEXITCODE

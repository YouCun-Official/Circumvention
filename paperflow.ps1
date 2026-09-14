param(
    [Parameter(Mandatory=$false)][string]$Topic,
    [string]$Urls,
    [ValidateRange(1,20)][int]$Count = 3,
    [string]$Venues = 'all',
    [string]$Tracks = 'all',
    [string]$Years,
    [ValidateSet('compact','standard','detailed')][string]$Length = 'standard',
    [ValidateSet('paged','long')][string]$Pdf = 'paged',
    [ValidateRange(0,10)][int]$Figures = 5,
    [string]$Editor,
    [string]$Reviewer
)

$projectDir = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location -LiteralPath $projectDir
if (-not (Test-Path -LiteralPath 'node_modules')) { & (Join-Path $projectDir 'install.ps1') }

$arguments = @('src/cli.js', '--count', $Count, '--venues', $Venues, '--tracks', $Tracks, '--length', $Length, '--pdf', $Pdf, '--figures', $Figures)
if ($Topic) { $arguments += @('--topic', $Topic) }
if ($Urls) { $arguments += @('--urls', $Urls) }
if ($Years) { $arguments += @('--years', $Years) }
if ($Editor) { $arguments += @('--editor', $Editor) }
if ($Reviewer) { $arguments += @('--reviewer', $Reviewer) }
node @arguments
exit $LASTEXITCODE

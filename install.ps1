$ErrorActionPreference = 'Stop'
$projectDir = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location -LiteralPath $projectDir

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    throw '未找到 Node.js 20 或更高版本。请先安装 Node.js LTS：https://nodejs.org/'
}

$major = [int]((node --version).TrimStart('v').Split('.')[0])
if ($major -lt 20) {
    throw "当前 Node.js 版本过低：$(node --version)。需要 Node.js 20 或更高版本。"
}

Write-Host '正在安装依赖，请稍候……'
$npmCache = Join-Path $projectDir '.npm-cache'
npm install --cache $npmCache
if ($LASTEXITCODE -ne 0) { throw '依赖安装失败。' }

if (-not (Test-Path -LiteralPath '.env')) {
    Copy-Item -LiteralPath '.env.example' -Destination '.env'
}

Write-Host ''
Write-Host '安装完成。请填写 .env，然后运行：'
Write-Host '.\paperflow.cmd --topic "multimodal agents" --count 3'

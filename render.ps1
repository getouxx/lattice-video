<#
.SYNOPSIS
    folia lattice 歌词视频一键渲染脚本。
.DESCRIPTION
    用法:
      .\render.ps1 -Audio 音频.mp3 -Lyric 歌词.lrc [-Output 输出.mp4] [-Fps 30] [-Width 1280] [-Height 720] [-Cover 封面.jpg]
    首次运行自动安装依赖并打包；之后增量跳过。
    需要: Node.js (PATH 或本机便携版)、Chrome/Edge (任一)、ffmpeg (PATH 或 pip install imageio-ffmpeg)。
#>
param(
    [Parameter(Mandatory = $true)] [string]$Audio,
    [Parameter(Mandatory = $true)] [string]$Lyric,
    [string]$Output = "",
    [int]$Fps = 30,
    [int]$Width = 1280,
    [int]$Height = 720,
    [string]$Cover = ""
)

$ErrorActionPreference = 'Stop'
$ToolRoot = $PSScriptRoot

# --- 定位 node / npm: 优先 PATH, 其次本机便携版布局 (workspace/dl/node) ---
function Find-Node {
    $cmd = Get-Command node -ErrorAction SilentlyContinue
    if ($cmd) { return @{ Node = $cmd.Source; Npm = (Get-Command npm -ErrorAction SilentlyContinue).Source } }
    $portable = Join-Path $ToolRoot '..\dl\node\node-v22.23.3-win-x64'
    if (Test-Path (Join-Path $portable 'node.exe')) {
        return @{ Node = (Join-Path $portable 'node.exe'); Npm = (Join-Path $portable 'npm.cmd') }
    }
    throw '找不到 Node.js: 请安装 Node.js 并加入 PATH (https://nodejs.org)'
}
$runtime = Find-Node

# --- temp 重定向: 某些环境 AppData temp 被 ACL 限制, 统一用工具目录内临时区 ---
$env:TEMP = Join-Path $ToolRoot '.render-work\tmp'
$env:TMP = $env:TEMP
New-Item -ItemType Directory -Force -Path $env:TEMP | Out-Null

Push-Location $ToolRoot
try {
    # --- 首次: 安装依赖 ---
    if (-not (Test-Path 'node_modules')) {
        Write-Host '[setup] 首次运行, 安装依赖 ...'
        if (-not $runtime.Npm) { throw '找不到 npm, 请完整安装 Node.js' }
        & $runtime.Npm install --no-audit --no-fund
        if ($LASTEXITCODE -ne 0) { throw 'npm install 失败' }
    }

    # --- 打包 (vendor 或源码更新后会因时间戳变化自动重打; 手动强制可删除 dist) ---
    if (-not (Test-Path 'dist\harness.bundle.js')) {
        Write-Host '[setup] 打包渲染器 ...'
        & $runtime.Node 'src\build.mjs'
        if ($LASTEXITCODE -ne 0) { throw 'esbuild 打包失败' }
    }

    # --- 渲染 + 合成 ---
    $args = @('src\render.mjs', $Audio, $Lyric)
    if ($Output) { $args += $Output }
    $args += @('--fps', "$Fps", '--width', "$Width", '--height', "$Height")
    if ($Cover) { $args += @('--cover', $Cover) }
    & $runtime.Node @args
    exit $LASTEXITCODE
}
finally { Pop-Location }

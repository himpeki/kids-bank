# ルールテストの実行ヘルパ。
# システムの Java が古い(11未満)環境向けに、プロジェクト内 .jre のポータブルJREを使って npm test を回す。
# 使い方: pwsh -File tools/test.ps1
$ErrorActionPreference = "Stop"
$root = Split-Path $PSScriptRoot -Parent

$jre = Get-ChildItem (Join-Path $root ".jre") -Directory -ErrorAction SilentlyContinue | Select-Object -First 1
if ($jre) {
    $env:JAVA_HOME = $jre.FullName
    $env:Path = "$($jre.FullName)\bin;$env:Path"
    Write-Host "JAVA_HOME = $($jre.FullName)"
}

Push-Location $root
try {
    npm test
    exit $LASTEXITCODE
} finally {
    Pop-Location
}

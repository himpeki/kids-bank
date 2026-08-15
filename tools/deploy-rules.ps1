# セキュリティルールのデプロイ。
# rules/firestore.rules の __SETUP_KEY__ を「あいことば」に置換してからデプロイする。
# あいことばは rules/setup-key.local.txt に保存される(gitignore 済み・初回は自動生成)。
#
# 使い方:
#   1) npm install(初回のみ)
#   2) npx firebase login(初回のみ)
#   3) npx firebase use --add で本番プロジェクトを選択(初回のみ)
#   4) pwsh -File tools/deploy-rules.ps1

$ErrorActionPreference = "Stop"
$root = Split-Path $PSScriptRoot -Parent
$keyFile = Join-Path $root "rules\setup-key.local.txt"
$src = Join-Path $root "rules\firestore.rules"
$dst = Join-Path $root "rules\firestore.deploy.rules"

if (-not (Test-Path $keyFile)) {
    # 初回: ランダムなあいことばを生成(セットアップ画面で入力する値)
    $chars = "abcdefghijkmnpqrstuvwxyz23456789"
    $key = -join (1..16 | ForEach-Object { $chars[(Get-Random -Maximum $chars.Length)] })
    Set-Content -Path $keyFile -Value $key -NoNewline -Encoding UTF8
    Write-Host "あいことばを生成しました: $key"
    Write-Host "(rules/setup-key.local.txt に保存。セットアップ画面でこの値を入力します)"
}

$key = (Get-Content $keyFile -Raw).Trim()
(Get-Content $src -Raw).Replace("__SETUP_KEY__", $key) | Set-Content -Path $dst -NoNewline -Encoding UTF8
Write-Host "rules/firestore.deploy.rules を生成しました"

Push-Location $root
try {
    npx firebase deploy --only "firestore:rules,firestore:indexes"
} finally {
    Pop-Location
}

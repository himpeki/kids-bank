# PWA用アイコンを生成する(Windows / System.Drawing 使用)
# 使い方: pwsh -File tools/make-icons.ps1
Add-Type -AssemblyName System.Drawing

$outDir = Join-Path $PSScriptRoot "..\icons"
New-Item -ItemType Directory -Force $outDir | Out-Null

function New-Icon([int]$size, [string]$path) {
    $bmp = New-Object System.Drawing.Bitmap($size, $size)
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.SmoothingMode = "AntiAlias"
    $g.TextRenderingHint = "AntiAliasGridFit"

    # 角丸の背景(ピンク→オレンジのグラデーション)
    $rect = New-Object System.Drawing.Rectangle(0, 0, $size, $size)
    $brush = New-Object System.Drawing.Drawing2D.LinearGradientBrush(
        $rect,
        [System.Drawing.Color]::FromArgb(255, 143, 171),
        [System.Drawing.Color]::FromArgb(255, 183, 3),
        45)
    $r = [int]($size * 0.22)
    $gp = New-Object System.Drawing.Drawing2D.GraphicsPath
    $gp.AddArc(0, 0, $r * 2, $r * 2, 180, 90)
    $gp.AddArc($size - $r * 2, 0, $r * 2, $r * 2, 270, 90)
    $gp.AddArc($size - $r * 2, $size - $r * 2, $r * 2, $r * 2, 0, 90)
    $gp.AddArc(0, $size - $r * 2, $r * 2, $r * 2, 90, 90)
    $gp.CloseFigure()
    $g.FillPath($brush, $gp)

    # コイン
    $coinBrush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(255, 214, 90))
    $edgePen = New-Object System.Drawing.Pen([System.Drawing.Color]::FromArgb(230, 170, 40), [Math]::Max(2, $size * 0.02))
    $cm = [int]($size * 0.16)
    $g.FillEllipse($coinBrush, $cm, $cm, $size - $cm * 2, $size - $cm * 2)
    $g.DrawEllipse($edgePen, $cm, $cm, $size - $cm * 2, $size - $cm * 2)

    # ¥ マーク
    $font = New-Object System.Drawing.Font("Segoe UI", [int]($size * 0.36), [System.Drawing.FontStyle]::Bold)
    $fmt = New-Object System.Drawing.StringFormat
    $fmt.Alignment = "Center"
    $fmt.LineAlignment = "Center"
    $textBrush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(150, 100, 20))
    $g.DrawString([char]0x00A5, $font, $textBrush, (New-Object System.Drawing.RectangleF(0, 0, $size, $size)), $fmt)

    $g.Dispose()
    $bmp.Save($path, [System.Drawing.Imaging.ImageFormat]::Png)
    $bmp.Dispose()
    Write-Host "generated: $path"
}

New-Icon 192 (Join-Path $outDir "icon-192.png")
New-Icon 512 (Join-Path $outDir "icon-512.png")
New-Icon 180 (Join-Path $outDir "icon-180.png")

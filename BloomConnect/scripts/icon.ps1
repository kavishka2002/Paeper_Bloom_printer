Add-Type -AssemblyName System.Drawing
$ErrorActionPreference='Stop'
$source=[Drawing.Image]::FromFile((Join-Path $PSScriptRoot '../apps/renderer/public/bloomconnect-logo.png'))
$sizes=16,24,32,48,64,128,256
try {
    $frames=foreach($size in $sizes){
        $bitmap=[Drawing.Bitmap]::new($size,$size)
        $canvas=[Drawing.Graphics]::FromImage($bitmap)
        $png=[IO.MemoryStream]::new()
        try {
            $canvas.InterpolationMode=[Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
            $canvas.DrawImage($source,0,0,$size,$size)
            $bitmap.Save($png,[Drawing.Imaging.ImageFormat]::Png)
            @{size=$size;bytes=$png.ToArray()}
        } finally {$png.Dispose();$canvas.Dispose();$bitmap.Dispose()}
    }
    $path=Join-Path $PSScriptRoot '../resources/icon.ico'
    $writer=[IO.BinaryWriter]::new([IO.File]::Create($path))
    try {
        $writer.Write([uint16]0)
        $writer.Write([uint16]1)
        $writer.Write([uint16]$frames.Count)
        $offset=6+16*$frames.Count
        foreach($frame in $frames){
            $dimension=[byte]($frame.size % 256)
            $writer.Write($dimension);$writer.Write($dimension);$writer.Write([uint16]0)
            $writer.Write([uint16]1);$writer.Write([uint16]32)
            $writer.Write([uint32]$frame.bytes.Length);$writer.Write([uint32]$offset)
            $offset+=$frame.bytes.Length
        }
        foreach($frame in $frames){$writer.Write([byte[]]$frame.bytes)}
    } finally {$writer.Dispose()}
} finally {$source.Dispose()}

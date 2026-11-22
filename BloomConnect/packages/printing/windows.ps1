param([ValidateSet('capabilities','submit')][string]$Action='capabilities',[Parameter(Mandatory=$true)][string]$InputFile)
$ErrorActionPreference='Stop'
[Console]::OutputEncoding=[System.Text.UTF8Encoding]::new($false)
Add-Type -AssemblyName System.Drawing
$request=Get-Content -LiteralPath $InputFile -Raw -Encoding UTF8 | ConvertFrom-Json
$settings=[System.Drawing.Printing.PrinterSettings]::new()
$settings.PrinterName=[string]$request.printer
if(-not $settings.IsValid){throw 'This Windows printer is unavailable.'}
$page=$settings.DefaultPageSettings
$papers=@($settings.PaperSizes | ForEach-Object { [pscustomobject]@{id=$_.RawKind;name=$_.PaperName;widthMm=[Math]::Round($_.Width*0.254,3);heightMm=[Math]::Round($_.Height*0.254,3)} })
if($request.widthMm -and $request.heightMm){
  $match=$settings.PaperSizes | Where-Object { [Math]::Abs($_.Width*0.254-$request.widthMm) -lt 1.1 -and [Math]::Abs($_.Height*0.254-$request.heightMm) -lt 1.1 } | Select-Object -First 1
  if($match){$page.PaperSize=$match}
  elseif($request.allowCustom){$page.PaperSize=[System.Drawing.Printing.PaperSize]::new('BloomConnect custom',[int][Math]::Round($request.widthMm/0.254),[int][Math]::Round($request.heightMm/0.254))}
  elseif($Action -eq 'submit'){throw 'The Windows driver does not advertise the requested paper size.'}
}
$page.Landscape=[bool]$request.landscape
if($Action -eq 'capabilities'){
  $printerName=$settings.PrinterName.Replace('\','\\').Replace("'","\'")
  $device=Get-CimInstance -ClassName Win32_Printer -Filter "Name = '$printerName'" | Select-Object -First 1
  $area=$page.PrintableArea
  $size=$page.Bounds
  $left=[Math]::Max(0,$area.X*0.254);$top=[Math]::Max(0,$area.Y*0.254)
  $right=[Math]::Max(0,($size.Width-$area.Right)*0.254);$bottom=[Math]::Max(0,($size.Height-$area.Bottom)*0.254)
  [pscustomobject]@{
    name=$settings.PrinterName;driver=[string]$device.DriverName;model=[string]$device.DriverName;port=[string]$device.PortName;
    offline=[bool]$device.WorkOffline;status=[int]$device.PrinterStatus;error=[int]$device.DetectedErrorState;
    duplex=$settings.CanDuplex;colour=$settings.SupportsColor;maximumCopies=$settings.MaximumCopies;
    papers=$papers;trays=@($settings.PaperSources | ForEach-Object { [pscustomobject]@{id=$_.RawKind;name=$_.SourceName} });
    resolutions=@($settings.PrinterResolutions | Where-Object {$_.X -gt 0 -and $_.Y -gt 0} | ForEach-Object {[pscustomobject]@{x=$_.X;y=$_.Y}});
    printable=[pscustomobject]@{left=$left;right=$right;top=$top;bottom=$bottom};
    borderless=($left -lt 0.1 -and $right -lt 0.1 -and $top -lt 0.1 -and $bottom -lt 0.1);
    source='Windows System.Drawing.Printing / Win32_Printer';queriedAt=[DateTime]::UtcNow.ToString('o')
  } | ConvertTo-Json -Depth 8 -Compress
  exit 0
}
# Submission is invoked only after the user explicitly chooses Print / Continue manual duplex.
if($request.tray -ne $null){
  $tray=$settings.PaperSources | Where-Object {$_.RawKind -eq $request.tray} | Select-Object -First 1
  if(-not $tray){throw 'The selected tray is no longer available.'};$page.PaperSource=$tray
}
if($request.dpi){
  $resolution=$settings.PrinterResolutions | Where-Object {$_.X -eq $request.dpi.x -and $_.Y -eq $request.dpi.y} | Select-Object -First 1
  if(-not $resolution){throw 'The requested resolution is not advertised by this driver.'};$page.PrinterResolution=$resolution
}
$page.Color=[bool]$request.colour
if($page.Color -and -not $settings.SupportsColor){throw 'This printer does not support colour.'}
if($request.duplex -ne 'simplex' -and -not $settings.CanDuplex){throw 'Automatic duplex is not supported by this printer.'}
$settings.Duplex=switch($request.duplex){'longEdge'{[System.Drawing.Printing.Duplex]::Vertical};'shortEdge'{[System.Drawing.Printing.Duplex]::Horizontal};default{[System.Drawing.Printing.Duplex]::Simplex}}
$settings.Copies=1
$page.Margins=[System.Drawing.Printing.Margins]::new(0,0,0,0)
$document=[System.Drawing.Printing.PrintDocument]::new()
$document.PrinterSettings=$settings;$document.DefaultPageSettings=$page
$document.PrintController=[System.Drawing.Printing.StandardPrintController]::new()
$document.DocumentName=[string]$request.title
$script:printIndex=0
$script:pages=@($request.pages)
if($script:pages.Count -lt 1){throw 'No prepared pages to submit.'}
$handler=[System.Drawing.Printing.PrintPageEventHandler]{param($sender,$event)
  $bitmap=[System.Drawing.Image]::FromFile([string]$script:pages[$script:printIndex])
  try{
    $event.Graphics.InterpolationMode=[System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $event.Graphics.DrawImage($bitmap,[single](-$event.PageSettings.HardMarginX),[single](-$event.PageSettings.HardMarginY),[single]$event.PageBounds.Width,[single]$event.PageBounds.Height)
  }finally{$bitmap.Dispose()}
  $script:printIndex++;$event.HasMorePages=($script:printIndex -lt $script:pages.Count)
}
$document.add_PrintPage($handler)
try{$document.Print();[pscustomobject]@{submitted=$true;pages=$script:pages.Count} | ConvertTo-Json -Compress}finally{$document.remove_PrintPage($handler);$document.Dispose()}

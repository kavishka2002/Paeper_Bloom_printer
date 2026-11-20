param([Parameter(Mandatory=$true)][string]$InputFile)
$ErrorActionPreference='Stop'
[Console]::OutputEncoding=[System.Text.UTF8Encoding]::new($false)
$request=Get-Content -LiteralPath $InputFile -Raw -Encoding UTF8 | ConvertFrom-Json
$extension=[IO.Path]::GetExtension($request.input).ToLowerInvariant()
$process=switch($extension){
  {$_ -in '.ppt','.pptx'} {'POWERPNT'}
  {$_ -in '.doc','.docx','.txt'} {'WINWORD'}
  {$_ -in '.xls','.xlsx'} {'EXCEL'}
  default {throw 'Unsupported Office document extension.'}
}
if(Get-Process -Name $process -ErrorAction SilentlyContinue){throw "Close $process before conversion, or export the document to PDF from Office."}
if($extension -in '.pptx','.docx','.xlsx'){
  Add-Type -AssemblyName System.IO.Compression.FileSystem
  $package=[IO.Compression.ZipFile]::OpenRead($request.input)
  try{
    $required=@{'.pptx'='ppt/presentation.xml';'.docx'='word/document.xml';'.xlsx'='xl/workbook.xml'}[$extension]
    if(!$package.GetEntry($required) -or ($package.Entries|Where-Object {$_.FullName -match '(?i)(vbaProject|macroSheets|externalLinks|connections\.xml)'})){throw 'The Office package is invalid or contains macros/external data. Export a trusted PDF manually.'}
    if(($package.Entries|Measure-Object Length -Sum).Sum -gt 268435456){throw 'The expanded Office document exceeds the conversion limit.'}
    foreach($entry in $package.Entries|Where-Object {$_.FullName.EndsWith('.rels')}){
      if($entry.Length -gt 1048576){throw 'An Office relationship part exceeds the conversion limit.'}
      $reader=[IO.StreamReader]::new($entry.Open())
      try{if($reader.ReadToEnd() -match '(?i)TargetMode\s*=\s*["'']External["'']'){throw 'The document contains external relationships. Export a trusted PDF manually.'}}
      finally{$reader.Dispose()}
    }
  }finally{$package.Dispose()}
}
$progId=@{POWERPNT='PowerPoint.Application';WINWORD='Word.Application';EXCEL='Excel.Application'}[$process]
$app=$null
$document=$null
$range=$null
try{
  try{$app=New-Object -ComObject $progId}catch{throw "Microsoft Office conversion is unavailable for $extension. Install or activate $progId, or import a PDF."}
  $app.AutomationSecurity=3
  if($process -eq 'POWERPNT'){
    $app.DisplayAlerts=1
    $document=$app.Presentations.Open($request.input,-1,0,0)
    $outputType=switch($request.mode){'notes'{5};'outline'{6};default{1}}
    $hidden=if($request.includeHidden){-1}else{0}
    $range=$document.PrintOptions.Ranges.Add(1,$document.Slides.Count)
    $document.ExportAsFixedFormat($request.output,2,2,0,2,$outputType,$hidden,$range,1,'',$false,$true,$true,$true,$false)
  }elseif($process -eq 'WINWORD'){
    $app.DisplayAlerts=0
    $app.Options.UpdateLinksAtOpen=$false
    if($extension -eq '.txt'){
      $document=$app.Documents.Add()
      $document.Content.Text=[IO.File]::ReadAllText($request.input)
    }else{
      $file=[object][string]$request.input
      $confirm=[object]$false
      $readOnly=[object]$true
      $recent=[object]$false
      $document=$app.Documents.Open([ref]$file,[ref]$confirm,[ref]$readOnly,[ref]$recent)
    }
    $document.ExportAsFixedFormat($request.output,17)
  }else{
    $app.DisplayAlerts=$false
    $app.AskToUpdateLinks=$false
    $document=$app.Workbooks.Open($request.input,0,$true)
    $document.ExportAsFixedFormat(0,$request.output)
  }
}finally{
  if($range){[void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($range)}
  if($document){
    try{if($process -eq 'POWERPNT'){$document.Saved=-1;$document.Close()}else{$document.Close($false)}}catch{}
    [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($document)
  }
  if($app){
    try{$app.Quit()}catch{}
    [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($app)
  }
}

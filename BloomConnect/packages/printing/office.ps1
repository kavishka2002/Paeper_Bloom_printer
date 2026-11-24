param([Parameter(Mandatory=$true)][string]$InputFile,[switch]$ValidateOnly)
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
if($extension -in '.pptx','.docx','.xlsx'){
  Add-Type -AssemblyName System.IO.Compression.FileSystem
  $package=[IO.Compression.ZipFile]::OpenRead($request.input)
  try{
    $required=@{'.pptx'='ppt/presentation.xml';'.docx'='word/document.xml';'.xlsx'='xl/workbook.xml'}[$extension]
    if(!$package.GetEntry($required) -or ($package.Entries|Where-Object {$_.FullName -match '(?i)(vbaProject|macroSheets|externalLinks|connections\.xml)'})){throw 'The Office package is invalid or contains macros/external data. Export a trusted PDF manually.'}
    if(($package.Entries|Measure-Object Length -Sum).Sum -gt 268435456){throw 'The expanded Office document exceeds the conversion limit.'}
    foreach($entry in $package.Entries|Where-Object {$_.FullName.EndsWith('.rels')}){
      if($entry.Length -gt 1048576){throw 'An Office relationship part exceeds the conversion limit.'}
      $stream=$entry.Open()
      try{
        $settings=[Xml.XmlReaderSettings]::new()
        $settings.DtdProcessing=[Xml.DtdProcessing]::Prohibit
        $settings.XmlResolver=$null
        $reader=[Xml.XmlReader]::Create($stream,$settings)
        try{
          while($reader.Read()){
            if($reader.NodeType -ne [Xml.XmlNodeType]::Element -or $reader.LocalName -ne 'Relationship' -or $reader.GetAttribute('TargetMode') -ne 'External'){continue}
            $type=$reader.GetAttribute('Type')
            $target=$null
            $isLink=$type -cin @('http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink','http://purl.oclc.org/ooxml/officeDocument/relationships/hyperlink')
            $isPublicLink=[Uri]::TryCreate($reader.GetAttribute('Target'),[UriKind]::Absolute,[ref]$target) -and $target.Scheme -in @('http','https','mailto')
            if(!$isLink -or !$isPublicLink){throw 'The document references linked files or data. Remove those links in Office or save the document as a trusted PDF.'}
          }
        }finally{$reader.Dispose()}
      }finally{$stream.Dispose()}
    }
  }finally{$package.Dispose()}
}
if($ValidateOnly){return}
if($extension -in '.docx','.pptx' -and $request.mode -eq 'pages' -and !$request.includeHidden){
  $soffice=@($env:ProgramFiles,${env:ProgramFiles(x86)}) | Where-Object {$_} | ForEach-Object {Join-Path $_ 'LibreOffice\program\soffice.com'} | Where-Object {Test-Path -LiteralPath $_ -PathType Leaf} | Select-Object -First 1
  if($soffice){
    $folder=Split-Path -LiteralPath $request.output
    $source=Join-Path $folder ('source'+$extension)
    $officeOutput=Join-Path $folder 'source.pdf'
    Copy-Item -LiteralPath $request.input -Destination $source
    $profile=([Uri](Join-Path $folder 'libreoffice-profile')).AbsoluteUri
    $filter=if($extension -eq '.pptx'){'pdf:impress_pdf_Export'}else{'pdf:writer_pdf_Export'}
    & $soffice ('-env:UserInstallation='+$profile) '--headless' '--convert-to' $filter '--outdir' $folder $source | Out-Null
    if($LASTEXITCODE -eq 0 -and (Test-Path -LiteralPath $officeOutput -PathType Leaf)){
      Move-Item -LiteralPath $officeOutput -Destination $request.output
      return
    }
  }
}
if(Get-Process -Name $process -ErrorAction SilentlyContinue){throw "Close $process before conversion, or export the document to PDF from Office."}
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

Add-Type -AssemblyName System.IO.Compression.FileSystem
$dist = (Resolve-Path 'dist').Path
$zipPath = Join-Path (Get-Location) 'gates-of-asgard.zip'
if (Test-Path $zipPath) { Remove-Item $zipPath }
$zip = [System.IO.Compression.ZipFile]::Open($zipPath, 'Create')
try {
  Get-ChildItem -Path $dist -Recurse -File | ForEach-Object {
    $rel = $_.FullName.Substring($dist.Length + 1).Replace('\', '/')
    [System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile($zip, $_.FullName, $rel) | Out-Null
  }
} finally {
  $zip.Dispose()
}
Write-Output 'done'

$path = "C:\Users\ph201\Documents\Deliria\Papers\SharpEdges\LineswayVoxels\Transvoxel\Tables\TransvoxelTables.h"
$lines = Get-Content $path
$inTable = $false
$out = @()
foreach ($line in $lines) {
  if ($line -match "regularVertexDataTable") { $inTable = $true; continue }
  if ($inTable -and $line -match "^\s*\{") {
    $hex = [regex]::Matches($line, "0x[0-9A-Fa-f]+") | ForEach-Object { $_.Value }
    while ($hex.Count -lt 12) { $hex += "0x0000" }
    $out += "  [" + ($hex -join ", ") + "]"
  }
  if ($inTable -and $line -match "^\s*\};") { break }
}
$js = "export const regularVertexDataTable = [`n" + ($out -join ",`n") + "`n];"
$outPath = "C:\Users\ph201\Documents\Deliria\Papers\SharpEdges\LineswayVoxels\TransvoxelSharpEdges\src\tables\transvoxel-vertex-data.js"
$js | Set-Content $outPath -Encoding UTF8
Write-Host "Rows:" $out.Count

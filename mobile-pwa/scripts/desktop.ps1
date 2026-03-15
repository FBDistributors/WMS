# Ensure Cargo is on PATH (for terminals where Rust wasn't loaded)
$cargoBin = Join-Path $env:USERPROFILE ".cargo\bin"
if (Test-Path $cargoBin) {
  $env:Path = "$cargoBin;$env:Path"
}
Set-Location $PSScriptRoot\..
npm run tauri dev

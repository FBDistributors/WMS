# Release APK -> android\app\build\outputs\apk\release\app-release.apk
# Talab: Android SDK (local.properties da sdk.dir), JDK 17+ (JAVA_HOME yoki quyidagi yo'llar).

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$androidDir = Join-Path $root "android"

function Test-JavaHome([string] $dir) {
    if (-not $dir) { return $false }
    return (Test-Path (Join-Path $dir "bin\java.exe"))
}

function Find-JavaHome {
    if (Test-JavaHome $env:JAVA_HOME) { return $env:JAVA_HOME }

    $extra = @(
        "C:\Program Files\Android\Android Studio\jbr",
        "${env:ProgramFiles}\Android\Android Studio\jbr"
    )
    foreach ($p in $extra) {
        if (Test-JavaHome $p) { return $p }
    }

    $ms = Get-ChildItem "${env:ProgramFiles}\Microsoft\jdk-*" -Directory -ErrorAction SilentlyContinue |
        Sort-Object Name -Descending |
        Select-Object -First 1
    if ($ms -and (Test-JavaHome $ms.FullName)) { return $ms.FullName }

    $adopt = Get-ChildItem "${env:ProgramFiles}\Eclipse Adoptium\jdk-*" -Directory -ErrorAction SilentlyContinue |
        Sort-Object Name -Descending |
        Select-Object -First 1
    if ($adopt -and (Test-JavaHome $adopt.FullName)) { return $adopt.FullName }

    return $null
}

$jh = Find-JavaHome
if (-not $jh) {
    Write-Error @"
JDK 17 topilmadi. Variantlar:
  1) winget install Microsoft.OpenJDK.17  (admin tasdig'i kerak bo'lishi mumkin)
  2) JAVA_HOME ni JDK papkasiga qo'ying (masalan ...\jdk-17.x.x-hotspot yoki Android Studio\jbr)
"@
    exit 1
}

$env:JAVA_HOME = $jh
Write-Host "Using JAVA_HOME=$jh"

Push-Location $androidDir
try {
    & .\gradlew.bat assembleRelease
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
} finally {
    Pop-Location
}

$apk = Join-Path $root "android\app\build\outputs\apk\release\app-release.apk"
if (Test-Path $apk) {
    Write-Host "OK: $apk"
    Get-Item $apk | Format-List FullName, Length, LastWriteTime
} else {
    Write-Warning "Gradle tugadi, lekin app-release.apk topilmadi (boshqa flavor/shartnomalar?)."
}

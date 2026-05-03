# WMS — Locust yuk sinovi (prod API; default VPS).
# Parol chat/repoga yozilmaydi: env orqali yoki quyidagi so'rovda kiritiladi.
#
# Ishlatish:
#   .\run_locust_render.ps1
#   .\run_locust_render.ps1 -Users 50 -SpawnRate 5
#
# Yoki parolni oldindan (bir sessiya), so'roqsiz:
#   $env:WMS_LOCUST_USERNAME = "test"
#   $env:WMS_LOCUST_PASSWORD = "..."
#   .\run_locust_render.ps1 -EnvOnly

param(
    [string]$HostUrl = "https://api.fbwarehouse.uz",
    [string]$Username = "",
    [string]$TestBarcode = "",
    [int]$WebPort = 8089,
    [int]$Users = 0,
    [int]$SpawnRate = 0,
    [int]$RunSeconds = 0,
    # Faqat env: WMS_LOCUST_USERNAME va WMS_LOCUST_PASSWORD (so'roqsiz)
    [switch]$EnvOnly
)

$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot

function Get-FreeLocalPort {
    param(
        [int]$StartPort = 8089,
        [int]$MaxAttempts = 35
    )
    for ($i = 0; $i -lt $MaxAttempts; $i++) {
        $port = $StartPort + $i
        $busy = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue
        if (-not $busy) { return $port }
    }
    throw "Bo'sh port topilmadi ($StartPort - $($StartPort + $MaxAttempts - 1)). Eski Locustni yoping yoki -WebPort belgilang."
}

if (-not $Username) {
    $Username = $env:WMS_LOCUST_USERNAME
}
if ($EnvOnly) {
    if (-not $Username -or -not $env:WMS_LOCUST_PASSWORD) {
        Write-Error "EnvOnly: avval `$env:WMS_LOCUST_USERNAME va `$env:WMS_LOCUST_PASSWORD o'rnating."
        exit 1
    }
    $env:WMS_LOCUST_USERNAME = $Username
} else {
    if (-not $Username) {
        $Username = Read-Host "Username (masalan test)"
    }
    $env:WMS_LOCUST_USERNAME = $Username

    if (-not $env:WMS_LOCUST_PASSWORD) {
        $secure = Read-Host "Password" -AsSecureString
        $bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
        try {
            $env:WMS_LOCUST_PASSWORD = [Runtime.InteropServices.Marshal]::PtrToStringAuto($bstr)
        } finally {
            [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr)
        }
    }
}

if ($TestBarcode) {
    $env:WMS_LOCUST_TEST_BARCODE = $TestBarcode
}

$resolvedPort = Get-FreeLocalPort -StartPort $WebPort
if ($resolvedPort -ne $WebPort) {
    Write-Host "Eslatma: port $WebPort band — Locust UI: http://localhost:$resolvedPort" -ForegroundColor Yellow
}

$locustArgs = @(
    "-f", "locustfile.py",
    "--host=$HostUrl",
    "--web-port=$resolvedPort"
)

if ($Users -gt 0) {
    if ($SpawnRate -le 0) { $SpawnRate = [math]::Max(1, [int]($Users / 10)) }
    $locustArgs += "--headless", "-u", "$Users", "-r", "$SpawnRate"
    if ($RunSeconds -gt 0) {
        $locustArgs += "-t", "${RunSeconds}s"
    }
}

Write-Host "Target: $HostUrl"
Write-Host "Locust UI: http://localhost:$resolvedPort  (agar headless bo'lmasa)"
& python -m locust @locustArgs

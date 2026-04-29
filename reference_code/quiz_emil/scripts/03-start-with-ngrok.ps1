# =====================================================================
#  Alle mod Emil — start server + ngrok i ét hug
#
#  Hvad det gør:
#    1. Læser .env (hvis den findes) og setter NGROK_AUTHTOKEN, PORT, osv.
#    2. Tjekker at ngrok er installeret + auto-konfigurerer authtoken
#    3. Starter ngrok i baggrunden (HTTPS-tunnel til serverens port)
#    4. Henter den offentlige URL fra ngroks lokale API
#    5. Sætter PUBLIC_BASE_URL så QR-koden peger på den rigtige URL
#    6. Starter Node-serveren
#
#  Engangs-opsætning:
#    - Hent ngrok:    winget install ngrok    (eller https://ngrok.com/download)
#    - Lav .env-fil ved at kopiere .env.example og udfyld NGROK_AUTHTOKEN
# =====================================================================

$ErrorActionPreference = 'Stop'
Set-Location -Path $PSScriptRoot\..

# --- 0. Indlæs .env hvis den findes ---
if (Test-Path .env) {
    Get-Content .env | ForEach-Object {
        $line = $_.Trim()
        if ($line -and -not $line.StartsWith('#') -and $line.Contains('=')) {
            $key, $val = $line -split '=', 2
            $key = $key.Trim()
            $val = $val.Trim().Trim('"').Trim("'")
            if ($key -and $val) {
                [Environment]::SetEnvironmentVariable($key, $val, 'Process')
            }
        }
    }
    Write-Host ".env indlæst" -ForegroundColor DarkGray
} else {
    Write-Host "Ingen .env fundet — bruger defaults" -ForegroundColor DarkGray
}

$Port = if ($env:PORT) { $env:PORT } else { '3333' }

Write-Host ""
Write-Host "===========================================" -ForegroundColor Cyan
Write-Host "  Alle mod Emil — Server + ngrok" -ForegroundColor Cyan
Write-Host "===========================================" -ForegroundColor Cyan
Write-Host ""

# --- 1. Tjek ngrok ---
try {
    $ngrokVer = ngrok --version 2>&1
    Write-Host "ngrok: $ngrokVer" -ForegroundColor Green
} catch {
    Write-Host "FEJL: ngrok er ikke installeret eller ikke i PATH." -ForegroundColor Red
    Write-Host ""
    Write-Host "Installer ngrok:" -ForegroundColor Yellow
    Write-Host "  winget install ngrok" -ForegroundColor White
    Write-Host "  (eller download fra https://ngrok.com/download)" -ForegroundColor White
    Read-Host "Tryk Enter for at lukke"
    exit 1
}

# --- 2. Auto-konfigurér ngrok hvis NGROK_AUTHTOKEN er sat i .env ---
if ($env:NGROK_AUTHTOKEN -and $env:NGROK_AUTHTOKEN -ne 'din_ngrok_token_her') {
    Write-Host ">>> Konfigurerer ngrok med token fra .env..." -ForegroundColor Cyan
    & ngrok config add-authtoken $env:NGROK_AUTHTOKEN 2>&1 | Out-Null
    Write-Host "    OK" -ForegroundColor Green
} else {
    Write-Host "(NGROK_AUTHTOKEN ikke sat i .env — bruger eksisterende ngrok-konfig)" -ForegroundColor DarkGray
}

# --- 3. Tjek Node ---
try {
    $nodeVer = node --version
    Write-Host "Node.js: $nodeVer" -ForegroundColor Green
} catch {
    Write-Host "FEJL: Node.js er ikke installeret. Hent fra https://nodejs.org/" -ForegroundColor Red
    Read-Host "Tryk Enter for at lukke"
    exit 1
}

# --- 4. Installer pakker (kun hvis nødvendigt) ---
if (-not (Test-Path node_modules)) {
    Write-Host ""
    Write-Host ">>> Installer pakker..." -ForegroundColor Cyan
    npm install
    if ($LASTEXITCODE -ne 0) { Read-Host "npm install fejlede. Tryk Enter"; exit 1 }
}

# --- 5. Dræb evt. eksisterende ngrok / server på samme port ---
Write-Host ""
Write-Host ">>> Rydder gamle processer..." -ForegroundColor DarkGray
Get-Process -Name "ngrok" -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
Get-NetTCPConnection -LocalPort $Port -ErrorAction SilentlyContinue | ForEach-Object {
    Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue
}
Start-Sleep -Seconds 1

# --- 6. Start ngrok i et separat vindue ---
Write-Host ">>> Starter ngrok-tunnel mod port $Port..." -ForegroundColor Cyan
Start-Process -FilePath "ngrok" -ArgumentList "http $Port --log=stdout" -WindowStyle Minimized

# --- 7. Vent på at ngrok's API er klar, og hent den offentlige URL ---
$publicUrl = $null
$attempts = 0
while (-not $publicUrl -and $attempts -lt 20) {
    Start-Sleep -Milliseconds 500
    $attempts++
    try {
        $tunnels = Invoke-RestMethod -Uri "http://localhost:4040/api/tunnels" -TimeoutSec 2
        $httpsTunnel = $tunnels.tunnels | Where-Object { $_.public_url -like "https://*" } | Select-Object -First 1
        if ($httpsTunnel) { $publicUrl = $httpsTunnel.public_url }
    } catch { }
}

if (-not $publicUrl) {
    Write-Host ""
    Write-Host "FEJL: Kunne ikke hente ngrok URL." -ForegroundColor Red
    Write-Host "Tjek at NGROK_AUTHTOKEN i .env er korrekt." -ForegroundColor Yellow
    Read-Host "Tryk Enter for at lukke"
    exit 1
}

# --- 8. Start serveren med PUBLIC_BASE_URL = ngrok URL ---
$env:PUBLIC_BASE_URL = $publicUrl

Write-Host ""
Write-Host "===========================================" -ForegroundColor Green
Write-Host "  ALT KOERER — del disse links:" -ForegroundColor Green
Write-Host "===========================================" -ForegroundColor Green
Write-Host ""
Write-Host "  Storskaerm (TV - lokalt):" -ForegroundColor Yellow
Write-Host "  http://localhost:$Port/screen" -ForegroundColor White
Write-Host ""
Write-Host "  Vert-panel:" -ForegroundColor Yellow
Write-Host "  http://localhost:$Port/host    (PIN: $($env:HOST_PIN ?? '1234'))" -ForegroundColor White
Write-Host ""
Write-Host "  Emils telefon (PIN: $($env:EMIL_PIN ?? '0000')):" -ForegroundColor Yellow
Write-Host "  $publicUrl/emil" -ForegroundColor White
Write-Host ""
Write-Host "  Gaeste-URL (deles via QR-koden automatisk):" -ForegroundColor Cyan
Write-Host "  $publicUrl/play" -ForegroundColor White
Write-Host ""
Write-Host "  ngrok dashboard: http://localhost:4040" -ForegroundColor DarkGray
Write-Host "  (Tryk Ctrl+C for at stoppe serveren — ngrok stoppes manuelt)" -ForegroundColor DarkGray
Write-Host ""

npm start

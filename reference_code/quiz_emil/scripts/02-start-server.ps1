# =====================================================================
#  Alle mod Emil — start server lokalt
#  Brug: kør dette på din LOKALE PC fra C:\naac\quiz_emil\scripts\
#  Det installerer pakker (kun første gang) og starter serveren.
# =====================================================================

$ErrorActionPreference = 'Stop'
Set-Location -Path $PSScriptRoot\..

Write-Host ""
Write-Host "===========================================" -ForegroundColor Cyan
Write-Host "  Alle mod Emil — start server" -ForegroundColor Cyan
Write-Host "===========================================" -ForegroundColor Cyan
Write-Host ""

# Tjek Node er installeret
try {
    $nodeVer = node --version
    Write-Host "Node.js: $nodeVer" -ForegroundColor Green
} catch {
    Write-Host "FEJL: Node.js er ikke installeret." -ForegroundColor Red
    Write-Host "Hent og installer fra https://nodejs.org/ (LTS)," -ForegroundColor Red
    Write-Host "luk så denne PowerShell og åbn en ny." -ForegroundColor Red
    Read-Host "Tryk Enter for at lukke"
    exit 1
}

# Installer pakker hvis node_modules ikke findes
if (-not (Test-Path node_modules)) {
    Write-Host ""
    Write-Host ">>> Installer pakker (npm install)..." -ForegroundColor Cyan
    Write-Host "    (Tager 30 sek - 2 min første gang)" -ForegroundColor DarkGray
    npm install
    if ($LASTEXITCODE -ne 0) {
        Write-Host "FEJL: npm install fejlede." -ForegroundColor Red
        Read-Host "Tryk Enter for at lukke"
        exit 1
    }
} else {
    Write-Host "node_modules findes allerede - springer install over." -ForegroundColor DarkGray
}

# Find lokal IP til guest URL
$ip = (Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue |
       Where-Object { $_.PrefixOrigin -eq 'Dhcp' -or $_.SuffixOrigin -eq 'Manual' } |
       Where-Object { $_.IPAddress -notmatch '^(127\.|169\.254\.)' } |
       Select-Object -First 1).IPAddress

Write-Host ""
Write-Host "===========================================" -ForegroundColor Green
Write-Host "  Starter server..." -ForegroundColor Green
Write-Host "===========================================" -ForegroundColor Green
if ($ip) {
    Write-Host "  Storskaerm:  http://localhost:3333/screen" -ForegroundColor Yellow
    Write-Host "  Vert-panel:  http://localhost:3333/host" -ForegroundColor Yellow
    Write-Host "  Emil:        http://localhost:3333/emil" -ForegroundColor Yellow
    Write-Host ""
    Write-Host "  For gaester paa samme Wi-Fi (QR-koden peger her):" -ForegroundColor Cyan
    Write-Host "  http://$ip`:3333/play" -ForegroundColor Cyan
    Write-Host ""
    $env:PUBLIC_BASE_URL = "http://$($ip):3333"
}
Write-Host "  (Tryk Ctrl+C for at stoppe)" -ForegroundColor DarkGray
Write-Host ""

npm start

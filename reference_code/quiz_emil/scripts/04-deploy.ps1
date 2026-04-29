# =====================================================================
#  Alle mod Emil — DEPLOY (push til GitHub -> Render auto-deployer)
#
#  Hvad det gør:
#    1. Viser hvad der er ændret
#    2. Spørger om commit-besked (eller auto-genererer)
#    3. git add + commit + push origin main
#    4. GitHub trigger Render der auto-deployer på ~2 min
#    5. Åbner Render dashboard så du kan se progress
#
#  Auto Sync er allerede tændt i din Render Blueprint, så push = deploy.
# =====================================================================

$ErrorActionPreference = 'Stop'
Set-Location -Path $PSScriptRoot\..

$RENDER_DASH = 'https://dashboard.render.com'
$LIVE_URL    = 'https://alle-mod-emil.onrender.com'

Write-Host ""
Write-Host "===========================================" -ForegroundColor Cyan
Write-Host "  Alle mod Emil — Deploy til Render" -ForegroundColor Cyan
Write-Host "===========================================" -ForegroundColor Cyan
Write-Host ""

if (-not (Test-Path .git)) {
    Write-Host "FEJL: Ikke et git repo. Koer fra C:\naac\quiz_emil" -ForegroundColor Red
    Read-Host "Tryk Enter for at lukke"
    exit 1
}

# --- 1. Tjek om der er ændringer at committe ---
$status = git status --porcelain
if (-not $status) {
    Write-Host "Ingen aendringer at committe — push'er bare for at trigge en deploy..." -ForegroundColor Yellow
    Write-Host ""
} else {
    Write-Host "Aendringer der bliver committet:" -ForegroundColor Yellow
    git status --short
    Write-Host ""
}

# --- 2. Commit-besked ---
$defaultMsg = "Update " + (Get-Date -Format "yyyy-MM-dd HH:mm")
$msg = Read-Host "Commit-besked (tryk Enter for: '$defaultMsg')"
if (-not $msg) { $msg = $defaultMsg }

# --- 3. Add + commit (kun hvis der er aendringer) ---
if ($status) {
    Write-Host ""
    Write-Host ">>> git add ." -ForegroundColor Cyan
    git add .

    Write-Host ">>> git commit" -ForegroundColor Cyan
    git commit -m "$msg"
    if ($LASTEXITCODE -ne 0) {
        Write-Host "Commit fejlede." -ForegroundColor Red
        Read-Host "Tryk Enter for at lukke"
        exit 1
    }
}

# --- 4. Push (trigger Render deploy) ---
Write-Host ""
Write-Host ">>> git push origin main  (dette trigger Render-deploy)" -ForegroundColor Cyan
git push origin main 2>&1 | Out-Host
if ($LASTEXITCODE -ne 0) {
    Write-Host ""
    Write-Host "Push fejlede. Check at du er logget ind i git." -ForegroundColor Red
    Write-Host "Proev: gh auth login   eller bug PAT som password" -ForegroundColor Yellow
    Read-Host "Tryk Enter for at lukke"
    exit 1
}

# --- 5. Vis status + aabn dashboard ---
$shortSha = (git rev-parse --short HEAD).Trim()
Write-Host ""
Write-Host "===========================================" -ForegroundColor Green
Write-Host "  PUSHET TIL GITHUB ($shortSha)" -ForegroundColor Green
Write-Host "  Render begynder deploy nu..." -ForegroundColor Green
Write-Host "===========================================" -ForegroundColor Green
Write-Host ""
Write-Host "  Live URL:        $LIVE_URL" -ForegroundColor White
Write-Host "  Storskaerm:      $LIVE_URL/screen" -ForegroundColor Yellow
Write-Host "  Vert-panel:      $LIVE_URL/host" -ForegroundColor Yellow
Write-Host "  Render dashboard:$RENDER_DASH" -ForegroundColor DarkGray
Write-Host ""
Write-Host "  Deploy tager ca. 2 min. Aabner Render dashboard..." -ForegroundColor DarkGray
Start-Process $RENDER_DASH

# --- 6. Smart wait: ping live URL hvert 10. sekund og se om koden er opdateret ---
Write-Host ""
$ans = Read-Host "Vil du vente og verificere at deploy er live? (j/N)"
if ($ans -eq 'j' -or $ans -eq 'J' -or $ans -eq 'y' -or $ans -eq 'Y') {
    Write-Host ""
    Write-Host "  Venter paa at deploy er live..." -ForegroundColor Cyan
    Write-Host "  (Cold start kan tage op til 60 sek hvis Render lige er vaagnet)" -ForegroundColor DarkGray

    $maxAttempts = 24   # = 4 minutter
    $attempt = 0
    $deployed = $false
    while (-not $deployed -and $attempt -lt $maxAttempts) {
        $attempt++
        Start-Sleep -Seconds 10
        try {
            $response = Invoke-WebRequest -Uri "$LIVE_URL/api/state" -TimeoutSec 8 -UseBasicParsing
            if ($response.StatusCode -eq 200) {
                $deployed = $true
                Write-Host "  [OK] Live efter $($attempt * 10) sek" -ForegroundColor Green
            }
        } catch {
            Write-Host "  ... vaeker server (forsoeg $attempt/$maxAttempts)" -ForegroundColor DarkGray
        }
    }

    if ($deployed) {
        Write-Host ""
        Write-Host "===========================================" -ForegroundColor Green
        Write-Host "  DEPLOY LIVE — klar til at teste!" -ForegroundColor Green
        Write-Host "===========================================" -ForegroundColor Green
        Write-Host ""
        $openBrowser = Read-Host "Aabn storskaerm i browser? (j/N)"
        if ($openBrowser -eq 'j' -or $openBrowser -eq 'J' -or $openBrowser -eq 'y' -or $openBrowser -eq 'Y') {
            Start-Process "$LIVE_URL/screen"
        }
    } else {
        Write-Host ""
        Write-Host "  Render svarer ikke endnu efter 4 min — tjek dashboardet manuelt." -ForegroundColor Yellow
    }
}

Write-Host ""
Read-Host "Tryk Enter for at lukke"

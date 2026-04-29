# =====================================================================
#  Alle mod Emil — commit + push til GitHub
#  Brug: kør dette på din LOKALE PC fra C:\naac\quiz_emil
#  Den committer alle ændringer (node_modules ignoreres af .gitignore)
#  og pusher til origin/main.
# =====================================================================

$ErrorActionPreference = 'Stop'
Set-Location -Path $PSScriptRoot\..

Write-Host ""
Write-Host "===========================================" -ForegroundColor Cyan
Write-Host "  Alle mod Emil — Git commit + push" -ForegroundColor Cyan
Write-Host "===========================================" -ForegroundColor Cyan
Write-Host ""

# Tjek vi er i et git repo
if (-not (Test-Path .git)) {
    Write-Host "FEJL: Denne mappe er ikke et git repo." -ForegroundColor Red
    Write-Host "Sørg for at du kører scriptet fra: C:\naac\quiz_emil\scripts\" -ForegroundColor Red
    Read-Host "Tryk Enter for at lukke"
    exit 1
}

Write-Host "Git status (det der bliver committet):" -ForegroundColor Yellow
git status --short
Write-Host ""

$ans = Read-Host "Vil du committe og pushe alt dette? (j/N)"
if ($ans -ne 'j' -and $ans -ne 'J' -and $ans -ne 'y' -and $ans -ne 'Y') {
    Write-Host "Afbrudt." -ForegroundColor Yellow
    Read-Host "Tryk Enter for at lukke"
    exit 0
}

Write-Host ""
Write-Host ">>> git add ." -ForegroundColor Cyan
git add .

Write-Host ""
Write-Host ">>> git commit" -ForegroundColor Cyan
$msg = "Add Alle mod Emil quiz system: server, screen, ladder, host/emil/guest pages"
git commit -m $msg
if ($LASTEXITCODE -ne 0) {
    Write-Host "(intet at committe — eller pre-commit hook fejlede)" -ForegroundColor Yellow
}

Write-Host ""
Write-Host ">>> git push origin main" -ForegroundColor Cyan
git push origin main
if ($LASTEXITCODE -ne 0) {
    Write-Host ""
    Write-Host "Push fejlede. Prøv en af disse:" -ForegroundColor Red
    Write-Host "  - Login med GitHub CLI:    gh auth login" -ForegroundColor Red
    Write-Host "  - Eller brug et Personal Access Token som password" -ForegroundColor Red
    Write-Host "    (lav en på github.com -> Settings -> Developer settings -> Tokens)" -ForegroundColor Red
}

Write-Host ""
Write-Host "===========================================" -ForegroundColor Green
Write-Host "  Færdig!" -ForegroundColor Green
Write-Host "===========================================" -ForegroundColor Green
Read-Host "Tryk Enter for at lukke"

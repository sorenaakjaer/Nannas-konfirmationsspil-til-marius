# Nanna STORE Quiz til Marius

Kahoot-inspireret konfirmationsquiz med fire views:

- `/screen` - storskærm
- `/host` - host-kontrolpanel
- `/play` - gæster på mobil
- `/konfirmant` - konfirmandens parallelle svarskærm

## Start

```bash
npm install
npm start
```

Serveren starter som standard på `http://localhost:3340` via `.env`.

I roden af projektet kan du starte direkte med:

`START-NANNA-QUIZ-3340.cmd`

## PIN-koder

- Host PIN: `1234` (kan ændres med `HOST_PIN`)
- Marius PIN: `2012` (kan ændres med `MARIUS_PIN`)

## Dynamiske spørgsmål

- Spørgsmål ligger i `data/questions.json`
- Host kan oprette/redigere/slette spørgsmål direkte i `/host`
- Host kan importere fra `Questions.md` via knappen `Importer Questions.md`
- Billeder kan uploades i hostpanelet eller indsættes via clipboard (paste), og gemmes i `public/uploads`

## Deploy til Render.com (auto-deploy ved commit)

Projektet har en `render.yaml` blueprint som automatisk opsætter en web service der genimplementerer hver gang du pusher til `main`-branchen.

### Førstegangs-opsætning

1. **Push koden til GitHub** (allerede gjort - repoet ligger på `sorenaakjaer/Nannas-konfirmationsspil-til-marius`)
2. Gå til [dashboard.render.com](https://dashboard.render.com/) og log ind / opret konto
3. Klik **"New +" → "Blueprint"**
4. Vælg dit GitHub-repo (forbind GitHub-konto hvis det er første gang)
5. Render læser `render.yaml` automatisk og foreslår en service `nanna-store-quiz`
6. Klik **"Apply"** for at oprette servicen
7. Sæt environment-variablerne i Render-dashboardet:
   - `HOST_PIN` (fx `1234`)
   - `MARIUS_PIN` (fx `2012`)
   - `PUBLIC_BASE_URL` (fx `https://nanna-store-quiz.onrender.com` - bruges til QR-koden)
8. Render bygger og deployer automatisk - du får en URL som `https://nanna-store-quiz.onrender.com`

### Auto-deploy på commit

`render.yaml` har `autoDeploy: true` på `main`-branchen, så hver gang du laver et commit + push til `main`, deployer Render automatisk den nye version inden for 1-3 minutter.

```bash
git add .
git commit -m "Min ændring"
git push
# → Render bygger og deployer automatisk
```

### Vigtige overvejelser

**Free-tier (gratis)** — perfekt til en enkelt event:
- Serveren går i dvale efter 15 min uden trafik. Første request efter dvale tager ~30 sek at vågne op
- Filsystemet er **ephemeralt** — uploads og `state.json` nulstilles ved hvert deploy/restart
- Spørgsmål (`data/questions.json`) og branding (`data/config.json`) overlever fordi de er commitet i git
- **Tip**: Upload alle billeder via `/host` og commit dem til git INDEN selve eventet, så de overlever et evt. restart midt i festen

**Starter-tier ($7/måned)** — anbefalet til vigtige events:
- Ingen dvale, hurtig respons hver gang
- Du kan tilføje en **Persistent Disk** mounted på `/opt/render/project/src/data` så uploads og spillets state overlever deploys
- Tilføj følgende til `render.yaml` under servicen:

```yaml
    plan: starter
    disk:
      name: quiz-data
      mountPath: /opt/render/project/src/data
      sizeGB: 1
```

### Health-check

`/health`-endpointet returnerer JSON med status — Render bruger det til at tjekke at appen er kørende efter deploy.

### Ændre PORT

Render injicerer automatisk `process.env.PORT` — appen bruger den allerede. Lokalt bruger den værdien fra `.env` (3340).

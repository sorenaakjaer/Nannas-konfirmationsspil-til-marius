# Nanna STORE Quiz til Marius

Kahoot-inspireret konfirmationsquiz med fire views:

- `/screen` - storskærm
- `/host` - host-kontrolpanel
- `/play` - gæster på mobil
- `/marius` - Marius' parallelle svarskærm

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
- Host kan importere fra `../Questions.md` via knappen `Importer Questions.md`
- Billeder kan uploades i hostpanelet eller indsættes via clipboard (paste), og gemmes i `public/uploads`

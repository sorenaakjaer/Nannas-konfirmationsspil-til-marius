# Alle mod Emil 🍫

A live, web-based estimation quiz for **Emil's confirmation on 25. april** —
inspired by DR's *"Alle mod 1"*. One screen, one Emil, many guests with phones.
Total prize pool: **100 Kinder Maxi**.

The big screen shows a vertical reward ladder à la *Alle mod 1* — FINALE at the top,
the active round highlighted in white, and finished rounds marked with the winner
(pink **E** = Emil, cyan **G** = Guests).

---

## 1. Architecture overview

A single Node.js process serves four roles:

```
                     ┌─────────────────────┐
                     │   Node.js server    │
                     │  Express + Socket.IO│
                     │  (in-memory state,  │
                     │   persisted to disk)│
                     └──────────┬──────────┘
                                │ websockets
        ┌───────────────┬───────┼─────────────┬──────────────┐
        ▼               ▼       ▼             ▼              ▼
   /screen          /host     /emil         /play         /api/qr
   Big TV       Operator's  Emil's       Guest mobile    QR code
   display       laptop      phone         (via QR)      generation
```

* All clients share state via a single Socket.IO room model.
* Every state change is broadcast to all roles. Each role gets a tailored view
  (Emil's answer is hidden from screen/guests until the reveal phase).
* Game state is held in memory and written to `data/state.json` after every
  change — so an accidental restart mid-show doesn't wipe the score.

### Round state machine

```
  idle  ──host: show──▶  question  ──emil: lock──▶  open  ──host: close──▶  closed
                                                     │                        │
                                                     └─────host: reveal──────┐│
                                                                            ▼▼
                                                                          reveal
                                                                            │
                                                                  host: next│
                                                                            ▼
                                                                       (next round
                                                                       or gameover)
```

---

## 2. Folder structure

```
quiz_emil/
├── server.js              # Express + Socket.IO + game state machine
├── package.json
├── README.md
├── data/
│   ├── questions.json     # 6 rounds, reward ladder, total candy
│   └── state.json         # auto-generated runtime state (safe to delete)
└── public/
    ├── screen.html        # 📺 Big TV screen
    ├── host.html          # 🎛 Host control panel (PIN-protected)
    ├── emil.html          # 🤫 Emil's private input (PIN-protected)
    ├── play.html          # 📱 Guest mobile page (no login)
    ├── css/
    │   └── style.css
    └── js/
        ├── screen.js
        ├── host.js
        ├── emil.js
        └── play.js
```

---

## 3. Quick start (local)

You need Node.js 18+ on the laptop running the show.

```bash
npm install
npm start
```

You should see:

```
=== Alle mod Emil ===
Big screen   : http://localhost:3333/screen
Host panel   : http://localhost:3333/host    (PIN: 1234)
Emil's phone : http://localhost:3333/emil    (PIN: 0000)
Guest URL    : http://localhost:3333/play
```

### Change PINs

```bash
HOST_PIN=4711 EMIL_PIN=2024 npm start          # macOS / Linux
$env:HOST_PIN="4711"; $env:EMIL_PIN="2024"; npm start   # Windows PowerShell
```

---

## 4. Live event setup — choose one

Three ways to make the app reachable for guests. Pick the one that fits.

### 🟢 Option A: One‑click double‑click (RECOMMENDED for the party)

You already have helper scripts in the project root. Just **double‑click**:

| File | What it does |
|---|---|
| `START-SERVER.bat` | Local‑Wi‑Fi only — guests must be on the same network |
| `START-WITH-NGROK.bat` | Public HTTPS URL via ngrok — guests can join from anywhere (4G/5G works) |
| `COMMIT-PUSH.bat` | Commit + push code changes to GitHub |

The ngrok script auto‑detects ngrok's URL and feeds it to the server, so the QR
code on the big screen always points to the right place.

> 💡 **Important: ngrok is a tunnel, not a host.** It exposes your *local*
> running server to the internet. Your laptop must stay on, online, and running
> `npm start`. Perfect for the party itself; not for 24/7. For always‑on, see
> Option C.

**One‑time ngrok setup**:

1. Install ngrok: `winget install ngrok` (or download from
   [ngrok.com/download](https://ngrok.com/download))
2. Make a free account on [ngrok.com](https://ngrok.com) → copy your
   authtoken from
   [dashboard.ngrok.com/get-started/your-authtoken](https://dashboard.ngrok.com/get-started/your-authtoken)
3. Copy `.env.example` → `.env`, paste your token after `NGROK_AUTHTOKEN=`.
   The script reads it automatically and configures ngrok for you.
   (`.env` is in `.gitignore` — never gets committed.)

Then `START-WITH-NGROK.bat` works forever.

### 🟡 Option B: Same Wi‑Fi only (no internet needed)

1. Connect the laptop, the TV and Emil's phone to the **same Wi‑Fi**.
2. Find the laptop's local IP (`ipconfig` on Windows, `ifconfig` on macOS/Linux),
   e.g. `192.168.1.42`.
3. Start the server with `PUBLIC_BASE_URL` so the QR code points there:

   ```bash
   PUBLIC_BASE_URL=http://192.168.1.42:3333 npm start
   ```

4. On the laptop: open `http://localhost:3333/screen` on the TV.
5. On Emil's phone (same Wi‑Fi): `http://192.168.1.42:3333/emil`.
6. Guests scan the QR code on screen.

> ⚠️ Make sure Windows Firewall allows inbound port 3333 (it'll prompt the first
> time you start the server).

### 🔵 Option C: Always‑on cloud deploy (Render.com — free, recommended fallback)

Best if you want the app accessible 24/7 without your laptop running. Your repo
includes a `render.yaml` blueprint, so it's a one‑click deploy:

1. Push your repo to GitHub (already done).
2. Go to [dashboard.render.com/blueprints](https://dashboard.render.com/blueprints)
   and sign up with GitHub.
3. **Private repo?** When Render asks for repo access, click "Configure account"
   and grant access to `quiz_emil`. Render handles private repos automatically
   on the free tier.
4. Click **"New Blueprint Instance"**, pick the `quiz_emil` repo.
5. Render reads `render.yaml`, asks you to set `HOST_PIN` and `EMIL_PIN`,
   then deploys.
6. After ~2 minutes you get a public URL like `https://alle-mod-emil.onrender.com`.
   Open `…/screen` on the TV — done.

> ⚠️ Render's free tier sleeps after 15 min of inactivity (cold starts take
> ~30 sec). Just visit the URL ~1 min before the party to wake it. Game state is
> not persisted on free tier (no disk) — but `data/state.json` is auto‑restored
> within a single process lifetime, so it only matters if Render restarts you
> mid‑show. For a 30‑min party that's a non‑issue.

#### Other free hosting alternatives

| Host | Free tier | Notes |
|---|---|---|
| **Render.com** | Free web service | Already configured. Sleeps after 15 min idle. |
| **Railway** | $5/mo credit (no card for trial) | No sleep, very fast. Add a `Procfile` with `web: node server.js`. |
| **Fly.io** | 3 shared VMs free | No sleep. Use `flyctl launch` to set up. |
| **Cyclic** | Generous free tier | Auto-deploys from GitHub. |
| **Glitch** | Free with sleep | Quick to spin up but limited resources. |

> 💡 **ngrok vs hosting — quick rule of thumb**:
> - **ngrok** = your PC runs the show, internet just gets routed in. Free, instant. PC must stay on.
> - **Render/Railway/Fly** = code lives in the cloud, runs without your PC. Free for hobby use. Better for "send the link to grandma a week before".

### 🔐 .env file (secrets — never commit)

The `.env` file holds local secrets like your ngrok token and optional PIN
overrides. It's already in `.gitignore`. Use `.env.example` as the template:

```
NGROK_AUTHTOKEN=your_actual_token_here
HOST_PIN=4711
EMIL_PIN=2604
```

The ngrok start script reads this automatically. The Node server respects
`HOST_PIN`, `EMIL_PIN`, `PORT`, and `PUBLIC_BASE_URL` from the environment.

---

## 5. How to run the show

1. **Open the screen** on the TV (`/screen`) — keep this in fullscreen.
2. **Open the host panel** on your laptop (`/host`) and log in with the host
   PIN. Keep this on a second screen or your phone.
3. **Hand Emil his phone** with `/emil` open and his PIN entered.
4. Tell guests to scan the QR code (only shown during the *open* phase).
5. For each round:
   1. Press **"Vis spørgsmål"** → screen shows the question. Emil sees it on
      his phone.
   2. **Emil locks** his answer in privacy → screen automatically switches to
      the QR + waiting view.
   3. Guests scan + submit. Live counter on screen shows incoming votes.
   4. Execute the physical challenge!
   5. Press **"Luk afstemning"** when done (optional — you can also reveal
      directly from the open phase).
   6. Type the **actual measured result** in the host panel and press
      **"AFSLØR RESULTAT"**.
   7. Screen shows distribution chart, Emil's guess, average, winner banner
      and confetti. Candy is added to the winner's total automatically.
   8. Press **"Næste runde →"** to move on.
6. After 6 rounds the screen shows the final scoreboard.

### Sound effects (optional)

The big screen has a 🔊 button in the top‑right that plays sound effects at
key moments (intro, drum roll on reveal, winner fanfares, etc.). Drop short
clips into `public/audio/` — see `public/audio/README.md` for the file names
the system looks for and tips on how to clip the original "Alle mod 1" theme
or grab royalty‑free SFX. **Click the speaker button before starting the show**
to unlock browser autoplay.

### House rule: tie-breaker

At an exact tie, OR when both distances round to the same whole number,
**Emil wins**. Hjemmebanefordel til konfirmanden. The algorithm in
`server.js → determineWinner()` enforces this automatically.

### Override / oops button

If you misread the facit or there's a tie you want to call a winner anyway,
the host panel has *Overstyr → Emil / Gæster / Uafgjort* buttons available
during the reveal phase. Candy totals are recalculated automatically.

---

## 6. Reward ladder

Total: **100 Kinder Maxi**, distributed over 6 rounds with rising drama
(roughly geometric, just like the show):

| Runde | Belønning | Kumuleret |
|------:|----------:|----------:|
|     1 |         4 |         4 |
|     2 |         6 |        10 |
|     3 |        10 |        20 |
|     4 |        15 |        35 |
|     5 |        25 |        60 |
|  **6 (FINALEN)** | **40** | **100** |

The screen renders this as a vertical ladder on the right side of the screen.
FINALE sits at the top with a golden glow; the active round is highlighted
in white; finished rounds get a pink **E** (Emil won) or a cyan **G** (guests
won). Edit `data/questions.json` to change rewards or questions before the
party — the ladder reads from there automatically.

---

## 7. Question bank (6 rounds)

All numeric, all physically executable in ~1 minute, all funny. Edit freely:

1. Hvor mange leverpostejmadder kan Emil og hans mor smøre på 60 sekunder?
2. Hvor mange armbøjninger kan Emil tage på 30 sekunder?
3. Hvor mange sekunder tager det Emil at drikke et helt glas vand (25 cl)?
4. Hvor mange skumfiduser kan Emil proppe i munden og stadig sige
   "tillykke med konfirmationen"?
5. Hvor mange centimeter kan Emil hoppe i længdespring fra stående?
6. Finalen — Hvor mange navne på gæsterne kan Emil huske på 60 sekunder?

---

## 8. Data model (in `data/questions.json`)

```jsonc
{
  "totalCandy": 200,
  "rewardLadder": [5, 10, 20, 35, 50, 80],
  "rounds": [
    {
      "id": 1,
      "title": "Runde 1",
      "reward": 5,
      "question": "Hvor mange leverpostejmadder kan Emil...",
      "unit": "madder",
      "hint": "Hele tal. Kun færdige, præsentable madder tæller!"
    }
    // ...
  ]
}
```

Runtime state (`data/state.json`, auto-written) looks like:

```jsonc
{
  "currentRoundIndex": 2,
  "emilCandy": 5,
  "guestsCandy": 10,
  "history": [
    { "roundIndex": 0, "winner": "emil",   "reward": 5,  ... },
    { "roundIndex": 1, "winner": "guests", "reward": 10, ... }
  ],
  "round": {
    "phase": "open",
    "emilAnswer": 17,
    "correctAnswer": null,
    "guestAnswers": [
      { "sessionId": "g_abc", "name": "Mormor Hanne", "value": 12, "ts": 1729000000000 }
    ]
  }
}
```

Delete `data/state.json` to start completely fresh.

---

## 9. Realtime API (Socket.IO events)

| Direction | Event | Payload | Notes |
|---|---|---|---|
| C → S | `hello` | `{ as: 'screen'\|'host'\|'emil'\|'play', pin? }` | Joins the right room |
| S → C | `state` | full state object | Sent on connect & after every change |
| S → C | `auth-error` | `{ message }` | Wrong PIN |
| C → S | `emil:lock` | `{ value, pin }` | Locks Emil's answer |
| C → S | `guest:submit` | `{ sessionId, name, value }` | Guest answer (idempotent per session) |
| C → S | `host:show-question` | `{ pin }` | Show the current/next question |
| C → S | `host:close` | `{ pin }` | Close submissions |
| C → S | `host:reveal` | `{ pin, correctAnswer }` | Reveal + compute winner |
| C → S | `host:next` | `{ pin }` | Advance to next round (or gameover) |
| C → S | `host:override-winner` | `{ pin, winner }` | Manual override |
| C → S | `host:reset` | `{ pin }` | Wipe and start over |

REST helpers:

* `GET /api/qr` → `{ url, dataUrl }` (PNG data URL of QR pointing to `/play`)
* `GET /api/state` → public game state (read-only debug)

---

## 10. Styling guide

* Dark game-show palette: deep purple → orange/gold accents.
* Big readable type with `clamp()` so the screen scales to any TV resolution.
* Reveal phase: bar histogram + correct/Emil markers + animated winner banner
  + confetti.
* Score cards use brand colours: 🩷 pink for Emil, 🩵 cyan for the guests.
* Host & Emil pages use the same theme but in a phone-friendly column.

If you want to rebrand, change CSS variables at the top of
`public/css/style.css` (`--accent`, `--emil`, `--guests`, etc.).

---

## 11. Deployment options

* **Local laptop only** (recommended): nothing to install, no cloud cost.
  Start `npm start`, share the QR. See section 4.
* **Tunnel** (ngrok / Cloudflare Tunnel) if guests must join over cellular.
* **Render / Railway / Fly.io**: any Node host works. Set `PORT`,
  `PUBLIC_BASE_URL`, `HOST_PIN`, `EMIL_PIN` env vars. Persistent disk is
  optional (only needed if you want `data/state.json` to survive a restart).

Example `Dockerfile` (if you want one):

```Dockerfile
FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm install --omit=dev
COPY . .
ENV PORT=3333
EXPOSE 3333
CMD ["node", "server.js"]
```

---

## 12. Troubleshooting

* **QR code points to the wrong host.** Set `PUBLIC_BASE_URL` env var when
  starting the server.
* **Guests' submissions don't show up.** Check that they're on the same Wi‑Fi
  (or that the tunnel is running). Open `/play` manually on a guest device to
  verify connectivity.
* **Score got messed up.** Use the *Overstyr* buttons during reveal, or hit
  *Nulstil hele spillet* to start over.
* **Server crashed mid-show.** Just run `npm start` again — the round and
  score are restored from `data/state.json`.
* **Emil forgot his PIN.** Restart the server with a new `EMIL_PIN`. Browser
  sessions remember the PIN, so he won't be re-prompted unless he clears
  storage.

---

Have a great party! 🎉

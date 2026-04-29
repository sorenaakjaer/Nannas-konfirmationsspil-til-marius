# Sound effects

Drop short audio clips into this folder. The system tries `.mp3`, `.m4a`, `.ogg`, `.wav`
in that order, so any of these formats work.

## Files the game looks for

| File name | When it plays | Suggested length | Mood |
|---|---|---|---|
| `intro.mp3` | When the very first question of the game is shown | 3–5 sec | Big show opener — fanfare / theme |
| `question.mp3` | When each new question (round 2, 3, …) is shown | 1–2 sec | Short "ding" / new round |
| `tick.mp3` | When the countdown hits **10 seconds left** | 0.5–2 sec or a 10‑sec ticking loop | Tense ticking |
| `timeup.mp3` | When the timer hits **0** (auto‑close) | 1 sec | Buzzer / "whoosh" |
| `reveal.mp3` | When the host clicks **"Vis svar"** (facit + Emil shown) | 2–4 sec | Drum roll |
| `winnerEmil.mp3` | Round winner = Emil | 2–3 sec | Triumphant |
| `winnerGuests.mp3` | Round winner = Guests | 2–3 sec | Big crowd cheer |
| `gameover.mp3` | Final scoreboard appears | 4–8 sec | Outro / theme |
| `emilLocked.mp3` | When Emil locks his answer | 0.4 sec | Subtle "lock" click |
| `guestJoined.mp3` | Each time a guest submits a guess | 0.2 sec | Tiny "blip" (keep VERY quiet — fires often!) |

> ⚠️ Files are **only required when you actually want sound**. Missing files
> are silently ignored — nothing crashes if `winnerGuests.mp3` doesn't exist.

## How to get sound clips

### Option A — Use the original "Alle mod 1" file you have (recommended)

You have `data/Sounds/Koldkilde 39 12.m4a`. Open it in **Audacity** (free,
[audacityteam.org](https://www.audacityteam.org/)):

1. Listen and find the moments you want (intro fanfare, drum roll, etc.).
2. Select the segment, **File → Export → Export Selected Audio**.
3. Export as MP3, save to `public/audio/intro.mp3` (or whatever name).
4. Repeat for each clip you want.

> 💡 Keep clips short (a few seconds). Long tracks make the game feel sluggish.
> The "Alle mod 1" theme is recognisable in just 3–5 seconds.

### Option B — Free royalty‑free sound effects

If you'd rather use generic game‑show sounds:

- [pixabay.com/sound-effects](https://pixabay.com/sound-effects/) — search
  "drum roll", "fanfare", "buzzer", "applause" — all free, no attribution
- [freesound.org](https://freesound.org/) — huge library
- [zapsplat.com](https://www.zapsplat.com/) — game show category

Search terms that work well:
- intro / outro: *"game show fanfare"*, *"quiz show theme short"*
- reveal: *"drum roll short"*, *"suspense build"*
- winner: *"crowd cheer"*, *"victory fanfare"*, *"game show win"*
- timeup: *"buzzer"*, *"game show wrong"*
- tick: *"clock ticking 10 seconds"*, *"countdown tick"*

### Option C — No sound at all

Just leave this folder empty. The mute button on the screen header will say
"Klik for at tænde lyd" but nothing happens because no files exist. That's fine.

## How the mute button works

There's a 🔇 / 🔊 button in the top‑right of the big screen.

- **First state**: 🔇 *Lyd er slukket* — click to enable
- **After click**: 🔈 *Klik for at tænde lyd* — also "primes" the browser
  so autoplay works (browsers block audio until user interacts)
- **Final state**: 🔊 *Lyd er tændt* — sounds play on game events

Mute state is saved in localStorage — survives page refresh.

> ⚠️ **Click the audio button BEFORE starting the show** so the intro fanfare
> plays when you press "Vis spørgsmål". Otherwise the browser will block the
> first sound and you have to manually click again.

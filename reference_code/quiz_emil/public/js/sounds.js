/* =====================================================================
 * Alle mod Emil — sound manager
 *
 * Plays short SFX clips at key game moments. Designed for the big screen.
 * - Audio files live in /public/audio/ (any of: mp3, m4a, ogg, wav)
 * - Files are loaded lazily on first play(), preloaded after audio is "primed"
 * - "Priming": browsers block autoplay until the user interacts with the page.
 *   We provide a button on the screen that calls primeAudio() to unlock it.
 * - Each event tries multiple file extensions, so dropping in either
 *   intro.mp3 OR intro.m4a works.
 *
 * Public API (window.AmESound):
 *   AmESound.play(name)       - play a sound (no-op if muted or unprimed)
 *   AmESound.stop(name)       - stop one sound
 *   AmESound.stopAll()        - stop everything
 *   AmESound.setMuted(bool)   - mute/unmute (persisted in localStorage)
 *   AmESound.isMuted()        - current mute state
 *   AmESound.primeAudio()     - unlock browser autoplay (call from a click)
 *   AmESound.isPrimed()       - whether autoplay is unlocked
 * ===================================================================== */
(function () {
  const SOUNDS = {
    intro:        { exts: ['mp3','m4a','ogg','wav'], volume: 1.0 },     // first show-question / game start
    question:     { exts: ['mp3','m4a','ogg','wav'], volume: 0.8 },     // each new question revealed
    emilLocked:   { exts: ['mp3','m4a','ogg','wav'], volume: 0.7 },     // Emil locks his answer
    guestJoined:  { exts: ['mp3','m4a','ogg','wav'], volume: 0.4 },     // a guest submits (subtle)
    tick:         { exts: ['mp3','m4a','ogg','wav'], volume: 0.6 },     // last 10 seconds urgency
    timeup:       { exts: ['mp3','m4a','ogg','wav'], volume: 0.9 },     // timer hits zero
    reveal:       { exts: ['mp3','m4a','ogg','wav'], volume: 0.9 },     // host clicks "Vis svar" (drum roll)
    winnerEmil:   { exts: ['mp3','m4a','ogg','wav'], volume: 1.0 },     // Emil wins the round
    winnerGuests: { exts: ['mp3','m4a','ogg','wav'], volume: 1.0 },     // Guests win the round
    gameover:     { exts: ['mp3','m4a','ogg','wav'], volume: 1.0 },     // final scoreboard
  };

  const cache = {};         // name -> HTMLAudioElement (loaded successfully)
  const missing = new Set(); // names we've tried & failed to load
  let muted = localStorage.getItem('amE_muted') === '1';
  let primed = false;

  function tryLoad(name) {
    if (cache[name] || missing.has(name)) return cache[name] || null;
    const cfg = SOUNDS[name];
    if (!cfg) return null;
    // Try each extension in order; first one that doesn't error keeps the lead
    for (const ext of cfg.exts) {
      const url = `/audio/${name}.${ext}`;
      const audio = new Audio(url);
      audio.preload = 'auto';
      audio.volume = cfg.volume;
      // We can't synchronously test "exists", but the browser will fail gracefully.
      cache[name] = audio;
      // Attach an error handler to mark as missing if it never loads
      audio.addEventListener('error', () => {
        if (cache[name] === audio) {
          // Try next extension if any remain — otherwise mark missing
          delete cache[name];
          const idx = cfg.exts.indexOf(ext);
          if (idx === cfg.exts.length - 1) {
            missing.add(name);
          } else {
            // try the next one
            const nextExt = cfg.exts[idx + 1];
            const next = new Audio(`/audio/${name}.${nextExt}`);
            next.preload = 'auto';
            next.volume = cfg.volume;
            cache[name] = next;
          }
        }
      }, { once: true });
      return audio;
    }
    return null;
  }

  function play(name) {
    if (muted) return;
    if (!primed) return;     // browser will block; don't even try until primed
    const audio = tryLoad(name);
    if (!audio) return;
    try {
      // Restart from the beginning if it was already playing
      audio.currentTime = 0;
    } catch {}
    const p = audio.play();
    if (p && typeof p.catch === 'function') p.catch(() => {});
  }

  function stop(name) {
    const audio = cache[name];
    if (!audio) return;
    try { audio.pause(); audio.currentTime = 0; } catch {}
  }

  function stopAll() {
    Object.keys(cache).forEach(stop);
  }

  function setMuted(b) {
    muted = !!b;
    localStorage.setItem('amE_muted', muted ? '1' : '0');
    if (muted) stopAll();
  }

  function isMuted() { return muted; }

  function primeAudio() {
    if (primed) return;
    primed = true;
    // Trigger a silent play on every cached/queued audio element so the
    // browser remembers we have permission. Then immediately pause + reset.
    Object.keys(SOUNDS).forEach((name) => {
      const audio = tryLoad(name);
      if (!audio) return;
      const wasVolume = audio.volume;
      audio.volume = 0;
      const p = audio.play();
      if (p && typeof p.catch === 'function') {
        p.then(() => {
          audio.pause();
          audio.currentTime = 0;
          audio.volume = wasVolume;
        }).catch(() => {});
      }
    });
  }

  function isPrimed() { return primed; }

  window.AmESound = { play, stop, stopAll, setMuted, isMuted, primeAudio, isPrimed };
})();

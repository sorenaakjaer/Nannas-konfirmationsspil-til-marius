/* Big screen renderer.
   Phases: idle | question | closed | answer | reveal | gameover */

(() => {
  const socket = io();
  const stage = document.getElementById('stage');
  const roundInfo = document.getElementById('roundInfo');
  const emilCandyEl = document.getElementById('emilCandy');
  const guestsCandyEl = document.getElementById('guestsCandy');

  let qrCache = { url: null, dataUrl: null };
  let lastPhase = null;
  let lastRoundIndex = -2;
  let lastEmilLocked = false;
  let phaseEndsAt = null;
  let lockSeconds = null;
  let countdownTimer = null;

  /* ---------- AUDIO TOGGLE BUTTON ---------- */
  function refreshAudioBtn() {
    const Sound = window.AmESound;
    const icon = document.getElementById('audioIcon');
    const label = document.getElementById('audioLabel');
    if (!Sound || !icon || !label) return;
    if (Sound.isMuted()) { icon.textContent = '🔇'; label.textContent = 'Lyd er slukket'; }
    else if (!Sound.isPrimed()) { icon.textContent = '🔈'; label.textContent = 'Klik for at tænde lyd'; }
    else { icon.textContent = '🔊'; label.textContent = 'Lyd er tændt'; }
  }
  const audioBtn = document.getElementById('audioToggle');
  if (audioBtn) {
    audioBtn.onclick = () => {
      const Sound = window.AmESound;
      if (!Sound) return;
      if (Sound.isMuted()) {
        Sound.setMuted(false);
        Sound.primeAudio();
      } else if (!Sound.isPrimed()) {
        Sound.primeAudio();
      } else {
        Sound.setMuted(true);
      }
      refreshAudioBtn();
    };
    refreshAudioBtn();
  }

  socket.emit('hello', { as: 'screen' });
  socket.on('state', render);
  socket.on('guest:joined', (g) => {
    popGuest({
      ...g,
      action: g && g.isNew ? 'har svaret ✅' : 'rettede sit svar ✏️',
    });
    window.AmESound && window.AmESound.play('guestJoined');
  });
  socket.on('guest:ready', (g) => {
    // Same kahoot popup style when someone joins the waiting room (idle phase)
    popGuest({ name: g.name, avatar: g.avatar, isNew: true, action: 'er klar! ✋' });
    window.AmESound && window.AmESound.play('guestJoined');
  });

  async function ensureQr() {
    if (qrCache.dataUrl) return qrCache;
    const r = await fetch('/api/qr');
    qrCache = await r.json();
    return qrCache;
  }

  function render(s) {
    emilCandyEl.textContent = s.emilCandy;
    guestsCandyEl.textContent = s.guestsCandy;
    renderLadder(s);
    const totalEl = document.getElementById('ladderTotal');
    if (totalEl) totalEl.textContent = s.totalCandy;

    const phase = s.round.phase;
    const roundIdx = s.currentRoundIndex;
    const phaseChanged = phase !== lastPhase || roundIdx !== lastRoundIndex;
    const emilJustLocked = s.round.emilAnswered && !lastEmilLocked;

    if (s.question) {
      roundInfo.innerHTML = `<strong>${escapeHtml(s.question.title)}</strong> · spil om <strong>${s.question.reward}</strong> stk. chokolade · Runde ${roundIdx + 1} / ${s.totalRounds}`;
    } else if (phase === 'gameover') {
      roundInfo.innerHTML = `<strong>Spillet er slut!</strong>`;
    } else {
      roundInfo.textContent = `Klar til start — ${s.totalRounds} runder, ${s.totalCandy} stk. chokolade`;
    }

    // ---- Sound triggers based on phase transitions ----
    const phaseChangedNow = phase !== lastPhase;
    const roundChangedNow = roundIdx !== lastRoundIndex;
    const Sound = window.AmESound;
    if (Sound) {
      if (phaseChangedNow && phase === 'question') {
        // First show-question of the entire game = intro; later rounds = question
        if (lastRoundIndex < 0) Sound.play('intro');
        else if (roundChangedNow) Sound.play('question');
      }
      if (emilJustLocked) Sound.play('emilLocked');
      if (phaseChangedNow && phase === 'closed') Sound.play('timeup');
      if (phaseChangedNow && phase === 'answer') Sound.play('reveal');
      if (phaseChangedNow && phase === 'reveal') {
        if (s.round.winner === 'emil') Sound.play('winnerEmil');
        else if (s.round.winner === 'guests') Sound.play('winnerGuests');
      }
      if (phaseChangedNow && phase === 'gameover') Sound.play('gameover');
    }

    lastPhase = phase;
    lastRoundIndex = roundIdx;
    lastEmilLocked = s.round.emilAnswered;

    // Countdown management — only during 'question' phase
    phaseEndsAt = s.round.phaseEndsAt;
    lockSeconds = s.round.lockSeconds;
    if (phase === 'question' && phaseEndsAt) {
      startScreenCountdown();
    } else {
      stopScreenCountdown();
    }

    switch (phase) {
      case 'idle':     return renderIdle(s, phaseChanged);
      case 'question': return renderQuestion(s, phaseChanged, emilJustLocked);
      case 'closed':   return renderClosed(s);
      case 'answer':   return renderAnswer(s, phaseChanged);
      case 'reveal':   return renderReveal(s, phaseChanged);
      case 'gameover': return renderGameover(s);
      default:         return renderIdle(s);
    }
  }

  /* ---------- IDLE / FRONT PAGE ---------- */
  async function renderIdle(s, phaseChanged) {
    const qr = await ensureQr();
    if (!phaseChanged && document.getElementById('readyList')) {
      // Just refresh the ready list without rebuilding the whole page
      const gc = document.getElementById('idleGuestCount');
      if (gc) gc.textContent = ((s.knownGuests && s.knownGuests.length) || 0) + (s.connectedEmil ? 1 : 0);
      updateReadyList(s.knownGuests || [], s.connectedEmil);
      return;
    }
    stage.innerHTML = `
      <div class="front-page">
        <div class="front-tagline">Det helt nye DR-show...</div>
        <div class="front-title">
          <span class="ft-prefix">ALLE MOD</span>
          <span class="ft-strike-wrap">
            <span class="ft-strike">1</span>
            <svg class="ft-cross" viewBox="0 0 100 100" preserveAspectRatio="none">
              <line x1="10" y1="15" x2="90" y2="85" stroke="#ff4d6d" stroke-width="9" stroke-linecap="round"/>
              <line x1="10" y1="85" x2="90" y2="15" stroke="#ff4d6d" stroke-width="9" stroke-linecap="round"/>
            </svg>
          </span>
          <span class="ft-emil">EMIL</span>
        </div>
        <div class="front-occasion">Emils konfirmation · 25. april</div>

        <div class="front-join">
          <div class="front-join-qr">
            <img alt="QR-kode" src="${qr.dataUrl}" />
          </div>
          <div class="front-join-info">
            <div class="front-join-title">Vær klar fra start! 📱</div>
            <ol class="front-join-steps">
              <li><strong>Skan QR-koden</strong> med dit kamera</li>
              <li>Skriv dit <strong>navn</strong> og vælg <strong>avatar</strong></li>
              <li>Vent på at værten starter spillet</li>
            </ol>
            <div class="front-join-url">${escapeHtml(qr.url)}</div>
            <div class="front-join-counter">
              <span class="dot"></span>
              <strong id="idleGuestCount">${((s.knownGuests && s.knownGuests.length) || 0) + (s.connectedEmil ? 1 : 0)}</strong>
              <span>er klar til at spille</span>
            </div>
          </div>
        </div>

        <div class="ready-room">
          <div class="ready-list" id="readyList"></div>
          <div class="ready-empty" id="readyEmpty">Skan QR-koden og bliv den første!</div>
        </div>

        <div class="ft-stats">
          <span><strong>${s.totalRounds}</strong> runder</span>
          <span class="dot-sep">•</span>
          <span><strong>${s.totalCandy}</strong> stk. Kinder Maxi</span>
          <span class="dot-sep">•</span>
          <span>Vinder Emil — eller os?</span>
        </div>
        <div class="front-rule">⚖️ Husregel: ved stemmelighed (eller lige langt fra i hele tal) vinder Emil</div>
      </div>`;

    updateReadyList(s.knownGuests || [], s.connectedEmil);
  }

  /* Smart-update the ready list so existing avatars don't re-animate */
  function updateReadyList(guests, emilOnline) {
    const list = document.getElementById('readyList');
    const emptyMsg = document.getElementById('readyEmpty');
    if (!list) return;

    const combined = emilOnline
      ? [{ name: 'Emil', avatar: '🤫', emil: true }, ...guests]
      : guests;

    if (!combined.length) {
      list.innerHTML = '';
      if (emptyMsg) emptyMsg.style.display = '';
      return;
    }
    if (emptyMsg) emptyMsg.style.display = 'none';

    // Build a key for current items so we know what's new
    const existingKeys = new Set(
      Array.from(list.querySelectorAll('.ready-item')).map((el) => el.dataset.key)
    );

    // Update existing + add new
    const fragment = document.createDocumentFragment();
    const seen = new Set();
    combined.forEach((g) => {
      const key = (g.avatar || '🎭') + '|' + (g.name || 'Ukendt');
      seen.add(key);
      if (existingKeys.has(key)) return; // already shown — keep DOM intact
      const item = document.createElement('div');
      item.className = 'ready-item just-joined' + (g.emil ? ' emil' : '');
      item.dataset.key = key;
      item.innerHTML = `
        <div class="ra-avatar">${escapeHtml(g.avatar || '🎭')}</div>
        <div class="ra-name">${escapeHtml(g.name || 'Ukendt')}</div>`;
      fragment.appendChild(item);
      // Remove the "just-joined" animation class after it plays
      setTimeout(() => item.classList.remove('just-joined'), 800);
    });
    list.appendChild(fragment);

    // Remove items that aren't in the list anymore (rare — only on game reset)
    list.querySelectorAll('.ready-item').forEach((el) => {
      if (!seen.has(el.dataset.key)) el.remove();
    });
  }

  /* ---------- QUESTION (open for both Emil + guests) ---------- */
  async function renderQuestion(s, phaseChanged, emilJustLocked) {
    const q = s.question;
    if (!q) return;
    const qr = await ensureQr();

    if (phaseChanged) {
      stage.innerHTML = `
        <div class="qphase">
          <div class="qphase-topbar">
            <div class="emil-status ${s.round.emilAnswered ? 'locked' : ''}" id="emilStatus">${questionEmilStatus(s)}</div>
            <div class="screen-countdown" id="screenCountdown">
              <div class="cd-circle"><span id="screenCdValue">--</span><span class="cd-unit">sek</span></div>
            </div>
            <div class="live-counter"><span class="dot"></span><span><strong id="guestCount">${s.round.guestCount}</strong> har gættet</span></div>
          </div>

          <div class="qphase-main">
            <div class="qphase-meta">
              <span class="qphase-title">${escapeHtml(q.title)}</span>
              <span class="qphase-reward">🍫 ${q.reward} stk. på spil</span>
            </div>
            <div class="qphase-question">${escapeHtml(q.question)}</div>
            ${rangeBadge(q)}
            ${q.hint ? `<div class="qphase-hint">${escapeHtml(q.hint)}</div>` : ''}
          </div>

          <div class="qphase-bottom">
            <div class="qphase-qr"><img alt="QR-kode" src="${qr.dataUrl}" /></div>
            <div class="qphase-cta">
              <div class="qphase-cta-title">📱 Skan og gæt med</div>
              <div class="qphase-cta-url">${escapeHtml(qr.url)}</div>
              <div class="qphase-cta-hint">Indtast dit gæt i <strong>${escapeHtml(q.unit)}</strong> og tryk <strong>SEND</strong></div>
            </div>
            <div class="qphase-answers">
              <div class="qphase-answers-title">Hvem har svaret?</div>
              <div class="answered-list" id="answeredList"></div>
              <div class="answered-empty" id="answeredEmpty">Ingen svar endnu</div>
            </div>
          </div>

          <div class="popup-area" id="popupArea"></div>
        </div>`;
    } else {
      const gc = document.getElementById('guestCount');
      if (gc) gc.textContent = s.round.guestCount;
      const es = document.getElementById('emilStatus');
      if (es) {
        es.textContent = questionEmilStatus(s);
        es.classList.toggle('locked', s.round.emilAnswered);
      }
      updateAnsweredList(s.round.answeredGuests || []);
    }

    updateAnsweredList(s.round.answeredGuests || []);
    if (emilJustLocked) popEmilLocked();
  }

  /* ---------- CLOSED ---------- */
  function renderClosed(s) {
    stage.innerHTML = `
      <div class="closed-screen">
        <div class="stage-title">Afstemning lukket</div>
        <div class="stage-question">Tid til at finde det rigtige svar...</div>
        <div class="closed-stats">
          <div class="closed-stat">
            <div class="num">${s.round.guestCount}</div>
            <div class="lbl">gæster har gættet</div>
          </div>
          <div class="closed-stat">
            <div class="num">${s.round.emilAnswered ? '✓' : '✗'}</div>
            <div class="lbl">Emil har svaret</div>
          </div>
        </div>
        <div class="reward-pill">🍫 ${s.question ? s.question.reward : 0} Kinder Maxi på spil</div>
      </div>`;
  }

  /* ---------- ANSWER (facit + Emil reveal, suspense) ---------- */
  function renderAnswer(s, phaseChanged) {
    const q = s.question;
    const r = s.round;
    stage.innerHTML = `
      <div class="answer-screen">
        <div class="stage-title">${escapeHtml(q ? q.title : 'Resultat')}</div>

        <div class="answer-grid">
          <div class="answer-card correct">
            <div class="lbl">Det rigtige svar</div>
            <div class="big-val">${formatNumber(r.correctAnswer)}</div>
            <div class="unit">${escapeHtml(q ? q.unit : '')}</div>
          </div>
          <div class="vs-small">VS</div>
          <div class="answer-card emil">
            <div class="lbl">Emils gæt</div>
            <div class="big-val">${formatNumber(r.emilAnswer)}</div>
            <div class="unit">afvigelse: ${formatNumber(Math.abs((r.emilAnswer ?? 0) - (r.correctAnswer ?? 0)))}</div>
          </div>
        </div>

        <div class="answer-suspense">Hvor tæt kom gæsterne på? 🥁</div>
      </div>`;
    if (phaseChanged) {
      // Subtle drum-roll vibe via the suspense element animation (pure CSS)
    }
  }

  /* ---------- REVEAL (single-screen, no median row) ---------- */
  function renderReveal(s, phaseChanged) {
    const q = s.question;
    const r = s.round;
    const stats = r.stats || {};
    const winnerLabel = r.winner === 'emil' ? 'EMIL VINDER!'
      : r.winner === 'guests' ? 'GÆSTERNE VINDER!'
      : 'UAFGJORT';
    const winnerClass = r.winner || 'tie';

    stage.innerHTML = `
      <div class="reveal-screen">
        <div class="stage-title">${escapeHtml(q ? q.title : 'Resultat')}</div>

        <div class="reveal-top">
          <div class="reveal-card correct">
            <div class="lbl">FACIT</div>
            <div class="val">${formatNumber(r.correctAnswer)}</div>
            <div class="unit">${escapeHtml(q ? q.unit : '')}</div>
          </div>
          <div class="reveal-card emil">
            <div class="lbl">Emils gæt · ${formatNumber(stats.emilDist)} fra</div>
            <div class="val">${formatNumber(r.emilAnswer)}</div>
          </div>
          <div class="reveal-card guests">
            <div class="lbl">Gæsternes snit · ${formatNumber(stats.guestsDist)} fra</div>
            <div class="val">${formatNumber(stats.avg)}</div>
          </div>
        </div>

        <div class="distribution">
          <h3>Gæsternes ${stats.count ?? 0} gæt på skalaen</h3>
          <div class="dist-canvas" id="distCanvas"></div>
        </div>

        <div class="winner-banner ${winnerClass}">
          ${winnerLabel} ${r.winner !== 'tie' ? `· +${q ? q.reward : 0} 🍫` : ''}
        </div>
      </div>`;

    drawDistribution(r.guestAnswers || [], r.emilAnswer, r.correctAnswer, q);

    if (phaseChanged && r.winner && r.winner !== 'tie') {
      fireConfetti(r.winner === 'emil' ? ['#ff4d8d', '#ff8a00', '#ffd166'] : ['#4dd2ff', '#2ee59d', '#ffd166']);
    }
  }

  /* ---------- GAMEOVER ---------- */
  function renderGameover(s) {
    const winner = s.emilCandy > s.guestsCandy ? 'emil'
      : s.emilCandy < s.guestsCandy ? 'guests' : 'tie';
    const winnerLabel = winner === 'emil' ? 'DEN ENDELIGE VINDER ER I DAG EMIL'
      : winner === 'guests' ? 'DEN ENDELIGE VINDER ER I DAG GÆSTERNE'
      : 'DET ENER UAFGJORT I DAG';
    stage.innerHTML = `
      <div class="gameover" style="text-align:center;">
        <div class="stage-title">Slutresultat</div>
        <h1>${winnerLabel}</h1>
        <div class="gameover-scores">
          <div><span class="emil">${s.emilCandy}</span><div>Emil</div></div>
          <div><span class="guests">${s.guestsCandy}</span><div>Gæsterne</div></div>
        </div>
        <p class="gameover-thanks">Tak for at I spillede med 🎉<br /><span style="opacity:.7; font-size: 0.85em;">Emils konfirmation · 25. april</span></p>
      </div>`;
    fireConfetti(['#ff4d8d', '#ff8a00', '#ffd166', '#4dd2ff', '#2ee59d']);
  }

  /* ---------- SCREEN COUNTDOWN ---------- */
  let tickSoundFiredAt10 = false;

  function startScreenCountdown() {
    if (countdownTimer) clearInterval(countdownTimer);
    tickSoundFiredAt10 = false;
    tickScreen();
    countdownTimer = setInterval(tickScreen, 200);
  }
  function stopScreenCountdown() {
    if (countdownTimer) { clearInterval(countdownTimer); countdownTimer = null; }
    const cd = document.getElementById('screenCountdown');
    if (cd) cd.classList.remove('urgent');
    tickSoundFiredAt10 = false;
  }
  function tickScreen() {
    const cd = document.getElementById('screenCountdown');
    const valEl = document.getElementById('screenCdValue');
    if (!cd || !valEl || !phaseEndsAt) return;
    const remaining = Math.max(0, Math.ceil((phaseEndsAt - Date.now()) / 1000));
    valEl.textContent = remaining;
    cd.classList.toggle('urgent', remaining <= 10);
    if (remaining === 10 && !tickSoundFiredAt10) {
      tickSoundFiredAt10 = true;
      if (window.AmESound) window.AmESound.play('tick');
    }
    if (remaining <= 0) stopScreenCountdown();
  }

  /* ---------- KAHOOT-STYLE POPUPS ---------- */
  function popGuest({ name, avatar, isNew, action }) {
    // Use the popup area if it exists (during 'question' phase),
    // else fall back to a body-level popup so it works on the front page too.
    let area = document.getElementById('popupArea');
    if (!area) area = ensureBodyPopupArea();
    const el = document.createElement('div');
    el.className = 'popup popup-guest' + (isNew ? ' new' : '');
    const actionText = action || (isNew ? 'har svaret ✅' : 'rettede sit svar ✏️');
    el.innerHTML = `
      <span class="popup-avatar">${escapeHtml(avatar || '🎭')}</span>
      <span class="popup-name">${escapeHtml(name || 'Ukendt')}</span>
      <span class="popup-action">${escapeHtml(actionText)}</span>`;
    area.appendChild(el);
    setTimeout(() => el.classList.add('out'), 2200);
    setTimeout(() => el.remove(), 3000);
  }

  function ensureBodyPopupArea() {
    let area = document.getElementById('bodyPopupArea');
    if (area) return area;
    area = document.createElement('div');
    area.id = 'bodyPopupArea';
    area.className = 'popup-area body-popup-area';
    document.body.appendChild(area);
    return area;
  }

  function popEmilLocked() {
    const area = document.getElementById('popupArea');
    if (!area) return;
    const el = document.createElement('div');
    el.className = 'popup popup-emil';
    el.innerHTML = `
      <span class="popup-avatar">🤫</span>
      <span class="popup-name">EMIL</span>
      <span class="popup-action">har svaret ✅</span>`;
    area.appendChild(el);
    setTimeout(() => el.classList.add('out'), 2800);
    setTimeout(() => el.remove(), 3600);
  }

  /* ---------- LADDER ---------- */
  function renderLadder(s) {
    const host = document.getElementById('ladderSteps');
    if (!host) return;
    const totalRounds = s.totalRounds;
    const cur = s.currentRoundIndex;

    const order = [];
    for (let i = totalRounds - 1; i >= 0; i--) order.push(i);

    host.innerHTML = order.map((i) => {
      const reward = s.rewardLadder[i];
      const isFinale = i === totalRounds - 1;
      let stateClass = 'upcoming';
      let mark = '';

      if (i < cur) {
        const h = s.history.find((x) => x.roundIndex === i);
        if (h && h.winner === 'emil')        { stateClass = 'done-emil';   mark = 'E'; }
        else if (h && h.winner === 'guests') { stateClass = 'done-guests'; mark = 'G'; }
        else                                  { stateClass = 'done-tie';    mark = '='; }
      } else if (i === cur) {
        stateClass = 'active';
        mark = '●';
      }

      const label = isFinale ? 'FINALE' : `${reward}`;
      const sub   = isFinale ? `${reward} 🍫` : '🍫';
      const finaleClass = isFinale ? ' finale' : '';

      return `
        <div class="ladder-step ${stateClass}${finaleClass}">
          <div class="marker">${mark}</div>
          <div class="amount">${label}</div>
          <div class="reward">${sub}</div>
        </div>`;
    }).join('');
  }

  /* ---------- HORIZONTAL RANGE CHART ---------- */
  function drawDistribution(guests, emil, correct, q) {
    const host = document.getElementById('distCanvas');
    if (!host) return;
    const W = host.clientWidth;
    const H = host.clientHeight;

    const values = guests.map((g) => g.value);
    const allMarkers = [emil, correct].filter((x) => typeof x === 'number');
    if (!values.length && !allMarkers.length) {
      host.innerHTML = '<p style="color: var(--text-dim); text-align:center; margin-top: 1rem;">Ingen gæt registreret.</p>';
      return;
    }

    let min = q && q.min != null ? q.min : Math.min(...values, ...allMarkers);
    let max = q && q.max != null ? q.max : Math.max(...values, ...allMarkers);
    if (min === max) { min -= 1; max += 1; }

    const statsAvg = values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;
    const padL = 34, padR = 34, padT = 28, padB = 54;
    const chartW = W - padL - padR;
    const midY = Math.max(70, H * 0.55);
    const lineY = midY;

    function xOf(v) {
      return padL + ((v - min) / (max - min)) * chartW;
    }

    const startX = xOf(min);
    const endX = xOf(max);
    const avgX = statsAvg !== null ? xOf(statsAvg) : startX;
    const correctX = typeof correct === 'number' ? xOf(correct) : null;
    const emilX = typeof emil === 'number' ? xOf(emil) : null;

    const labelsClose = correctX !== null && statsAvg !== null && Math.abs(avgX - correctX) < 44;
    const facitLabelY = labelsClose ? lineY - 64 : lineY - 54;
    const avgLabelY = labelsClose ? lineY + 46 : lineY - 18;
    const avgLabelFill = '#4dd2ff';

    host.innerHTML = `
      <svg class="dist-svg" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">
        <defs>
          <linearGradient id="avgGrad" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stop-color="#1f6fb4" />
            <stop offset="100%" stop-color="#4dd2ff" />
          </linearGradient>
        </defs>

        <!-- full range -->
        <line x1="${startX}" y1="${lineY}" x2="${endX}" y2="${lineY}" stroke="rgba(255,255,255,0.22)" stroke-width="14" stroke-linecap="round" />

        <!-- average bar: from min to average -->
        ${statsAvg !== null ? `<line x1="${startX}" y1="${lineY}" x2="${avgX}" y2="${lineY}" stroke="url(#avgGrad)" stroke-width="14" stroke-linecap="round" />` : ''}

        <!-- facit marker -->
        ${correctX !== null ? `
          <line x1="${correctX}" y1="${lineY - 55}" x2="${correctX}" y2="${lineY + 18}" stroke="#2ee59d" stroke-width="4" stroke-linecap="round" />
          <text x="${correctX}" y="${facitLabelY}" text-anchor="middle" fill="#2ee59d" font-size="13" font-weight="800">FACIT ${Math.round(correct)}</text>
        ` : ''}

        <!-- Emil marker -->
        ${emilX !== null ? `
          <line x1="${emilX}" y1="${lineY - 40}" x2="${emilX}" y2="${lineY + 18}" stroke="#ff4d8d" stroke-width="4" stroke-linecap="round" />
          <text x="${emilX}" y="${lineY + 18}" dy="-52" text-anchor="middle" fill="#ff4d8d" font-size="13" font-weight="800">EMIL ${Math.round(emil)}</text>
        ` : ''}

        <!-- average badge -->
        ${statsAvg !== null ? `
          <circle cx="${avgX}" cy="${lineY}" r="9" fill="#4dd2ff" stroke="#ffffff" stroke-width="2" />
          <text x="${avgX}" y="${avgLabelY}" text-anchor="middle" fill="${avgLabelFill}" font-size="13" font-weight="800">SNIT ${Math.round(statsAvg)}</text>
        ` : ''}

        <text x="${startX}" y="${lineY + 20}" dy="28" text-anchor="start" fill="#c9bfe6" font-size="12" font-weight="700">MIN ${Math.round(min)}</text>
        <text x="${endX}" y="${lineY + 20}" dy="28" text-anchor="end" fill="#c9bfe6" font-size="12" font-weight="700">MAX ${Math.round(max)}</text>
      </svg>`;
  }

  /* ---------- HELPERS ---------- */
  function questionEmilStatus(s) {
    if (s.round.emilAnswered) return '✓ EMIL HAR SVARET';
    if (s.connectedEmil) return '🟢 Emil er klar';
    return '⚪ Emil er ikke joinet';
  }

  function updateAnsweredList(guests) {
    const list = document.getElementById('answeredList');
    const empty = document.getElementById('answeredEmpty');
    if (!list || !empty) return;
    if (!guests.length) {
      list.innerHTML = '';
      empty.style.display = '';
      return;
    }
    empty.style.display = 'none';
    list.innerHTML = guests.map((g) => `
      <div class="answered-item">
        <span class="answered-avatar">${escapeHtml(g.avatar || '🎭')}</span>
        <span class="answered-name">${escapeHtml(g.name || 'Ukendt')}</span>
      </div>
    `).join('');
  }

  function rangeBadge(q) {
    if (q.min == null && q.max == null) return '';
    const lo = q.min == null ? '?' : formatNumber(q.min);
    const hi = q.max == null ? '?' : formatNumber(q.max);
    return `<div class="range-badge">Realistisk gæt: <strong>${lo}</strong> – <strong>${hi}</strong> ${escapeHtml(q.unit)}</div>`;
  }

  function fireConfetti(colors) {
    const N = 80;
    for (let i = 0; i < N; i++) {
      const el = document.createElement('div');
      el.className = 'confetti-piece';
      el.style.left = Math.random() * 100 + 'vw';
      el.style.background = colors[i % colors.length];
      el.style.setProperty('--dx', (Math.random() * 200 - 100) + 'px');
      el.style.animationDelay = (Math.random() * 0.6) + 's';
      el.style.animationDuration = (3 + Math.random() * 2) + 's';
      document.body.appendChild(el);
      setTimeout(() => el.remove(), 6000);
    }
  }

  function escapeHtml(s) {
    return String(s ?? '').replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[c]));
  }

  function formatNumber(n) {
    if (n === null || n === undefined) return '—';
    if (typeof n !== 'number') n = Number(n);
    if (Number.isNaN(n)) return '—';
    if (Number.isInteger(n)) return n.toLocaleString('da-DK');
    return n.toLocaleString('da-DK', { maximumFractionDigits: 2 });
  }
})();

(() => {
  const socket = io();
  const body = document.body;
  const stage = document.getElementById('stage');
  const top3El = document.getElementById('top3');
  let phaseEndsAt = null;
  let timer = null;
  let drumStarted = false;
  let currentQuestionDurationMs = 0;
  let countdownSecondMarker = null;
  let playedZeroGong = false;
  let audioContext = null;
  let previousTop3 = [];
  let previousScreenStateKey = '';
  let currentPhaseKey = '';
  let tickingPlaying = false;
  let audioUnlocked = false;

  const sounds = {};

  function loadSound(name, src, opts = {}) {
    const audio = new Audio(src);
    audio.preload = 'auto';
    audio.volume = opts.volume ?? 0.7;
    if (opts.loop) audio.loop = true;
    sounds[name] = audio;
  }

  loadSound('preCountdown', '/sounds/pre-countdown.mp3', { volume: 0.7 });
  loadSound('tick', '/sounds/tick.mp3', { volume: 0.55, loop: true });
  loadSound('buzzer', '/sounds/buzzer.mp3', { volume: 0.85 });
  loadSound('cheer', '/sounds/cheer.mp3', { volume: 0.85 });
  loadSound('drumroll', '/sounds/drumroll.mp3', { volume: 0.8 });
  loadSound('finaleMusic', '/sounds/finale-music.mp3', { volume: 0.6 });
  loadSound('correctDing', '/sounds/correct-ding.mp3', { volume: 0.7 });
  loadSound('gameSting', '/sounds/game-show-sting.mp3', { volume: 0.7 });

  function playSound(name, { restart = true } = {}) {
    const a = sounds[name];
    if (!a) return;
    try {
      if (restart) { a.currentTime = 0; }
      const p = a.play();
      if (p && typeof p.catch === 'function') p.catch(() => {});
    } catch (_e) { /* ignore */ }
  }

  function stopSound(name) {
    const a = sounds[name];
    if (!a) return;
    try {
      a.pause();
      a.currentTime = 0;
    } catch (_e) { /* ignore */ }
  }

  function fadeOutSound(name, duration = 600) {
    const a = sounds[name];
    if (!a) return;
    const startVol = a.volume;
    const startTime = performance.now();
    function step(now) {
      const t = Math.min(1, (now - startTime) / duration);
      a.volume = startVol * (1 - t);
      if (t < 1) requestAnimationFrame(step);
      else { try { a.pause(); a.currentTime = 0; a.volume = startVol; } catch (_e) {} }
    }
    requestAnimationFrame(step);
  }

  socket.emit('hello', { as: 'screen' });
  socket.on('state', render);
  socket.on('guest:ready', () => {
    // Keep event for future effects.
  });

  function unlockAudio() {
    audioUnlocked = true;
    try { getAudioContext(); } catch (_e) { /* ignore */ }
    Object.values(sounds).forEach((a) => {
      try {
        a.muted = true;
        const p = a.play();
        if (p && typeof p.then === 'function') {
          p.then(() => { a.pause(); a.currentTime = 0; a.muted = false; }).catch(() => { a.muted = false; });
        } else {
          a.pause(); a.currentTime = 0; a.muted = false;
        }
      } catch (_e) { /* ignore */ }
    });
  }
  ['pointerdown', 'keydown', 'touchstart', 'click'].forEach((evt) => {
    window.addEventListener(evt, unlockAudio, { once: true, passive: true });
  });

  function render(s) {
    applyConfig(s.config);
    const introMode = s.phase === 'lobby' && s.lobbyView === 'intro';
    const qrMode = s.phase === 'lobby' && s.lobbyView === 'qr';
    const activeGameMode = !introMode && !qrMode;
    const resultMode = s.phase === 'answer_reveal' || s.phase === 'scoreboard' || s.phase === 'finale';
    body.classList.toggle('intro-mode', introMode);
    body.classList.toggle('qr-mode', qrMode);
    body.classList.toggle('active-game-mode', activeGameMode);
    body.classList.toggle('result-mode', resultMode);
    phaseEndsAt = s.phaseEndsAt;
    currentQuestionDurationMs = Number(s.phaseDurationMs) || 0;
    animateStageTransition(`${s.phase}:${s.lobbyView || ''}:${s.question?.id || ''}`);
    handlePhaseAudio(s);
    if (!introMode && !qrMode) updateTopAndHunt(s);
    if (s.phase === 'question_open' || s.phase === 'pre_question') startTimer();
    else stopTimer();

    if (s.phase !== 'question_open' && s.phase !== 'answer_reveal' && s.phase !== 'scoreboard') {
      const sidebarRecapEl = document.getElementById('sidebarRecap');
      if (sidebarRecapEl) sidebarRecapEl.innerHTML = '';
    }
    if (s.phase === 'lobby') return renderLobby(s);
    if (s.phase === 'pre_question') return renderPreQuestion(s);
    if (s.phase === 'question_open') return renderQuestion(s);
    if (s.phase === 'question_locked') return renderLocked(s);
    if (s.phase === 'answer_reveal') return renderReveal(s);
    if (s.phase === 'scoreboard') return renderScoreboard(s);
    return renderFinale(s);
  }

  function handlePhaseAudio(s) {
    const key = `${s.phase}:${s.question?.id || ''}`;
    if (key === currentPhaseKey) return;
    currentPhaseKey = key;

    stopSound('preCountdown');
    if (tickingPlaying) {
      stopSound('tick');
      tickingPlaying = false;
    }

    if (s.phase === 'pre_question') {
      playSound('preCountdown');
    } else if (s.phase === 'question_locked' || s.phase === 'answer_reveal') {
      // buzzer is fired from tick when sec hits 0; keep silent here
    } else if (s.phase === 'finale') {
      playSound('cheer');
      setTimeout(() => playSound('finaleMusic'), 400);
    } else if (s.phase === 'lobby') {
      stopSound('finaleMusic');
      stopSound('cheer');
      stopSound('drumroll');
    }
  }

  async function renderLobby(s) {
    drumStarted = false;
    if (s.lobbyView === 'intro') {
      stage.innerHTML = `
        <div class="intro-stage">
          <div class="intro-center">
            <div class="intro-brand-shell">
              <div class="intro-brand-text">
                <span class="brand-nanna">${escapeHtml(s.config?.hostBrandText || s.config?.hostName || 'Nannas')}</span>
                <span class="brand-store">STORE</span>
                <span class="brand-rest">quiz til</span>
                <span class="brand-marius">${escapeHtml(s.config?.celebrantName || 'Marius')}</span>
              </div>
              <div class="site-breaking intro-breaking">
                <span class="breaking-dot"></span>
                <span class="breaking-label">${escapeHtml(s.config?.liveLine || 'Live fra konfirmationen den 2. maj i Den Japanske Have')}</span>
              </div>
            </div>
          </div>
        </div>
      `;
      return;
    }
    const qr = await fetch('/api/qr').then((r) => r.json()).catch(() => null);
    stage.innerHTML = `
      <div class="lobby-grid">
        <div class="qr-card">
          ${qr ? `<img alt="QR kode" src="${qr.dataUrl}">` : ''}
          <p class="muted">${qr ? qr.url : '/play'}</p>
        </div>
        <div class="hero-panel">
          <div class="eyebrow">Klar til start</div>
          <h2 class="hero-title">Scan og deltag</h2>
          <p class="hero-blurb">Vælg navn og avatar på mobilen. Når quizzen starter, gælder det om at svare hurtigt og rigtigt.</p>
          <div class="lobby-stats">
            <div class="stat-pill"><span>Klar lige nu</span><strong>${s.connectedGuests}</strong></div>
            <div class="stat-pill"><span>Spørgsmål</span><strong>${s.totalQuestions || s.selectedQuestionCount || 0}</strong></div>
          </div>
          <div class="ready-list">
            ${(s.knownGuests || []).map((p) => `<span class="ready-pill">${renderAvatar(p.avatar)} ${escapeHtml(p.name)}</span>`).join('')}
          </div>
        </div>
      </div>
    `;
  }

  function renderQuestion(s) {
    const q = s.question;
    if (!q) return;
    const hasMedia = Boolean(q.questionImageUrl);
    stage.innerHTML = `
      <div class="score-stage ${hasMedia ? 'has-reveal' : ''}">
        <div class="question-hud" id="questionHud">
          <div class="question-progress">
            <div class="question-progress-bar">
              <div class="question-progress-fill" id="questionCountdownFill"></div>
            </div>
            <div class="question-progress-value" id="questionCountdownValue">--</div>
          </div>
        </div>
        <div class="eyebrow">Spørgsmål ${s.questionIndex || 0} ud af ${s.totalQuestions || 0}</div>
        <h2 class="question-title result-title">${escapeHtml(q.prompt)}</h2>
        <div class="option-grid large-option-grid result-options-grid options-${q.options.length}">
          ${q.options.map((o) => `
            <div class="option-btn" style="background:${o.color}; cursor:default;">
              <span class="option-shape">${shapeFor(o.shape)}</span>
              ${o.imageUrl ? `<img class="option-image" src="${escapeAttr(o.imageUrl)}" alt="${escapeAttr(o.text)}">` : ''}
              <span class="option-text">${escapeHtml(o.text)}</span>
            </div>
          `).join('')}
        </div>
        ${q.questionImageUrl ? `<div class="result-media-frame"><img class="question-image reveal-large-image" src="${q.questionImageUrl}" alt="Spørgsmålsbillede"></div>` : ''}
      </div>
    `;
    renderSidebarRecap(s, 'live');
  }

  function renderPreQuestion(s) {
    const upcoming = Math.max(1, Math.min(Number(s.questionIndex || 1), Number(s.totalQuestions || 1)));
    const total = s.totalQuestions || 0;
    stage.innerHTML = `
      <div class="pre-question-stage">
        <div class="pre-question-spotlight">
          <div class="pre-question-eyebrow">
            <span class="pre-dot"></span>
            <span>Næste spørgsmål${total ? ` · ${upcoming} af ${total}` : ''}</span>
          </div>
          <div class="pre-question-ring">
            <span class="pre-ring pre-ring--1"></span>
            <span class="pre-ring pre-ring--2"></span>
            <span class="pre-ring pre-ring--3"></span>
            <div class="pre-question-count-wrap">
              <div class="pre-question-count" id="questionCountdownValue" data-last="">5</div>
            </div>
          </div>
          <div class="pre-question-tagline">
            <span class="pre-question-headline">Gør jer klar</span>
            <span class="pre-question-sub">Find fingrene frem · hurtig + rigtig giver flest point</span>
          </div>
          <div class="pre-question-hud" id="questionHud">
            <div class="pre-question-bar">
              <div class="pre-question-bar-fill" id="questionCountdownFill"></div>
              <div class="pre-question-bar-pulse"></div>
            </div>
            <div class="pre-question-bar-value" id="questionCountdownValueSecondary">5s</div>
          </div>
        </div>
      </div>
    `;
  }

  function renderLocked(s) {
    stage.innerHTML = `
      <div class="locked-stage">
        <div class="eyebrow">Time Is Up</div>
        <h2>Spørgsmålet er låst</h2>
        <div class="lobby-stats">
          <div class="stat-pill"><span>Svar modtaget</span><strong>${s.round.answersCount}</strong></div>
          <div class="stat-pill"><span>${escapeHtml(s.config?.celebrantName || 'Marius')}</span><strong>${s.round.mariusAnswered ? 'Klar' : 'Mangler'}</strong></div>
          <div class="stat-pill"><span>Næste</span><strong>Reveal</strong></div>
        </div>
        <p class="muted">Musikken dør ud, lyset dæmpes, og hosten gør klar til afsløringen.</p>
      </div>
    `;
  }

  function renderReveal(s) {
    renderCombinedResult(s, 'Svar Afsløres');
  }

  function renderScoreboard(s) {
    renderCombinedResult(s, 'Stilling efter spørgsmålet');
  }

  function renderFinale(s) {
    if (!drumStarted) {
      drumStarted = true;
      playDrumRoll();
      fireConfetti();
    }
    const realTop4 = s.finalTop4 || [];
    const celebrant = s.config?.celebrantName || 'Marius';
    const hostName = s.config?.hostName || 'Nanna';
    const topPoints = realTop4.length ? Number(realTop4[0].points || 0) : 0;
    const mariusPoints = Math.max(10000, topPoints + 1000);
    const second = realTop4[0];
    const third = realTop4[1];
    const fourth = realTop4[2];
    const renderPodiumCard = (place, name, avatar, points, sub, extraClass = '') => `
      <div class="finale-podium-step finale-place-${place} ${extraClass}">
        <div class="finale-medal">${place === 1 ? '👑' : place === 2 ? '🥈' : place === 3 ? '🥉' : '🎖️'}</div>
        <div class="finale-avatar-ring">
          <div class="finale-avatar">${renderAvatar(avatar, 'large')}</div>
        </div>
        <div class="finale-name">${escapeHtml(name || 'Tom plads')}</div>
        <div class="finale-points">${points != null ? `${points.toLocaleString('da-DK')} point` : (sub || '')}</div>
        <div class="finale-block">
          <div class="finale-block-rank">${place}</div>
        </div>
      </div>
    `;
    stage.innerHTML = `
      <div class="finale-stage finale-stage-pro">
        <div class="finale-banner">
          <span class="finale-banner-spark">✨</span>
          <span>Dagens vinder</span>
          <span class="finale-banner-spark">✨</span>
        </div>
        <h1 class="finale-headline">${escapeHtml(celebrant)}</h1>
        <div class="finale-podium-stage">
          ${second ? renderPodiumCard(2, second.name, second.avatar, second.points) : `<div class="finale-podium-step finale-place-2 finale-empty"><div class="finale-block"><div class="finale-block-rank">2</div></div></div>`}
          ${renderPodiumCard(1, celebrant, '👑', mariusPoints, null, 'is-celebrant')}
          ${third ? renderPodiumCard(3, third.name, third.avatar, third.points) : `<div class="finale-podium-step finale-place-3 finale-empty"><div class="finale-block"><div class="finale-block-rank">3</div></div></div>`}
        </div>
        ${fourth ? `
          <div class="finale-honourable">
            <span class="finale-honourable-badge">🎖️ 4. plads</span>
            <span class="finale-honourable-name">${renderAvatar(fourth.avatar, 'large')} ${escapeHtml(fourth.name)}</span>
            <span class="finale-honourable-points">${Number(fourth.points || 0).toLocaleString('da-DK')} point</span>
          </div>
        ` : ''}
        <div class="finale-thanks">
          <div class="finale-thanks-line">Tak fordi I spillede med og I lod ${escapeHtml(celebrant)} vinde</div>
          <div class="finale-hashtag">#KæmpeLOVEfra${escapeHtml(hostName)}</div>
        </div>
      </div>
    `;
  }

  function animateStageTransition(stateKey) {
    if (stateKey === previousScreenStateKey) return;
    previousScreenStateKey = stateKey;
    stage.classList.remove('stage-morph');
    void stage.offsetWidth;
    stage.classList.add('stage-morph');
  }

  function updateTopAndHunt(s) {
    const liveTop3 = (s.leaderboardTop4 || []).slice(0, 3);
    const top3 = (s.round.top3 && s.round.top3.length ? s.round.top3 : liveTop3) || [];
    const previousMap = new Map(previousTop3.map((p, idx) => [p.sessionId, { player: p, index: idx }]));
    const hasAnyPlayers = top3.length > 0;
    const inGameplay = s.phase !== 'lobby' && s.phase !== 'finale';
    const showSidebar = inGameplay && hasAnyPlayers;
    document.body.classList.toggle('sidebar-empty', !showSidebar);
    if (!showSidebar) {
      top3El.innerHTML = '';
      previousTop3 = [];
      return;
    }
    const medals = ['🥇', '🥈', '🥉'];
    const placeClass = ['podium-first', 'podium-second', 'podium-third'];
    top3El.innerHTML = top3.map((p, idx) => {
      const prev = previousMap.get(p.sessionId);
      const isNew = !prev;
      const movedUp = prev && prev.index > idx;
      const pointsDelta = Number(p.pointsDelta || 0);
      const fromPoints = prev ? prev.player.points : 0;
      return `
        <div class="sidebar-podium-step ${placeClass[idx] || ''} ${isNew ? 'new-entry' : ''} ${movedUp ? 'rank-up' : ''}">
          <div class="sidebar-podium-medal">${medals[idx] || ''}</div>
          <div class="sidebar-podium-rank">#${idx + 1}</div>
          <div class="sidebar-podium-avatar">${renderAvatar(p.avatar, 'large')}</div>
          <div class="sidebar-podium-name">${escapeHtml(p.name)}</div>
          <div class="sidebar-podium-points">
            ${pointsDelta > 0 ? `<span class="points-badge">+${pointsDelta.toLocaleString('da-DK')}</span>` : ''}
            <span class="leaderboard-points" data-leaderboard-points data-target-points="${p.points}" data-from-points="${fromPoints}">${fromPoints.toLocaleString('da-DK')}</span>
            <small>point</small>
          </div>
        </div>`;
    }).join('');
    requestAnimationFrame(() => {
      document.querySelectorAll('[data-leaderboard-points]').forEach((el) => {
        const target = Number(el.dataset.targetPoints || 0);
        const from = Number(el.dataset.fromPoints || 0);
        if (from === target) {
          el.textContent = target.toLocaleString('da-DK');
          return;
        }
        const duration = 900;
        const start = performance.now();
        function step(now) {
          const t = Math.min(1, (now - start) / duration);
          const value = Math.round(from + (target - from) * t);
          el.textContent = value.toLocaleString('da-DK');
          if (t < 1) requestAnimationFrame(step);
        }
        requestAnimationFrame(step);
      });
    });
    previousTop3 = top3.map((p) => ({ sessionId: p.sessionId, points: p.points }));
  }

  function startTimer() {
    stopTimer();
    countdownSecondMarker = null;
    playedZeroGong = false;
    tick();
    timer = setInterval(tick, 200);
  }

  function stopTimer() {
    if (timer) clearInterval(timer);
    timer = null;
    const countdownValue = document.getElementById('questionCountdownValue');
    const countdownValueSecondary = document.getElementById('questionCountdownValueSecondary');
    const countdownFill = document.getElementById('questionCountdownFill');
    const questionHud = document.getElementById('questionHud');
    if (countdownValue) countdownValue.textContent = '';
    if (countdownValueSecondary) countdownValueSecondary.textContent = '';
    if (countdownFill) {
      countdownFill.style.transform = 'scaleX(1)';
      countdownFill.classList.remove('danger', 'warning');
    }
    if (questionHud) questionHud.classList.add('hidden');
  }

  function tick() {
    if (!phaseEndsAt) return;
    const countdownValue = document.getElementById('questionCountdownValue');
    const countdownValueSecondary = document.getElementById('questionCountdownValueSecondary');
    const countdownFill = document.getElementById('questionCountdownFill');
    const questionHud = document.getElementById('questionHud');
    if (!countdownValue || !countdownFill || !questionHud) return;
    questionHud.classList.remove('hidden');
    const remainingMs = Math.max(0, phaseEndsAt - Date.now());
    const sec = Math.max(0, Math.ceil(remainingMs / 1000));
    countdownValue.textContent = countdownValueSecondary ? `${sec}` : `${sec}s`;
    if (countdownValueSecondary) countdownValueSecondary.textContent = `${sec}s`;
    const ratio = currentQuestionDurationMs > 0 ? Math.max(0, Math.min(1, remainingMs / currentQuestionDurationMs)) : 1;
    countdownFill.style.transform = `scaleX(${ratio})`;
    countdownFill.classList.toggle('warning', sec <= 10 && sec > 5);
    countdownFill.classList.toggle('danger', sec <= 5);
    if (countdownSecondMarker !== sec) {
      countdownSecondMarker = sec;
      if (countdownValue.classList.contains('pre-question-count')) {
        countdownValue.classList.remove('count-pop');
        void countdownValue.offsetWidth;
        countdownValue.classList.add('count-pop');
      }
      const isQuestionTick = !countdownValue.classList.contains('pre-question-count');
      if (isQuestionTick && sec > 0 && sec <= 10 && !tickingPlaying) {
        tickingPlaying = true;
        playSound('tick');
      }
      if (sec === 0 && !playedZeroGong) {
        playedZeroGong = true;
        if (tickingPlaying) {
          stopSound('tick');
          tickingPlaying = false;
        }
        if (isQuestionTick) playSound('buzzer');
      }
    }
    if (sec <= 0) {
      questionHud.classList.add('hidden');
      stopTimer();
    }
  }

  function playDrumRoll() {
    playSound('drumroll');
  }

  function getAudioContext() {
    if (!audioContext) {
      audioContext = new (window.AudioContext || window.webkitAudioContext)();
    }
    if (audioContext.state === 'suspended') audioContext.resume();
    return audioContext;
  }

  function phaseText(phase) {
    return ({
      lobby: 'Lobby',
      pre_question: 'Nedtælling',
      question_open: 'Spørgsmål åbent',
      question_locked: 'Låst',
      answer_reveal: 'Afsløring',
      scoreboard: 'Top 3',
      finale: 'Finale',
    })[phase] || phase;
  }

  function shapeFor(shape) {
    return ({ triangle: '▲', diamond: '◆', circle: '●', square: '■' })[shape] || '●';
  }

  function labelList(question, optionIds) {
    if (!question || !optionIds?.length) return '';
    const map = new Map((question.options || []).map((opt) => [opt.id, opt.text]));
    return optionIds.map((id) => escapeHtml(map.get(id) || id)).join(', ');
  }

  function escapeHtml(value) {
    return String(value || '').replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[c]));
  }

  function escapeAttr(value) {
    return escapeHtml(value).replace(/"/g, '&quot;');
  }

  function renderAvatar(value, size) {
    const cls = size ? `avatar-mark ${size}` : 'avatar-mark';
    if (typeof value === 'string' && value.startsWith('/uploads/')) {
      return `<span class="${cls}"><img src="${escapeAttr(value)}" alt="avatar"></span>`;
    }
    return `<span class="${cls}">${escapeHtml(value || '🎉')}</span>`;
  }

  function renderFire(streak) {
    const count = Math.max(1, Math.min(3, Number(streak) || 1));
    return '🔥'.repeat(count);
  }

  function applyConfig(config) {
    if (!config) return;
    const hostText = document.getElementById('brandHostText');
    const celebrantText = document.getElementById('brandCelebrantText');
    const liveText = document.getElementById('liveLineText');
    if (hostText) hostText.textContent = config.hostBrandText || config.hostName || '';
    if (celebrantText) celebrantText.textContent = config.celebrantName || '';
    if (liveText) liveText.textContent = config.liveLine || '';
    document.title = `${config.quizTitle || 'Quiz'} - Screen`;
    document.documentElement.style.setProperty('--dynamic-bg-image', `url("${config.backgroundImageUrl || '/reference_code/Marius%20konf-17.png'}")`);
  }

  function renderCombinedResult(s, eyebrowText) {
    const q = s.question;
    if (!q) return;
    const correct = new Set(q.correctOptionIds || []);
    const top3 = s.round.top3 || [];
    const optionMap = new Map((q.options || []).map((o) => [o.id, o]));
    const mariusAnswer = s.round.mariusAnswer;
    const mariusOptionIds = mariusAnswer?.optionIds || [];
    const mariusOptions = mariusOptionIds.map((id) => optionMap.get(id)).filter(Boolean);
    const mariusIsCorrect = Boolean(s.round.mariusCorrect);
    const correctGuests = Number(s.round.correctGuests || 0);
    const incorrectGuests = Number(s.round.incorrectGuests || 0);
    const celebrant = escapeHtml(s.config?.celebrantName || 'Marius');
    const hasMedia = Boolean(q.revealImageUrl);
    stage.innerHTML = `
      <div class="score-stage ${hasMedia ? 'has-reveal' : ''}">
        <div class="eyebrow">${escapeHtml(eyebrowText)}</div>
        <h2 class="question-title result-title">${escapeHtml(q.prompt)}</h2>
        <div class="option-grid large-option-grid result-options-grid options-${q.options.length}">
          ${q.options.map((o) => `
            <div class="option-btn reveal-option ${correct.has(o.id) ? 'correct-answer' : 'muted-answer'}" style="background:${o.color}; cursor:default;">
              <span class="option-shape">${shapeFor(o.shape)}</span>
              ${o.imageUrl ? `<img class="option-image" src="${escapeAttr(o.imageUrl)}" alt="${escapeAttr(o.text)}">` : ''}
              <span class="option-text">${escapeHtml(o.text)} ${correct.has(o.id) ? '✓' : ''}</span>
            </div>
          `).join('')}
        </div>
        ${q.revealImageUrl ? `<div class="result-media-frame"><img class="question-image reveal-large-image" src="${q.revealImageUrl}" alt="Reveal billede"></div>` : ''}
        ${q.revealText ? `<p class="result-caption">${escapeHtml(q.revealText)}</p>` : ''}
      </div>
    `;
    renderSidebarRecap(s, 'reveal');
  }

  function renderSidebarRecap(s, mode) {
    const el = document.getElementById('sidebarRecap');
    if (!el) return;
    const celebrant = escapeHtml(s.config?.celebrantName || 'Marius');
    if (mode === 'live') {
      const guestsAnswered = Number(s.round.answersCount || 0);
      const guestsOnline = Number(s.connectedGuests || 0);
      const mariusReady = Boolean(s.round.mariusAnswered);
      el.innerHTML = `
        <div class="sidebar-recap-head">Status</div>
        <div class="sidebar-recap-card recap-online">
          <span class="sidebar-recap-icon">👥</span>
          <span class="sidebar-recap-value">${guestsOnline}</span>
          <span class="sidebar-recap-label">gæster online</span>
        </div>
        <div class="sidebar-recap-card recap-locked">
          <span class="sidebar-recap-icon">🔒</span>
          <span class="sidebar-recap-value">${guestsAnswered}</span>
          <span class="sidebar-recap-label">har svaret</span>
        </div>
        <div class="sidebar-recap-card recap-marius ${mariusReady ? 'is-ready' : 'is-waiting'}">
          <span class="sidebar-recap-icon">${mariusReady ? '✅' : '⌛'}</span>
          <span class="sidebar-recap-value-sm">${celebrant}</span>
          <span class="sidebar-recap-label ${mariusReady ? 'recap-good' : ''}">${mariusReady ? 'har svaret' : 'tænker stadig…'}</span>
        </div>
      `;
    } else if (mode === 'reveal') {
      const q = s.question;
      const optionMap = new Map((q?.options || []).map((o) => [o.id, o]));
      const mariusOptionIds = s.round.mariusAnswer?.optionIds || [];
      const mariusOptions = mariusOptionIds.map((id) => optionMap.get(id)).filter(Boolean);
      const mariusIsCorrect = Boolean(s.round.mariusCorrect);
      const correctGuests = Number(s.round.correctGuests || 0);
      const incorrectGuests = Number(s.round.incorrectGuests || 0);
      const mariusClass = mariusOptions.length ? (mariusIsCorrect ? 'is-correct' : 'is-wrong') : 'is-missing';
      el.innerHTML = `
        <div class="sidebar-recap-head">Resultat</div>
        <div class="sidebar-recap-card recap-correct">
          <span class="sidebar-recap-icon">✅</span>
          <span class="sidebar-recap-value">${correctGuests}</span>
          <span class="sidebar-recap-label">ramte rigtigt</span>
        </div>
        <div class="sidebar-recap-card recap-wrong">
          <span class="sidebar-recap-icon">❌</span>
          <span class="sidebar-recap-value">${incorrectGuests}</span>
          <span class="sidebar-recap-label">ramte forkert</span>
        </div>
        <div class="sidebar-recap-card recap-marius ${mariusClass}">
          <span class="sidebar-recap-icon">${mariusOptions.length ? (mariusIsCorrect ? '🎉' : '😅') : '⏳'}</span>
          <div class="sidebar-recap-marius">
            <span class="sidebar-recap-marius-heading">${celebrant} svarede</span>
            <div class="sidebar-recap-marius-options">
              ${mariusOptions.length
                ? mariusOptions.map((o) => `
                    <span class="recap-marius-chip" style="--chip-color:${o.color};">
                      <span class="recap-marius-shape">${shapeFor(o.shape)}</span>
                      <span>${escapeHtml(o.text)}</span>
                    </span>
                  `).join('')
                : `<span class="recap-marius-empty">Nåede ikke at svare</span>`}
            </div>
            ${mariusOptions.length ? `<span class="sidebar-recap-label ${mariusIsCorrect ? 'recap-good' : 'recap-bad'}">${mariusIsCorrect ? 'Rigtigt svar ✨' : 'Forkert'}</span>` : ''}
          </div>
        </div>
      `;
    } else {
      el.innerHTML = '';
    }
  }

  function renderMariusAnswerEmoji(question, optionIds) {
    if (!question || !optionIds.length) return '';
    const shapeMap = new Map((question.options || []).map((opt) => [opt.id, shapeFor(opt.shape)]));
    return optionIds.map((id) => shapeMap.get(id) || '●').join(' ');
  }

  function fireConfetti() {
    const colors = ['#ff4fa1', '#4d7de2', '#ffc94a', '#9ed8ff'];
    for (let i = 0; i < 70; i += 1) {
      const el = document.createElement('div');
      el.className = 'confetti-piece';
      el.style.left = `${Math.random() * 100}vw`;
      el.style.background = colors[i % colors.length];
      el.style.animationDelay = `${Math.random() * 0.8}s`;
      el.style.animationDuration = `${3 + Math.random() * 1.8}s`;
      document.body.appendChild(el);
      setTimeout(() => el.remove(), 5500);
    }
  }
})();

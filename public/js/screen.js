(() => {
  const socket = io();
  const stage = document.getElementById('stage');
  const countdownPill = document.getElementById('countdownPill');
  const top3El = document.getElementById('top3');
  const huntEl = document.getElementById('hunt');
  const titleEl = document.getElementById('title');
  const subTitleEl = document.getElementById('subTitle');
  let phaseEndsAt = null;
  let timer = null;
  let drumStarted = false;

  socket.emit('hello', { as: 'screen' });
  socket.on('state', render);
  socket.on('guest:ready', () => {
    // Keep event for future effects.
  });

  function render(s) {
    titleEl.textContent = s.title || 'Nanna STORE Quiz til Marius';
    subTitleEl.textContent = `Spørgsmål ${s.questionIndex || 0}/${s.totalQuestions || s.selectedQuestionCount || 0} - fase: ${phaseText(s.phase)}`;
    phaseEndsAt = s.phaseEndsAt;
    updateTopAndHunt(s);
    if (s.phase === 'question_open') startTimer();
    else stopTimer();

    if (s.phase === 'lobby') return renderLobby(s);
    if (s.phase === 'question_open') return renderQuestion(s);
    if (s.phase === 'question_locked') return renderLocked(s);
    if (s.phase === 'answer_reveal') return renderReveal(s);
    if (s.phase === 'scoreboard') return renderScoreboard(s);
    return renderFinale(s);
  }

  async function renderLobby(s) {
    drumStarted = false;
    const qr = await fetch('/api/qr').then((r) => r.json()).catch(() => null);
    stage.innerHTML = `
      <div class="lobby-grid">
        <div>
          ${qr ? `<img alt="QR kode" src="${qr.dataUrl}" style="width:100%; border-radius:12px;">` : ''}
          <p class="muted">${qr ? qr.url : '/play'}</p>
        </div>
        <div>
          <h2>Velkommen</h2>
          <p>Scan QR-koden og join quizzen. Host kan se alle i realtid.</p>
          <p><strong>${s.connectedGuests}</strong> er klar.</p>
          <div class="ready-list">
            ${(s.knownGuests || []).map((p) => `<span class="ready-pill">${escapeHtml(p.avatar || '🎉')} ${escapeHtml(p.name)}</span>`).join('')}
          </div>
        </div>
      </div>
    `;
  }

  function renderQuestion(s) {
    const q = s.question;
    if (!q) return;
    stage.innerHTML = `
      <h2>${escapeHtml(q.prompt)}</h2>
      ${q.questionImageUrl ? `<img class="question-image" src="${q.questionImageUrl}" alt="Spørgsmålsbillede">` : ''}
      <div class="option-grid">
        ${q.options.map((o) => `
          <div class="option-btn" style="background:${o.color}; cursor:default;">
            ${shapeFor(o.shape)} ${escapeHtml(o.text)}
          </div>
        `).join('')}
      </div>
      <p class="muted">${s.round.answersCount} gæster har svaret${s.round.mariusAnswered ? ' · Marius har også svaret' : ''}</p>
    `;
  }

  function renderLocked(s) {
    stage.innerHTML = `
      <h2>Spørgsmålet er låst</h2>
      <p>${s.round.answersCount} gæster nåede at svare.</p>
      <p>${s.round.mariusAnswered ? 'Marius er klar ✅' : 'Marius mangler stadig svar'}</p>
      <p class="muted">Host afslører svaret om lidt.</p>
    `;
  }

  function renderReveal(s) {
    const q = s.question;
    if (!q) return;
    const correct = new Set(q.correctOptionIds || []);
    const mariusAnswer = s.round.mariusAnswer?.optionIds || [];
    stage.innerHTML = `
      <h2>Rigtigt svar</h2>
      <div class="option-grid">
        ${q.options.map((o) => `
          <div class="option-btn" style="background:${correct.has(o.id) ? '#169f75' : '#8f95a5'}; cursor:default;">
            ${shapeFor(o.shape)} ${escapeHtml(o.text)} ${correct.has(o.id) ? '✓' : ''}
          </div>
        `).join('')}
      </div>
      ${q.revealImageUrl ? `<img class="question-image" src="${q.revealImageUrl}" alt="Reveal billede">` : ''}
      ${q.revealText ? `<p>${escapeHtml(q.revealText)}</p>` : ''}
      <p><strong>Marius svarede:</strong> ${mariusAnswer.length ? mariusAnswer.join(', ') : 'Intet svar'}</p>
    `;
  }

  function renderScoreboard(s) {
    stage.innerHTML = `
      <h2>Top 3 lige nu</h2>
      <div class="top-grid">
        ${(s.round.top3 || []).map((p, idx) => `
          <div class="rank-card">
            <strong>#${idx + 1} ${escapeHtml(p.avatar || '🎉')} ${escapeHtml(p.name)}</strong>
            <div>${p.points} point</div>
          </div>
        `).join('')}
      </div>
      <p class="muted">I jagten: ${(s.round.huntPlayers || []).map((p) => escapeHtml(p.name)).join(', ') || 'Ingen endnu'}</p>
    `;
  }

  function renderFinale(s) {
    if (!drumStarted) {
      drumStarted = true;
      playDrumRoll();
    }
    stage.innerHTML = `
      <h2>Finale - Nanna STORE Quiz til Marius</h2>
      <p>🥁 Trommehvirvel...</p>
      <div class="top-grid">
        ${(s.finalTop4 || []).map((p, idx) => `
          <div class="rank-card">
            <strong>${idx + 1}. plads</strong>
            <div>${escapeHtml(p.avatar || '🎉')} ${escapeHtml(p.name)}</div>
            <div>${p.points} point</div>
          </div>
        `).join('')}
      </div>
      <p><strong>Dagens hovedperson: Marius 👑</strong></p>
    `;
  }

  function updateTopAndHunt(s) {
    top3El.innerHTML = (s.round.top3 || []).map((p, idx) => `
      <div class="rank-card"><strong>#${idx + 1}</strong><div>${escapeHtml(p.avatar || '🎉')} ${escapeHtml(p.name)}</div><div>${p.points}</div></div>
    `).join('');
    huntEl.innerHTML = (s.round.huntPlayers || []).map((p) =>
      `<span class="hunt-chip">${escapeHtml(p.name)} (${p.points})</span>`
    ).join('');
  }

  function startTimer() {
    stopTimer();
    tick();
    timer = setInterval(tick, 200);
  }

  function stopTimer() {
    if (timer) clearInterval(timer);
    timer = null;
    countdownPill.textContent = '--';
  }

  function tick() {
    if (!phaseEndsAt) return;
    const sec = Math.max(0, Math.ceil((phaseEndsAt - Date.now()) / 1000));
    countdownPill.textContent = `${sec}s`;
    if (sec <= 0) stopTimer();
  }

  function playDrumRoll() {
    try {
      const context = new (window.AudioContext || window.webkitAudioContext)();
      const now = context.currentTime;
      for (let i = 0; i < 12; i += 1) {
        const osc = context.createOscillator();
        const gain = context.createGain();
        osc.type = 'square';
        osc.frequency.value = 90 + i * 6;
        gain.gain.value = 0.001;
        osc.connect(gain).connect(context.destination);
        const t = now + i * 0.09;
        gain.gain.exponentialRampToValueAtTime(0.08, t + 0.01);
        gain.gain.exponentialRampToValueAtTime(0.001, t + 0.08);
        osc.start(t);
        osc.stop(t + 0.09);
      }
    } catch (_e) {
      // Ignore if autoplay policy blocks audio.
    }
  }

  function phaseText(phase) {
    return ({
      lobby: 'Lobby',
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

  function escapeHtml(value) {
    return String(value || '').replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[c]));
  }
})();

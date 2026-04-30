(() => {
  const socket = io();
  let pin = sessionStorage.getItem('hostPin') || '';
  let questionBank = [];
  let selectedRoundIndex = 0;
  const $ = (id) => document.getElementById(id);

  if (pin) tryLogin(pin);
  $('loginBtn').onclick = () => tryLogin($('hostPin').value.trim());
  $('hostPin').addEventListener('keydown', (e) => { if (e.key === 'Enter') tryLogin($('hostPin').value.trim()); });

  function tryLogin(p) {
    pin = p;
    socket.emit('hello', { as: 'host', pin });
  }

  socket.on('connect', () => {
    if (pin) tryLogin(pin);
  });

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && pin) {
      tryLogin(pin);
    }
  });

  socket.on('auth-error', ({ message }) => {
    pin = '';
    sessionStorage.removeItem('hostPin');
    showNotice(message || 'Login mislykkedes', 'bad');
    $('loginCard').style.display = '';
    $('panel').style.display = 'none';
  });

  socket.on('state', (s) => {
    sessionStorage.setItem('hostPin', pin);
    $('loginCard').style.display = 'none';
    $('panel').style.display = 'flex';
    questionBank = s.questionBank || [];
    render(s);
  });

  socket.on('host:set-correct:result', (r) => {
    if (!r.ok) showNotice(r.error || 'Kunne ikke sætte facit', 'bad');
    else showNotice('Facit + Emils gæt vises nu på skærmen', 'good');
  });

  socket.on('host:reveal:result', (r) => {
    if (!r.ok) showNotice(r.error || 'Kunne ikke afsløre', 'bad');
    else showNotice('Resultat afsløret!', 'good');
  });

  socket.on('host:update-question:result', (r) => {
    if (!r.ok) showNotice(r.error || 'Kunne ikke gemme runde', 'bad');
    else showNotice('Runde-indstillinger gemt ✅', 'good');
  });

  function render(s) {
    window.__hostQuestion = s.question || null;
    $('phasePill').textContent = phaseLabel(s.round.phase);
    $('roundLabel').textContent = s.currentRoundIndex < 0 ? 'ikke startet' : `${s.currentRoundIndex + 1} / ${s.totalRounds}`;
    $('qLabel').textContent = s.question ? s.question.question : '—';
    $('rewardLabel').textContent = s.question ? `${s.question.reward} stk. (${s.question.unit})` : '—';
    $('minMaxLabel').textContent = s.question && (s.question.min != null || s.question.max != null)
      ? `${s.question.min ?? '?'} – ${s.question.max ?? '?'} ${s.question.unit}`
      : '—';
    if (s.question) {
      if (s.question.min != null) $('correctInput').min = s.question.min;
      if (s.question.max != null) $('correctInput').max = s.question.max;
    }
    $('emilLockLabel').textContent = s.round.emilAnswer !== null ? `Ja — svarede ${s.round.emilAnswer}` : 'Nej';
    $('guestCountLabel').textContent = s.round.guestCount;
    $('emilScore').textContent = s.emilCandy;
    $('guestScore').textContent = s.guestsCandy;

    const phase = s.round.phase;
    const gameNotStarted = phase === 'idle' && s.currentRoundIndex < 0;

    // Big START button only visible before game starts
    $('btnStartGame').style.display = gameNotStarted ? '' : 'none';

    // Normal "Vis spørgsmål" button hidden during the very first start (handled by btnStartGame)
    $('btnShow').style.display = gameNotStarted ? 'none' : '';
    $('btnShow').disabled = !(phase === 'reveal' || phase === 'gameover');
    $('btnShow').textContent = phase === 'gameover' ? 'Genstart' : 'Vis næste spørgsmål';

    $('btnClose').disabled = phase !== 'question';
    $('btnSetCorrect').disabled = !(phase === 'question' || phase === 'closed');
    $('btnReveal').disabled = phase !== 'answer';
    $('btnNext').disabled = phase !== 'reveal';
    const overrideOn = phase === 'reveal';
    ['btnOverrideEmil','btnOverrideGuests','btnOverrideTie'].forEach((id) => $(id).disabled = !overrideOn);

    const list = $('guestList');
    if (!s.round.guestAnswers.length) {
      list.innerHTML = '<li><span class="name">Ingen endnu</span><span class="val">—</span></li>';
    } else {
      list.innerHTML = s.round.guestAnswers
        .slice()
        .sort((a, b) => (a.value - b.value))
        .map((g) => `<li><span class="name">${escapeHtml(g.avatar || '🙂')} ${escapeHtml(g.name)}</span><span class="val">${formatNum(g.value)}</span></li>`)
        .join('');
    }

    renderQuestionEditor();
  }

  function renderQuestionEditor() {
    const select = $('editRoundSelect');
    if (!select) return;

    if (!select.dataset.initialized) {
      select.onchange = () => {
        selectedRoundIndex = Number(select.value);
        fillEditorFromSelection();
      };
      select.dataset.initialized = '1';
    }

    const previousValue = String(selectedRoundIndex);
    select.innerHTML = questionBank.map((q, idx) =>
      `<option value="${idx}">${escapeHtml(q.title || `Runde ${idx + 1}`)}</option>`
    ).join('');

    if (questionBank.length) {
      if (previousValue && questionBank[Number(previousValue)]) {
        select.value = previousValue;
        selectedRoundIndex = Number(previousValue);
      } else if (window.__hostQuestion) {
        const currentIdx = questionBank.findIndex((q) => q.id === window.__hostQuestion.id);
        selectedRoundIndex = currentIdx >= 0 ? currentIdx : 0;
        select.value = String(selectedRoundIndex);
      } else {
        selectedRoundIndex = 0;
        select.value = '0';
      }
      fillEditorFromSelection();
    }
  }

  function fillEditorFromSelection() {
    const q = questionBank[selectedRoundIndex];
    if (!q) return;
    $('editTitle').value = q.title ?? '';
    $('editQuestion').value = q.question ?? '';
    $('editUnit').value = q.unit ?? '';
    $('editMin').value = q.min ?? '';
    $('editMax').value = q.max ?? '';
    $('editReward').value = q.reward ?? '';
    $('editLockSeconds').value = q.lockSeconds ?? '';
    $('editHint').value = q.hint ?? '';
  }

  $('btnStartGame').onclick = () => socket.emit('host:show-question', { pin });
  $('btnShow').onclick = () => socket.emit('host:show-question', { pin });
  $('btnClose').onclick = () => socket.emit('host:close', { pin });
  $('btnSetCorrect').onclick = () => {
    const q = window.__hostQuestion || null;
    const v = parseRoundInt($('correctInput').value, q, 'facit');
    if (v === null) return;
    socket.emit('host:set-correct', { pin, correctAnswer: v });
  };
  $('btnReveal').onclick = () => socket.emit('host:reveal', { pin });
  $('btnNext').onclick = () => {
    socket.emit('host:next', { pin });
    $('correctInput').value = '';
  };
  $('btnReset').onclick = () => {
    if (confirm('Vil du virkelig nulstille hele spillet? Score, runde og historik nulstilles.')) {
      socket.emit('host:reset', { pin });
    }
  };
  $('btnOverrideEmil').onclick   = () => socket.emit('host:override-winner', { pin, winner: 'emil' });
  $('btnOverrideGuests').onclick = () => socket.emit('host:override-winner', { pin, winner: 'guests' });
  $('btnOverrideTie').onclick    = () => socket.emit('host:override-winner', { pin, winner: 'tie' });
  $('btnSaveQuestion').onclick = () => {
    const roundIndex = Number($('editRoundSelect').value);
    const question = {
      title: $('editTitle').value.trim(),
      question: $('editQuestion').value.trim(),
      unit: $('editUnit').value.trim(),
      min: Number($('editMin').value),
      max: Number($('editMax').value),
      reward: Number($('editReward').value),
      lockSeconds: Number($('editLockSeconds').value),
      hint: $('editHint').value.trim(),
    };
    socket.emit('host:update-question', { pin, roundIndex, question });
  };

  function showNotice(msg, kind) {
    const n = $('notice');
    n.textContent = msg;
    n.className = 'notice ' + (kind || '');
    n.style.display = '';
    clearTimeout(showNotice._t);
    showNotice._t = setTimeout(() => { n.style.display = 'none'; }, 3500);
  }
  function parseRoundInt(raw, q, label) {
    const v = Number(raw);
    if (!Number.isFinite(v)) {
      showNotice(`Indtast et helt tal som ${label}`, 'bad');
      return null;
    }
    if (!Number.isInteger(v)) {
      showNotice(`${label[0].toUpperCase() + label.slice(1)} skal være et helt tal`, 'bad');
      return null;
    }
    if (q && q.min != null && v < q.min) {
      showNotice(`${label[0].toUpperCase() + label.slice(1)} skal være mindst ${q.min}`, 'bad');
      return null;
    }
    if (q && q.max != null && v > q.max) {
      showNotice(`${label[0].toUpperCase() + label.slice(1)} skal være højst ${q.max}`, 'bad');
      return null;
    }
    return v;
  }

  function phaseLabel(p) {
    return ({
      idle: 'venter', question: 'gætter (Emil + gæster)',
      closed: 'lukket', answer: 'svar vist', reveal: 'afsløring',
      gameover: 'spil slut'
    })[p] || p;
  }
  function escapeHtml(s) {
    return String(s ?? '').replace(/[&<>"']/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  }
  function formatNum(n) {
    if (n == null) return '—';
    return Number.isInteger(n) ? n : Number(n).toLocaleString('da-DK', { maximumFractionDigits: 2 });
  }
})();

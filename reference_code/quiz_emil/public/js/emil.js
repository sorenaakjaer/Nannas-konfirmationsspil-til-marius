(() => {
  const socket = io();
  let pin = sessionStorage.getItem('emilPin') || '';
  let phaseEndsAt = null;
  let lockSeconds = null;
  let countdownTimer = null;
  let autoLockedThisRound = false;
  let lastRoundIndex = -2;
  let currentQuestion = null;
  const $ = (id) => document.getElementById(id);

  if (pin) login(pin);
  $('loginBtn').onclick = () => login($('emilPin').value.trim());
  $('emilPin').addEventListener('keydown', (e) => { if (e.key === 'Enter') login($('emilPin').value.trim()); });

  function login(p) {
    pin = p;
    socket.emit('hello', { as: 'emil', pin });
  }

  socket.on('connect', () => {
    if (pin) login(pin);
  });

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && pin) {
      login(pin);
    }
  });

  socket.on('auth-error', ({ message }) => {
    pin = '';
    sessionStorage.removeItem('emilPin');
    showNotice(message || 'Forkert PIN', 'bad');
    $('loginCard').style.display = '';
    $('panel').style.display = 'none';
  });

  socket.on('state', (s) => {
    sessionStorage.setItem('emilPin', pin);
    $('loginCard').style.display = 'none';
    $('panel').style.display = 'flex';
    render(s);
  });

  socket.on('emil:lock:result', (r) => {
    if (!r.ok) showNotice(r.error || 'Kunne ikke låse', 'bad');
    else showNotice('Dit svar er låst 🔒', 'good');
  });

  function render(s) {
    const phase = s.round.phase;
    currentQuestion = s.question;
    $('phasePill').textContent = phaseLabel(phase);

    if (s.currentRoundIndex !== lastRoundIndex) {
      lastRoundIndex = s.currentRoundIndex;
      autoLockedThisRound = false;
      $('answerInput').value = '';
    }

    if (s.question) {
      $('qTitle').textContent = s.question.title + ' · 🍫 ' + s.question.reward + ' stk.';
      $('qText').textContent = s.question.question;
      if (s.question.min != null || s.question.max != null) {
        $('qRange').style.display = '';
        $('qRange').innerHTML = `Realistisk gæt: <strong>${s.question.min ?? '?'}</strong> – <strong>${s.question.max ?? '?'}</strong> ${escapeHtml(s.question.unit)}`;
        if (s.question.min != null) $('answerInput').min = s.question.min;
        if (s.question.max != null) $('answerInput').max = s.question.max;
      } else {
        $('qRange').style.display = 'none';
      }
      $('qHint').textContent = s.question.hint || '';
    } else {
      $('qTitle').textContent = phase === 'gameover' ? 'Spillet er slut' : 'Venter på næste runde...';
      $('qText').textContent = '';
      $('qRange').style.display = 'none';
      $('qHint').textContent = '';
    }

    const showAnswerForm = phase === 'question' && s.round.emilAnswer === null;
    const showLocked = (phase === 'question' || phase === 'closed' || phase === 'answer') && s.round.emilAnswer !== null;
    const showResult = phase === 'reveal' || phase === 'gameover';

    $('answerCard').style.display = showAnswerForm ? '' : 'none';
    $('lockedCard').style.display = showLocked ? '' : 'none';
    $('resultCard').style.display = showResult ? '' : 'none';

    if (showLocked) $('myAnswer').textContent = formatNum(s.round.emilAnswer);

    // Manage countdown
    phaseEndsAt = s.round.phaseEndsAt;
    lockSeconds = s.round.lockSeconds;
    if (phase === 'question' && phaseEndsAt && !s.round.emilAnswer) {
      startCountdown();
    } else {
      stopCountdown();
    }

    if (phase === 'gameover') {
      const winner = s.emilCandy > s.guestsCandy ? 'emil' : s.emilCandy < s.guestsCandy ? 'guests' : 'tie';
      $('resultCard').querySelector('h2').textContent = 'Den endelige vinder';
      $('rCorrect').textContent = winner === 'emil' ? 'Emil 🏆' : winner === 'guests' ? 'Gæsterne 🎉' : 'Uafgjort';
      $('rEmil').textContent = s.emilCandy;
      $('rGuests').textContent = s.guestsCandy;
      $('rWinner').textContent = 'Tak for at I spillede med';
      $('rWinner').style.color = 'var(--text)';
      return;
    }

    if (showResult) {
      $('rCorrect').textContent = formatNum(s.round.correctAnswer);
      $('rEmil').textContent = formatNum(s.round.emilAnswer);
      $('rGuests').textContent = s.round.stats ? formatNum(s.round.stats.avg) : '—';
      const w = s.round.winner;
      $('rWinner').textContent = w === 'emil' ? 'DU VINDER 🏆' : w === 'guests' ? 'Gæsterne vandt 😱' : 'Uafgjort';
      $('rWinner').style.color = w === 'emil' ? 'var(--good)' : w === 'guests' ? 'var(--bad)' : 'var(--text)';
    }
  }

  function startCountdown() {
    if (countdownTimer) clearInterval(countdownTimer);
    tickCountdown();
    countdownTimer = setInterval(tickCountdown, 200);
  }
  function stopCountdown() {
    if (countdownTimer) { clearInterval(countdownTimer); countdownTimer = null; }
    const cd = $('countdownEmil');
    if (cd) cd.classList.remove('urgent');
  }
  function tickCountdown() {
    const cd = $('countdownEmil');
    if (!cd || !phaseEndsAt) return;
    const remaining = Math.max(0, Math.ceil((phaseEndsAt - Date.now()) / 1000));
    cd.querySelector('.cd-value').textContent = remaining + 's';
    cd.classList.toggle('urgent', remaining <= 10);
    if (remaining <= 0) {
      stopCountdown();
      autoLock();
    }
  }
  function autoLock() {
    if (autoLockedThisRound) return;
    autoLockedThisRound = true;
    const v = parseRoundInt($('answerInput').value, currentQuestion, 'svar');
    if (v !== null) {
      socket.emit('emil:lock', { value: v, pin });
      showNotice(`Tiden er gået — låst på ${v}`, 'good');
    } else {
      showNotice('Tiden er gået — du indtastede ikke noget!', 'bad');
    }
  }

  $('lockBtn').onclick = () => {
    const v = parseRoundInt($('answerInput').value, currentQuestion, 'svar');
    if (v === null) return;
    socket.emit('emil:lock', { value: v, pin });
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
    return ({ idle:'venter', question:'gæt nu!', closed:'lukket', answer:'svar vist', reveal:'afsløring', gameover:'spil slut' })[p] || p;
  }
  function escapeHtml(s) {
    return String(s ?? '').replace(/[&<>"']/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  }
  function formatNum(n) {
    if (n == null) return '—';
    return Number.isInteger(n) ? n : Number(n).toLocaleString('da-DK', { maximumFractionDigits: 2 });
  }
})();

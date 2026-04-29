(() => {
  const socket = io();
  const $ = (id) => document.getElementById(id);

  const AVATARS = [
    '🐶','🐱','🐰','🦊','🐻','🐼','🐨','🦁','🐵','🐸',
    '🦄','🐴','🐧','🦉','🦋','🐝','🐢','🐳','🦖','🐙',
    '🦀','🌟','⚡','🔥','🌈','🍕','🍔','🍩','🎮','🎸',
    '🎨','🎯','⚽','🏀','🚀','🛸','👻','🤖','👑','🎩'
  ];

  let sessionId = localStorage.getItem('amE_sessionId');
  if (!sessionId) {
    sessionId = 'g_' + Math.random().toString(36).slice(2) + Date.now().toString(36);
    localStorage.setItem('amE_sessionId', sessionId);
  }
  let myName = localStorage.getItem('amE_name') || '';
  let myAvatar = localStorage.getItem('amE_avatar') || AVATARS[Math.floor(Math.random() * AVATARS.length)];
  let myGuess = null;
  let lastRoundIndex = -2;
  let editingIdentity = !myName;
  let phaseEndsAt = null;
  let countdownTimer = null;
  let currentQuestion = null;

  buildAvatarGrid();
  refreshIdentityUI();

  function announcePlayPresence() {
    socket.emit('hello', { as: 'play' });
    if (myName) {
      socket.emit('guest:identity', { sessionId, name: myName, avatar: myAvatar });
      if (myGuess !== null) {
        socket.emit('guest:submit', { sessionId, name: myName, avatar: myAvatar, value: myGuess });
      }
    }
  }

  socket.on('connect', announcePlayPresence);
  announcePlayPresence();

  // When iPhone/Android wakes from lock screen, proactively refresh presence/state.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      announcePlayPresence();
    }
  });

  function buildAvatarGrid() {
    const grid = $('avatarGrid');
    grid.innerHTML = AVATARS.map((a) =>
      `<button type="button" class="avatar-cell ${a === myAvatar ? 'selected' : ''}" data-a="${a}">${a}</button>`
    ).join('');
    grid.querySelectorAll('.avatar-cell').forEach((btn) => {
      btn.onclick = () => {
        myAvatar = btn.dataset.a;
        grid.querySelectorAll('.avatar-cell').forEach((b) => b.classList.toggle('selected', b === btn));
        const preview = $('pickedAvatarEmoji');
        if (preview) preview.textContent = myAvatar;
      };
    });
    const preview = $('pickedAvatarEmoji');
    if (preview) preview.textContent = myAvatar;
  }

  function refreshIdentityUI() {
    if (myName && !editingIdentity) {
      $('identityCard').style.display = 'none';
      $('identityBar').style.display = '';
      $('iAvatar').textContent = myAvatar;
      $('iName').textContent = myName;
    } else {
      $('identityCard').style.display = '';
      $('identityBar').style.display = 'none';
      $('identityTitle').textContent = myName ? 'Ret dit navn / avatar' : 'Hvad hedder du?';
      $('cancelIdentityBtn').style.display = myName ? '' : 'none';
      $('nameInput').value = myName;
      const preview = $('pickedAvatarEmoji');
      if (preview) preview.textContent = myAvatar;
      // Don't auto-focus on iOS — it pops up the keyboard immediately,
      // hides the avatar grid below, and confuses people. Let user tap when ready.
    }
  }

  $('saveIdentityBtn').onclick = () => {
    const v = ($('nameInput').value || '').trim();
    if (!v) return showNotice('Skriv et navn — eller vælg "Spil anonymt"', 'bad');
    saveIdentity(v.slice(0, 24), myAvatar);
  };

  $('anonymousBtn').onclick = () => {
    saveIdentity('Ukendt', '🎭');
    showNotice('Du spiller som "Ukendt" 🎭', 'good');
  };

  function saveIdentity(name, avatar) {
    myName = name;
    myAvatar = avatar;
    localStorage.setItem('amE_name', myName);
    localStorage.setItem('amE_avatar', myAvatar);
    editingIdentity = false;
    refreshIdentityUI();
    socket.emit('guest:identity', { sessionId, name: myName, avatar: myAvatar });
    if (myGuess !== null) {
      socket.emit('guest:submit', { sessionId, name: myName, avatar: myAvatar, value: myGuess });
    }
  }

  $('cancelIdentityBtn').onclick = () => {
    editingIdentity = false;
    refreshIdentityUI();
  };

  $('editIdentityBtn').onclick = () => {
    editingIdentity = true;
    refreshIdentityUI();
  };

  $('submitBtn').onclick = sendGuess;
  $('guessInput').addEventListener('keydown', (e) => { if (e.key === 'Enter') sendGuess(); });
  $('changeBtn').onclick = () => {
    $('submittedCard').style.display = 'none';
    $('answerCard').style.display = '';
    if (myGuess !== null) $('guessInput').value = myGuess;
    $('guessInput').focus();
  };

  function sendGuess() {
    if (!myName) {
      // No identity yet — auto-default to Ukendt so they don't lose their guess
      myName = 'Ukendt';
      myAvatar = '🎭';
      localStorage.setItem('amE_name', myName);
      localStorage.setItem('amE_avatar', myAvatar);
      editingIdentity = false;
      refreshIdentityUI();
    }
    const v = parseRoundInt($('guessInput').value, currentQuestion, 'gæt');
    if (v === null) return;
    socket.emit('guest:submit', { sessionId, name: myName, avatar: myAvatar, value: v });
    myGuess = v;
  }

  socket.on('guest:submit:result', (r) => {
    if (!r.ok) return showNotice(r.error || 'Fejl', 'bad');
    showNotice('Sendt! ✅', 'good');
  });

  socket.on('state', render);

  function render(s) {
    const phase = s.round.phase;
    const q = s.question;
    currentQuestion = q;

    if (s.currentRoundIndex !== lastRoundIndex) {
      lastRoundIndex = s.currentRoundIndex;
      myGuess = null;
      $('guessInput').value = '';
    }

    ['waitCard','answerCard','submittedCard','resultCard','gameoverCard'].forEach((id) => $(id).style.display = 'none');

    phaseEndsAt = s.round.phaseEndsAt;

    if (phase === 'gameover') {
      stopCountdown();
      $('gameoverCard').style.display = '';
      const winner = s.emilCandy > s.guestsCandy ? 'emil' : s.emilCandy < s.guestsCandy ? 'guests' : 'tie';
      $('gameoverCard').innerHTML = `
        <h2>Den endelige vinder er i dag ${winner === 'emil' ? 'Emil' : winner === 'guests' ? 'Gæsterne' : 'ingen - det er uafgjort'} 🏁</h2>
        <div class="kv" style="margin-top:1rem;">
          <span class="k">Emil</span><span class="v" style="color: var(--emil)">${s.emilCandy}</span>
          <span class="k">Gæsterne</span><span class="v" style="color: var(--guests)">${s.guestsCandy}</span>
        </div>
        <p style="margin-top:1.2rem;">Tak for at I spillede med.</p>
      `;
      return;
    }

    if (phase === 'question' && q) {
      $('aRound').textContent = (s.currentRoundIndex + 1) + ' / ' + s.totalRounds;
      $('aQuestion').textContent = q.question;
      $('aHint').textContent = q.hint || '';
      $('aUnit').textContent = q.unit;
      $('aReward').textContent = q.reward;

      if (q.min != null || q.max != null) {
        $('aRange').style.display = '';
        $('aRange').innerHTML = `Realistisk gæt: <strong>${q.min ?? '?'}</strong> – <strong>${q.max ?? '?'}</strong> ${escapeHtml(q.unit)}`;
        if (q.min != null) $('guessInput').min = q.min;
        if (q.max != null) $('guessInput').max = q.max;
      } else {
        $('aRange').style.display = 'none';
      }

      if (myGuess !== null) {
        $('submittedCard').style.display = '';
        $('myGuess').textContent = formatNum(myGuess);
        stopCountdown();
      } else {
        $('answerCard').style.display = '';
        startCountdown();
      }
      return;
    }

    stopCountdown();

    if (phase === 'reveal' && q) {
      $('resultCard').style.display = '';
      $('rCorrect').textContent = formatNum(s.round.correctAnswer) + ' ' + q.unit;
      $('rMine').textContent = myGuess !== null ? formatNum(myGuess) : '— (du gættede ikke)';
      $('rEmil').textContent = formatNum(s.round.emilAnswer);
      $('rGuests').textContent = s.round.stats ? formatNum(s.round.stats.avg) : '—';
      const w = s.round.winner;
      const line = $('winnerLine');
      if (w === 'emil') { line.textContent = 'Emil vandt 😱'; line.style.color = 'var(--emil)'; }
      else if (w === 'guests') { line.textContent = 'GÆSTERNE VANDT 🎉'; line.style.color = 'var(--guests)'; }
      else { line.textContent = 'Uafgjort'; line.style.color = 'var(--text)'; }
      return;
    }

    $('waitCard').style.display = '';
    $('waitPhase').textContent = phaseLabel(phase);
    if (phase === 'idle') {
      $('waitTitle').textContent = 'Klar når du er klar 🎬';
      $('waitText').textContent = 'Spillet starter snart.';
    } else if (phase === 'closed') {
      $('waitTitle').textContent = 'Tiden er gået 🔒';
      $('waitText').textContent = 'Værten finder facit nu...';
    } else if (phase === 'answer') {
      $('waitTitle').textContent = 'Svaret er fundet! 🥁';
      $('waitText').textContent = q ? `Facit: ${formatNum(s.round.correctAnswer)} ${q.unit} · Emil gættede ${formatNum(s.round.emilAnswer)}` : '';
    }
  }

  function startCountdown() {
    if (countdownTimer) clearInterval(countdownTimer);
    tickCountdown();
    countdownTimer = setInterval(tickCountdown, 200);
  }
  function stopCountdown() {
    if (countdownTimer) { clearInterval(countdownTimer); countdownTimer = null; }
    const cd = $('countdownGuest');
    if (cd) cd.classList.remove('urgent');
  }
  function tickCountdown() {
    const cd = $('countdownGuest');
    if (!cd || !phaseEndsAt) return;
    const remaining = Math.max(0, Math.ceil((phaseEndsAt - Date.now()) / 1000));
    cd.querySelector('.cd-value').textContent = remaining + 's';
    cd.classList.toggle('urgent', remaining <= 10);
    if (remaining <= 0) {
      stopCountdown();
      // Auto-submit whatever's in the field if not yet sent
      const v = parseRoundInt($('guessInput').value, currentQuestion, 'gæt');
      if (v !== null && myGuess === null) {
        sendGuess();
        showNotice('Tiden er gået — sendte dit gæt', 'good');
      }
    }
  }

  function showNotice(msg, kind) {
    const n = $('notice');
    n.textContent = msg;
    n.className = 'notice ' + (kind || '');
    n.style.display = '';
    clearTimeout(showNotice._t);
    showNotice._t = setTimeout(() => { n.style.display = 'none'; }, 2500);
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
    return ({ idle:'venter', question:'gæt nu!', closed:'lukket', answer:'svar vist', reveal:'afsløring', gameover:'slut' })[p] || p;
  }
  function escapeHtml(s) {
    return String(s ?? '').replace(/[&<>"']/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  }
  function formatNum(n) {
    if (n == null) return '—';
    return Number.isInteger(n) ? n : Number(n).toLocaleString('da-DK', { maximumFractionDigits: 2 });
  }
})();

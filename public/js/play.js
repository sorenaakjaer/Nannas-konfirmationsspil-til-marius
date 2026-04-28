(() => {
  const socket = io();
  const $ = (id) => document.getElementById(id);
  const PRESET_AVATARS = ['🎉', '😎', '🤩', '🥳', '👑', '🔥', '⚡', '🎮', '🎤', '🦄', '🐯', '🐼', '🐸', '🦊', '🐙', '🚀'];
  const sessionId = localStorage.getItem('nsm_session_id') || `p_${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
  localStorage.setItem('nsm_session_id', sessionId);
  let name = localStorage.getItem('nsm_name') || '';
  let avatar = localStorage.getItem('nsm_avatar') || '🎉';
  let selectedOptionIds = [];
  let currentQuestion = null;
  let currentQuestionId = null;
  let identityCollapsed = Boolean(name);

  $('nameInput').value = name;
  buildAvatarGrid();
  updateAvatarPreview();
  syncIdentityState();

  function identify() {
    if (!name) return;
    socket.emit('guest:identity', { sessionId, name, avatar });
  }

  socket.on('connect', () => {
    socket.emit('hello', { as: 'play' });
    identify();
  });
  socket.on('state', render);
  socket.on('guest:answer:result', (result) => {
    $('feedback').textContent = result.ok ? 'Svar modtaget ✅' : (result.error || 'Kunne ikke sende');
  });

  $('saveIdentityBtn').onclick = () => {
    commitIdentity(true);
  };
  $('editIdentityBtn').onclick = () => {
    identityCollapsed = false;
    syncIdentityState();
  };

  $('uploadAvatarBtn').onclick = () => $('avatarUploadInput').click();
  $('avatarUploadInput').addEventListener('change', async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const uploaded = await uploadAvatar(file);
    if (!uploaded) return;
    avatar = uploaded;
    localStorage.setItem('nsm_avatar', avatar);
    updateAvatarPreview();
    buildAvatarGrid();
    $('feedback').textContent = 'Dit avatarbillede er uploadet ✅';
    $('avatarUploadInput').value = '';
  });

  function render(s) {
    applyConfig(s.config);
    const phase = s.phase;
    const q = s.question;
    currentQuestion = q;
    if (q?.id !== currentQuestionId) {
      currentQuestionId = q?.id || null;
      selectedOptionIds = [];
    }
    if (phase === 'question_open' && q) {
      $('phaseText').textContent = q.type === 'multi' ? 'Vælg et eller flere svar' : 'Vælg ét svar';
      $('questionPrompt').textContent = q.prompt;
      $('submitHint').classList.remove('hidden');
      if (q.questionImageUrl) {
        $('questionImage').src = q.questionImageUrl;
        $('questionImage').classList.remove('hidden');
      } else {
        $('questionImage').classList.add('hidden');
      }
      renderOptions(q);
    } else {
      $('phaseText').textContent = phaseText(phase);
      $('questionPrompt').textContent = phase === 'finale'
        ? 'Spillet er slut'
        : phase === 'pre_question'
          ? 'Næste spørgsmål kommer om et øjeblik...'
          : 'Venter på næste spørgsmål...';
      $('submitHint').classList.add('hidden');
      $('optionGrid').innerHTML = '';
      selectedOptionIds = [];
      $('questionImage').classList.add('hidden');
    }

    if ((phase === 'answer_reveal' || phase === 'scoreboard') && q) {
      const correct = labelList(q, q.correctOptionIds || []);
      $('feedback').textContent = `Rigtige svar: ${correct}`;
      if (q.revealImageUrl) {
        $('questionImage').src = q.revealImageUrl;
        $('questionImage').classList.remove('hidden');
      }
      renderResultSummary(s);
    } else if (phase === 'finale') {
      renderFinaleSummary(s);
    } else {
      $('resultSummary').classList.add('hidden');
      $('resultSummary').innerHTML = '';
    }

  }

  function renderOptions(q) {
    $('feedback').textContent = '';
    const multi = q.type === 'multi';
    $('optionGrid').innerHTML = q.options.map((opt) => `
      <button class="option-btn" data-opt-id="${opt.id}" style="background:${opt.color}">
        <span class="option-shape">${shapeFor(opt.shape)}</span>
        ${opt.imageUrl ? `<img class="option-image" src="${escapeAttr(opt.imageUrl)}" alt="${escapeAttr(opt.text)}">` : ''}
        <span class="option-text">${escapeHtml(opt.text)}</span>
      </button>
    `).join('');
    $('optionGrid').querySelectorAll('.option-btn').forEach((btn) => {
      btn.onclick = () => {
        const id = btn.dataset.optId;
        if (multi) {
          if (selectedOptionIds.includes(id)) selectedOptionIds = selectedOptionIds.filter((v) => v !== id);
          else selectedOptionIds.push(id);
        } else {
          selectedOptionIds = [id];
        }
        paintSelection();
        sendCurrentAnswer();
      };
    });
    paintSelection();
  }

  function paintSelection() {
    $('optionGrid').querySelectorAll('.option-btn').forEach((btn) => {
      btn.classList.toggle('selected', selectedOptionIds.includes(btn.dataset.optId));
    });
  }

  function phaseText(phase) {
    return ({
      lobby: 'Lobby: vent på hosten',
      pre_question: 'Gør dig klar',
      question_locked: 'Spørgsmålet er lukket',
      answer_reveal: 'Svar afsløres...',
      scoreboard: 'Top 3 vises på skærmen',
      finale: 'Finale og vindere',
    })[phase] || phase;
  }

  function shapeFor(shape) {
    return ({
      triangle: '▲',
      diamond: '◆',
      circle: '●',
      square: '■',
    })[shape] || '●';
  }

  function escapeHtml(value) {
    return String(value || '').replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[c]));
  }

  function escapeAttr(value) {
    return escapeHtml(value).replace(/"/g, '&quot;');
  }

  function labelList(question, optionIds) {
    const map = new Map((question.options || []).map((opt) => [opt.id, opt.text]));
    return optionIds.map((id) => escapeHtml(map.get(id) || id)).join(', ');
  }

  function buildAvatarGrid() {
    $('avatarGrid').innerHTML = PRESET_AVATARS.map((value) => `
      <button type="button" class="avatar-option ${avatar === value ? 'selected' : ''}" data-avatar="${value}">
        <span class="avatar-option-inner">${value}</span>
      </button>
    `).join('');
    $('avatarGrid').querySelectorAll('.avatar-option').forEach((btn) => {
      btn.onclick = () => {
        avatar = btn.dataset.avatar;
        localStorage.setItem('nsm_avatar', avatar);
        updateAvatarPreview();
        buildAvatarGrid();
      };
    });
  }

  function updateAvatarPreview() {
    $('avatarPreview').innerHTML = renderAvatar(avatar, true);
    $('identitySummaryAvatar').innerHTML = renderAvatar(avatar, true);
    $('identitySummaryName').textContent = name || 'Ukendt';
  }

  async function uploadAvatar(file) {
    try {
      const fd = new FormData();
      fd.append('image', file);
      const res = await fetch('/api/upload-avatar', { method: 'POST', body: fd });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || 'Upload fejlede');
      return data.url;
    } catch (err) {
      $('feedback').textContent = err.message || 'Kunne ikke uploade avatar';
      return null;
    }
  }

  function renderAvatar(value, large = false) {
    if (isAvatarImage(value)) {
      return `<span class="avatar-mark ${large ? 'large' : ''}"><img src="${escapeAttr(value)}" alt="avatar"></span>`;
    }
    return `<span class="avatar-mark ${large ? 'large' : ''}">${escapeHtml(value || '🎉')}</span>`;
  }

  function isAvatarImage(value) {
    return typeof value === 'string' && (value.startsWith('/uploads/') || value.startsWith('http://') || value.startsWith('https://'));
  }

  function commitIdentity(collapseAfterSave) {
    name = ($('nameInput').value || '').trim().slice(0, 24) || 'Ukendt';
    localStorage.setItem('nsm_name', name);
    localStorage.setItem('nsm_avatar', avatar);
    identify();
    updateAvatarPreview();
    if (collapseAfterSave) {
      identityCollapsed = true;
      syncIdentityState();
    }
    $('feedback').textContent = `Spiller som ${name}`;
  }

  function syncIdentityState() {
    $('identityEditor').classList.toggle('hidden', identityCollapsed);
    $('identitySummary').classList.toggle('hidden', !identityCollapsed);
    updateAvatarPreview();
  }

  function sendCurrentAnswer() {
    if (!selectedOptionIds.length) return;
    if (!name) commitIdentity(true);
    socket.emit('guest:answer', { sessionId, optionIds: selectedOptionIds });
    $('feedback').textContent = 'Svar registreret - du kan stadig ændre det.';
  }

  function renderResultSummary(state) {
    const myResult = state.round?.guestResults?.[sessionId];
    const top3 = (state.leaderboardTop4 || []).slice(0, 3);
    const placing = top3.findIndex((p) => p.sessionId === sessionId);
    const myTotal = placing >= 0 ? Number(top3[placing]?.points || 0) : null;
    $('resultSummary').classList.remove('hidden');
    $('resultSummary').innerHTML = `
      <div class="summary-grid">
        <div class="stat-pill"><span>Dit svar</span><strong>${myResult?.isCorrect ? 'Rigtigt' : 'Forkert'}</strong></div>
        <div class="stat-pill"><span>Point i denne runde</span><strong>${myResult?.points || 0}</strong></div>
        <div class="stat-pill"><span>Din samlede placering</span><strong>${placing >= 0 ? `#${placing + 1}` : 'Udenfor top 3'}</strong></div>
      </div>
      ${myTotal != null ? `<div class="marius-answer"><strong>Dine samlede point:</strong> ${myTotal}</div>` : ''}
      <div class="eyebrow" style="margin-top:10px;">Samlet top 3</div>
      <div class="leaderboard-list">
        ${top3.map((p, idx) => `<div class="leaderboard-item"><span class="leaderboard-name">${renderAvatar(p.avatar)} ${idx + 1}. ${escapeHtml(p.name)}</span><strong>${p.points} point</strong></div>`).join('')}
      </div>
    `;
  }

  function renderFinaleSummary(state) {
    fireConfetti();
    const realTop3 = (state.finalTop4 || []).slice(0, 3);
    const celebrantName = state.config?.celebrantName || 'Marius';
    const hostName = state.config?.hostName || 'Nanna';
    const podium = [
      { name: celebrantName, avatar: '👑', label: '1. plads' },
      realTop3[0] ? { ...realTop3[0], label: '2. plads' } : null,
      realTop3[1] ? { ...realTop3[1], label: '3. plads' } : null,
    ].filter(Boolean);
    $('resultSummary').classList.remove('hidden');
    $('resultSummary').innerHTML = `
      <div class="eyebrow">Finale</div>
      <div class="finale-grid podium-grid">
        ${podium.map((p) => `<div class="rank-card podium-card ${p.name === celebrantName ? 'marius-podium' : ''}"><strong>${p.label}</strong><div>${renderAvatar(p.avatar)} ${escapeHtml(p.name)}</div>${p.points != null ? `<div>${p.points} point</div>` : '<div>Dagens hovedperson</div>'}</div>`).join('')}
      </div>
      <div class="winner-highlight"><span class="winner-line">Tak fordi I spillede med og I lod ${escapeHtml(celebrantName)} vinde.</span><span class="winner-tag">#KæmpeLOVEfra${escapeHtml(hostName)}</span></div>
    `;
  }

  function fireConfetti() {
    const colors = ['#ff4fa1', '#4d7de2', '#ffc94a', '#9ed8ff'];
    for (let i = 0; i < 60; i += 1) {
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

  function applyConfig(config) {
    if (!config) return;
    const hostText = document.getElementById('brandHostText');
    const celebrantText = document.getElementById('brandCelebrantText');
    const liveText = document.getElementById('liveLineText');
    if (hostText) hostText.textContent = config.hostBrandText || config.hostName || '';
    if (celebrantText) celebrantText.textContent = config.celebrantName || '';
    if (liveText) liveText.textContent = config.liveLine || '';
    document.title = `${config.quizTitle || 'Quiz'} - Spiller`;
    document.documentElement.style.setProperty('--dynamic-bg-image', `url("${config.backgroundImageUrl || '/reference_code/Marius%20konf-17.png'}")`);
  }
})();

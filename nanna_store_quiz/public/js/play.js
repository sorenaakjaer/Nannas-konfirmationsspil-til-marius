(() => {
  const socket = io();
  const $ = (id) => document.getElementById(id);
  const sessionId = localStorage.getItem('nsm_session_id') || `p_${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
  localStorage.setItem('nsm_session_id', sessionId);
  let name = localStorage.getItem('nsm_name') || '';
  let avatar = localStorage.getItem('nsm_avatar') || '🎉';
  let selectedOptionIds = [];
  let currentQuestion = null;

  $('nameInput').value = name;
  $('avatarInput').value = avatar;

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
    name = ($('nameInput').value || '').trim().slice(0, 24) || 'Ukendt';
    avatar = ($('avatarInput').value || '🎉').trim().slice(0, 4) || '🎉';
    localStorage.setItem('nsm_name', name);
    localStorage.setItem('nsm_avatar', avatar);
    identify();
    $('feedback').textContent = `Spiller som ${name} ${avatar}`;
  };

  $('submitBtn').onclick = () => {
    if (!selectedOptionIds.length) {
      $('feedback').textContent = 'Vælg mindst et svar';
      return;
    }
    if (!name) {
      name = 'Ukendt';
      avatar = '🎉';
      localStorage.setItem('nsm_name', name);
      localStorage.setItem('nsm_avatar', avatar);
      identify();
    }
    socket.emit('guest:answer', { sessionId, optionIds: selectedOptionIds });
  };

  function render(s) {
    const phase = s.phase;
    const q = s.question;
    currentQuestion = q;
    if (phase === 'question_open' && q) {
      $('phaseText').textContent = q.type === 'multi' ? 'Vælg et eller flere svar' : 'Vælg ét svar';
      $('questionPrompt').textContent = q.prompt;
      if (q.questionImageUrl) {
        $('questionImage').src = q.questionImageUrl;
        $('questionImage').classList.remove('hidden');
      } else {
        $('questionImage').classList.add('hidden');
      }
      renderOptions(q);
    } else {
      $('phaseText').textContent = phaseText(phase);
      $('questionPrompt').textContent = phase === 'finale' ? 'Spillet er slut' : 'Venter på næste spørgsmål...';
      $('optionGrid').innerHTML = '';
      selectedOptionIds = [];
      $('questionImage').classList.add('hidden');
    }

    if (phase === 'answer_reveal' && q) {
      const correct = (q.correctOptionIds || []).join(', ');
      $('feedback').textContent = `Rigtige svar-id'er: ${correct}`;
      if (q.revealImageUrl) {
        $('questionImage').src = q.revealImageUrl;
        $('questionImage').classList.remove('hidden');
      }
    }

    $('leaderboard').innerHTML = (s.leaderboardTop4 || []).map((p, idx) =>
      `<div>${idx + 1}. ${escapeHtml(p.avatar || '🎉')} ${escapeHtml(p.name)} - ${p.points} point</div>`
    ).join('');
  }

  function renderOptions(q) {
    selectedOptionIds = [];
    $('feedback').textContent = '';
    const multi = q.type === 'multi';
    $('optionGrid').innerHTML = q.options.map((opt) => `
      <button class="option-btn" data-opt-id="${opt.id}" style="background:${opt.color}">
        ${shapeFor(opt.shape)} ${escapeHtml(opt.text)}
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
      };
    });
  }

  function paintSelection() {
    $('optionGrid').querySelectorAll('.option-btn').forEach((btn) => {
      btn.classList.toggle('selected', selectedOptionIds.includes(btn.dataset.optId));
    });
  }

  function phaseText(phase) {
    return ({
      lobby: 'Lobby: vent på hosten',
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
})();

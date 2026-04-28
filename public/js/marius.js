(() => {
  const socket = io();
  const $ = (id) => document.getElementById(id);
  let pin = sessionStorage.getItem('nsm_marius_pin') || '';
  let selectedOptionIds = [];
  let currentQuestionId = null;

  if (pin) login(pin);
  $('loginBtn').onclick = () => login($('mariusPin').value.trim());
  $('mariusPin').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') login($('mariusPin').value.trim());
  });

  function login(value) {
    pin = value;
    socket.emit('hello', { as: 'marius', pin });
  }

  socket.on('auth-error', ({ message }) => {
    $('feedback').textContent = message || 'Forkert PIN';
    $('loginCard').classList.remove('hidden');
    $('panel').classList.add('hidden');
    sessionStorage.removeItem('nsm_marius_pin');
  });

  socket.on('state', render);
  socket.on('marius:answer:result', (result) => {
    $('feedback').textContent = result.ok ? 'Dit svar er låst ✅' : (result.error || 'Kunne ikke sende');
  });

  function render(s) {
    applyConfig(s.config);
    sessionStorage.setItem('nsm_marius_pin', pin);
    $('loginCard').classList.add('hidden');
    $('panel').classList.remove('hidden');
    const q = s.question;
    $('phaseText').textContent = phaseText(s.phase);
    if (q?.id !== currentQuestionId) {
      currentQuestionId = q?.id || null;
      selectedOptionIds = [];
    }
    if (s.phase !== 'question_open' || !q) {
      $('questionPrompt').textContent = s.phase === 'pre_question'
        ? 'Næste spørgsmål kommer om et øjeblik...'
        : 'Venter på næste spørgsmål...';
      $('optionGrid').innerHTML = '';
      $('questionImage').classList.add('hidden');
      return;
    }
    $('questionPrompt').textContent = q.prompt;
    if (q.questionImageUrl) {
      $('questionImage').src = q.questionImageUrl;
      $('questionImage').classList.remove('hidden');
    } else {
      $('questionImage').classList.add('hidden');
    }
    renderOptions(q);
    if (s.round.mariusAnswered) {
      $('feedback').textContent = 'Dit svar er registreret - du kan stadig ændre det, til tiden er ude.';
    } else {
      $('feedback').textContent = '';
    }
  }

  function renderOptions(q) {
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
        $('optionGrid').querySelectorAll('.option-btn').forEach((node) => {
          node.classList.toggle('selected', selectedOptionIds.includes(node.dataset.optId));
        });
        socket.emit('marius:answer', { pin, optionIds: selectedOptionIds });
        $('feedback').textContent = 'Svar registreret - du kan stadig ændre det.';
      };
    });
    $('optionGrid').querySelectorAll('.option-btn').forEach((node) => {
      node.classList.toggle('selected', selectedOptionIds.includes(node.dataset.optId));
    });
  }

  function phaseText(phase) {
    return ({
      lobby: 'Lobby',
      pre_question: 'Gør dig klar',
      question_open: 'Svar nu',
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

  function escapeAttr(value) {
    return escapeHtml(value).replace(/"/g, '&quot;');
  }

  function applyConfig(config) {
    if (!config) return;
    const hostText = document.getElementById('brandHostText');
    const celebrantText = document.getElementById('brandCelebrantText');
    const liveText = document.getElementById('liveLineText');
    const heading = document.getElementById('konfirmantHeading');
    const pinInput = document.getElementById('mariusPin');
    if (hostText) hostText.textContent = config.hostBrandText || config.hostName || '';
    if (celebrantText) celebrantText.textContent = config.celebrantName || '';
    if (liveText) liveText.textContent = config.liveLine || '';
    if (heading) heading.textContent = config.celebrantName || '';
    if (pinInput) pinInput.placeholder = `${config.celebrantName || 'Konfirmant'} PIN`;
    document.title = `${config.quizTitle || 'Quiz'} - Konfirmant`;
    document.documentElement.style.setProperty('--dynamic-bg-image', `url("${config.backgroundImageUrl || '/reference_code/Marius%20konf-17.png'}")`);
  }
})();

(() => {
  const socket = io();
  const $ = (id) => document.getElementById(id);
  let pin = sessionStorage.getItem('nsm_marius_pin') || '';
  let selectedOptionIds = [];

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
    sessionStorage.setItem('nsm_marius_pin', pin);
    $('loginCard').classList.add('hidden');
    $('panel').classList.remove('hidden');
    const q = s.question;
    $('phaseText').textContent = phaseText(s.phase);
    if (s.phase !== 'question_open' || !q) {
      $('questionPrompt').textContent = 'Venter på næste spørgsmål...';
      $('optionGrid').innerHTML = '';
      $('submitBtn').disabled = true;
      $('questionImage').classList.add('hidden');
      return;
    }
    $('questionPrompt').textContent = q.prompt;
    $('submitBtn').disabled = false;
    if (q.questionImageUrl) {
      $('questionImage').src = q.questionImageUrl;
      $('questionImage').classList.remove('hidden');
    } else {
      $('questionImage').classList.add('hidden');
    }
    renderOptions(q);
    if (s.round.mariusAnswered) {
      $('feedback').textContent = 'Du har allerede svaret på denne runde';
      $('submitBtn').disabled = true;
    } else {
      $('feedback').textContent = '';
    }
  }

  $('submitBtn').onclick = () => {
    if (!selectedOptionIds.length) {
      $('feedback').textContent = 'Vælg mindst et svar';
      return;
    }
    socket.emit('marius:answer', { pin, optionIds: selectedOptionIds });
  };

  function renderOptions(q) {
    selectedOptionIds = [];
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
        $('optionGrid').querySelectorAll('.option-btn').forEach((node) => {
          node.classList.toggle('selected', selectedOptionIds.includes(node.dataset.optId));
        });
      };
    });
  }

  function phaseText(phase) {
    return ({
      lobby: 'Lobby',
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
})();

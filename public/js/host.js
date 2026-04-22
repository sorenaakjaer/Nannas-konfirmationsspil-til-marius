(() => {
  const socket = io();
  const $ = (id) => document.getElementById(id);
  let pin = sessionStorage.getItem('nsm_host_pin') || '';
  let state = null;
  let editingQuestion = null;

  const optionColors = ['#ff4fa1', '#4666ff', '#ffad33', '#13a06f'];
  const optionShapes = ['triangle', 'diamond', 'circle', 'square'];

  if (pin) login(pin);
  $('loginBtn').onclick = () => login($('hostPin').value.trim());
  $('hostPin').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') login($('hostPin').value.trim());
  });

  function login(value) {
    pin = value;
    socket.emit('hello', { as: 'host', pin });
  }

  socket.on('auth-error', ({ message }) => {
    notice(message || 'Forkert login');
    sessionStorage.removeItem('nsm_host_pin');
    $('loginCard').classList.remove('hidden');
    $('hostPanel').classList.add('hidden');
  });

  socket.on('state', (s) => {
    state = s;
    sessionStorage.setItem('nsm_host_pin', pin);
    $('loginCard').classList.add('hidden');
    $('hostPanel').classList.remove('hidden');
    render();
  });

  function emitWithPin(eventName, payload = {}) {
    socket.emit(eventName, { pin, ...payload });
  }

  $('setQuestionCountBtn').onclick = () => emitWithPin('host:set-question-count', { count: Number($('questionCount').value) });
  $('startBtn').onclick = () => emitWithPin('host:start', { count: Number($('questionCount').value) });
  $('lockBtn').onclick = () => emitWithPin('host:lock');
  $('revealBtn').onclick = () => emitWithPin('host:reveal');
  $('scoreboardBtn').onclick = () => emitWithPin('host:show-scoreboard');
  $('nextBtn').onclick = () => emitWithPin('host:next');
  $('finishBtn').onclick = () => emitWithPin('host:finish');
  $('resetBtn').onclick = () => {
    if (confirm('Vil du nulstille hele spillet?')) emitWithPin('host:reset');
  };

  $('saveQuestionBtn').onclick = () => {
    const q = readQuestionForm();
    emitWithPin('host:save-question', { question: q });
  };
  $('deleteQuestionBtn').onclick = () => {
    if (!editingQuestion?.id) return;
    if (confirm('Slet spørgsmål?')) emitWithPin('host:delete-question', { id: editingQuestion.id });
  };
  $('newQuestionBtn').onclick = () => {
    editingQuestion = blankQuestion();
    fillQuestionForm(editingQuestion);
  };
  $('importMdBtn').onclick = () => emitWithPin('host:import-questions-md');

  socket.on('host:start:result', (r) => !r.ok && notice(r.error || 'Kunne ikke starte'));
  socket.on('host:lock:result', (r) => !r.ok && notice(r.error || 'Kunne ikke låse'));
  socket.on('host:reveal:result', (r) => !r.ok && notice(r.error || 'Kunne ikke afsløre'));
  socket.on('host:show-scoreboard:result', (r) => !r.ok && notice(r.error || 'Kunne ikke vise scoreboard'));
  socket.on('host:next:result', (r) => !r.ok && notice(r.error || 'Kunne ikke gå videre'));
  socket.on('host:save-question:result', (r) => notice(r.ok ? 'Spørgsmål gemt' : (r.error || 'Kunne ikke gemme')));
  socket.on('host:delete-question:result', (r) => notice(r.ok ? 'Spørgsmål slettet' : (r.error || 'Kunne ikke slette')));
  socket.on('host:import-questions-md:result', (r) => notice(r.ok ? `Importerede ${r.count} spørgsmål` : (r.error || 'Import fejlede')));

  $('questionSelect').onchange = () => {
    if (!state?.questionBank?.length) return;
    const selectedId = $('questionSelect').value;
    const found = state.questionBank.find((q) => q.id === selectedId);
    if (!found) return;
    editingQuestion = found;
    fillQuestionForm(found);
  };

  $('imageUpload').addEventListener('change', async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const result = await uploadImage(file);
    if (result?.url) {
      const target = $('qQuestionImageUrl').value ? $('qRevealImageUrl') : $('qQuestionImageUrl');
      target.value = result.url;
      notice('Billede uploadet');
    }
  });

  document.addEventListener('paste', async (e) => {
    const item = Array.from(e.clipboardData?.items || []).find((it) => it.type.startsWith('image/'));
    if (!item) return;
    const file = item.getAsFile();
    const result = await uploadImage(file);
    if (result?.url) {
      $('qQuestionImageUrl').value = result.url;
      notice('Billede indsat fra clipboard');
    }
  });

  async function uploadImage(file) {
    const fd = new FormData();
    fd.append('image', file);
    fd.append('pin', pin);
    try {
      const res = await fetch('/api/upload', { method: 'POST', body: fd });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || 'Upload fejlede');
      return data;
    } catch (err) {
      notice(err.message || 'Upload fejlede');
      return null;
    }
  }

  function render() {
    $('phaseLabel').textContent = phaseLabel(state.phase);
    $('questionLabel').textContent = `${state.questionIndex || 0} / ${state.totalQuestions || state.selectedQuestionCount || 0}`;
    $('answersCount').textContent = state.round.answersCount;
    $('mariusStatus').textContent = state.round.mariusAnswered ? 'Har svaret' : 'Mangler svar';
    $('connectedGuests').textContent = state.connectedGuests || 0;
    $('questionCount').value = state.selectedQuestionCount || 1;

    const select = $('questionSelect');
    select.innerHTML = (state.questionBank || []).map((q, index) => `<option value="${q.id}">${index + 1}. ${escapeHtml(q.prompt)}</option>`).join('');
    if (!editingQuestion && state.questionBank?.length) editingQuestion = state.questionBank[0];
    if (editingQuestion && state.questionBank?.some((q) => q.id === editingQuestion.id)) {
      select.value = editingQuestion.id;
      fillQuestionForm(state.questionBank.find((q) => q.id === editingQuestion.id));
    } else if (state.questionBank?.length) {
      editingQuestion = state.questionBank[0];
      select.value = editingQuestion.id;
      fillQuestionForm(editingQuestion);
    } else {
      editingQuestion = blankQuestion();
      fillQuestionForm(editingQuestion);
    }
  }

  function blankQuestion() {
    return {
      id: '',
      prompt: '',
      type: 'single',
      timeLimitSeconds: 20,
      questionImageUrl: '',
      revealImageUrl: '',
      revealText: '',
      enabled: true,
      options: [0, 1, 2, 3].map((idx) => ({
        id: '',
        text: `Svar ${idx + 1}`,
        isCorrect: idx === 0,
        color: optionColors[idx],
        shape: optionShapes[idx],
      })),
    };
  }

  function fillQuestionForm(q) {
    if (!q) return;
    $('qPrompt').value = q.prompt || '';
    $('qTime').value = q.timeLimitSeconds || 20;
    $('qEnabled').checked = q.enabled !== false;
    $('qRevealText').value = q.revealText || '';
    $('qQuestionImageUrl').value = q.questionImageUrl || '';
    $('qRevealImageUrl').value = q.revealImageUrl || '';
    const radio = document.querySelector(`input[name="qType"][value="${q.type === 'multi' ? 'multi' : 'single'}"]`);
    if (radio) radio.checked = true;

    const wrap = $('optionsWrap');
    wrap.innerHTML = (q.options || []).map((opt, idx) => `
      <div class="row">
        <label style="min-width: 90px;">Svar ${idx + 1}</label>
        <input type="text" data-option-text="${idx}" value="${escapeAttr(opt.text || '')}" />
        <label><input type="checkbox" data-option-correct="${idx}" ${opt.isCorrect ? 'checked' : ''} /> Korrekt</label>
      </div>
    `).join('');
  }

  function readQuestionForm() {
    const type = document.querySelector('input[name="qType"]:checked')?.value || 'single';
    const options = [0, 1, 2, 3].map((idx) => ({
      id: editingQuestion?.options?.[idx]?.id || '',
      text: document.querySelector(`[data-option-text="${idx}"]`)?.value?.trim() || `Svar ${idx + 1}`,
      isCorrect: Boolean(document.querySelector(`[data-option-correct="${idx}"]`)?.checked),
      color: editingQuestion?.options?.[idx]?.color || optionColors[idx],
      shape: editingQuestion?.options?.[idx]?.shape || optionShapes[idx],
    }));

    if (!options.some((o) => o.isCorrect)) options[0].isCorrect = true;
    if (type === 'single' && options.filter((o) => o.isCorrect).length > 1) {
      let first = true;
      options.forEach((o) => {
        if (!o.isCorrect) return;
        if (first) first = false;
        else o.isCorrect = false;
      });
    }

    return {
      id: editingQuestion?.id || '',
      prompt: $('qPrompt').value.trim(),
      type,
      timeLimitSeconds: Number($('qTime').value) || 20,
      questionImageUrl: $('qQuestionImageUrl').value.trim(),
      revealImageUrl: $('qRevealImageUrl').value.trim(),
      revealText: $('qRevealText').value.trim(),
      enabled: $('qEnabled').checked,
      options,
    };
  }

  function notice(message) {
    const n = $('notice');
    n.textContent = message;
    n.classList.remove('hidden');
    clearTimeout(notice._timer);
    notice._timer = setTimeout(() => n.classList.add('hidden'), 3000);
  }

  function phaseLabel(phase) {
    return ({
      lobby: 'Lobby',
      question_open: 'Spørgsmål åbent',
      question_locked: 'Låst',
      answer_reveal: 'Afsløring',
      scoreboard: 'Top 3',
      finale: 'Finale',
    })[phase] || phase;
  }

  function escapeHtml(value) {
    return String(value || '').replace(/[&<>"']/g, (c) => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;',
    }[c]));
  }

  function escapeAttr(value) {
    return escapeHtml(value).replace(/"/g, '&quot;');
  }
})();

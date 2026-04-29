(() => {
  const socket = io();
  const $ = (id) => document.getElementById(id);
  let pin = sessionStorage.getItem('nsm_host_pin') || '';
  let state = null;
  let editingQuestion = null;
  let editorCollapsed = true;

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

  $('saveConfigBtn').onclick = () => emitWithPin('host:save-config', {
    config: {
      hostName: $('configHostName').value.trim(),
      celebrantName: $('configCelebrantName').value.trim(),
      liveLine: $('configLiveLine').value.trim(),
      backgroundImageUrl: $('configBackgroundImageUrl').value.trim(),
      browserTitle: `${$('configHostName').value.trim() || 'Nanna'} STORE Quiz til ${$('configCelebrantName').value.trim() || 'Marius'}`,
    },
  });
  $('uploadBackgroundImageBtn').onclick = () => uploadIntoField('configBackgroundImageUrl', 'Baggrundsbillede uploadet');
  $('showIntroBtn').onclick = () => emitWithPin('host:show-intro');
  $('showQrBtn').onclick = () => emitWithPin('host:show-qr');
  $('startBtn').onclick = () => emitWithPin('host:start');
  $('nextBtn').onclick = () => emitWithPin('host:next');
  $('restartCurrentBtn').onclick = () => emitWithPin('host:restart-current');
  $('addTimeBtn').onclick = () => emitWithPin('host:add-time', { extraSeconds: 10 });
  $('finishBtn').onclick = () => emitWithPin('host:finish');
  $('resetBtn').onclick = () => {
    if (confirm('Vil du nulstille hele spillet?')) emitWithPin('host:reset');
  };

  $('saveQuestionBtn').onclick = () => {
    const q = readQuestionForm();
    emitWithPin('host:save-question', { question: q });
  };
  $('addOptionBtn').onclick = () => {
    const draft = hasOptionEditors() ? readQuestionForm() : (editingQuestion || blankQuestion());
    const current = draft.options.slice();
    if (current.length >= 8) {
      notice('Der kan højst være 8 svarmuligheder');
      return;
    }
    current.push(makeOption(current.length, { isCorrect: false }));
    editingQuestion = { ...draft, options: current };
    fillQuestionForm(editingQuestion);
  };
  $('toggleEditorBtn').onclick = () => {
    editorCollapsed = !editorCollapsed;
    syncEditorState();
  };
  $('deleteQuestionBtn').onclick = () => {
    if (!editingQuestion?.id) return;
    if (confirm('Slet spørgsmål?')) emitWithPin('host:delete-question', { id: editingQuestion.id });
  };
  $('newQuestionBtn').onclick = () => {
    editingQuestion = blankQuestion();
    fillQuestionForm(editingQuestion);
  };
  if ($('importMdBtn')) $('importMdBtn').onclick = () => emitWithPin('host:import-questions-md');

  socket.on('host:start:result', (r) => !r.ok && notice(r.error || 'Kunne ikke starte'));
  socket.on('host:save-config:result', (r) => notice(r.ok ? 'Branding gemt' : (r.error || 'Kunne ikke gemme branding')));
  socket.on('host:show-intro:result', (r) => !r.ok && notice(r.error || 'Kunne ikke vise intro'));
  socket.on('host:show-qr:result', (r) => !r.ok && notice(r.error || 'Kunne ikke vise QR-kode'));
  socket.on('host:next:result', (r) => !r.ok && notice(r.error || 'Kunne ikke gå videre'));
  socket.on('host:restart-current:result', (r) => notice(r.ok ? 'Spørgsmålet er startet forfra' : (r.error || 'Kunne ikke starte spørgsmålet forfra')));
  socket.on('host:add-time:result', (r) => {
    if (!r.ok) { notice(r.error || 'Kunne ikke give mere tid'); return; }
    if (r.phase === 'reopened') notice(`Spørgsmålet genåbnet i ${r.extraSeconds} sek - point rullet tilbage`);
    else if (r.phase === 'pre_question') notice(`Pre-countdown forlænget med ${r.extraSeconds} sek`);
    else notice(`${r.extraSeconds} sekunder tilføjet`);
  });
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

  $('imageUpload')?.addEventListener('change', async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const result = await uploadImage(file);
    if (result?.url) {
      const target = preferredImageTarget();
      if (target) target.value = result.url;
      notice('Billede uploadet');
      $('imageUpload').value = '';
      syncImagePreviews();
    }
  });

  $('uploadQuestionImageBtn').onclick = () => uploadIntoField('qQuestionImageUrl', 'Samlet spørgsmålsbillede uploadet');
  $('uploadRevealImageBtn').onclick = () => uploadIntoField('qRevealImageUrl', 'Reveal billede uploadet');
  $('clearQuestionImageBtn').onclick = () => clearImageField('qQuestionImageUrl', 'qQuestionImagePreview', 'Samlet billede fjernet');
  $('clearRevealImageBtn').onclick = () => clearImageField('qRevealImageUrl', 'qRevealImagePreview', 'Reveal billede fjernet');

  document.addEventListener('paste', async (e) => {
    const item = Array.from(e.clipboardData?.items || []).find((it) => it.type.startsWith('image/'));
    if (!item) return;
    const file = item.getAsFile();
    const result = await uploadImage(file);
    if (result?.url) {
      const target = preferredImageTarget();
      if (target) target.value = result.url;
      notice('Billede indsat fra clipboard');
      syncImagePreviews();
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
    applyConfig(state.config);
    $('phaseLabel').textContent = phaseLabel(state.phase);
    $('questionLabel').textContent = `${state.questionIndex || 0} / ${state.totalQuestions || state.selectedQuestionCount || 0}`;
    $('answersCount').textContent = state.round.answersCount;
    $('mariusStatus').textContent = state.round.mariusAnswered ? 'Har svaret' : 'Mangler svar';
    $('connectedGuests').textContent = state.connectedGuests || 0;
    $('showIntroBtn').disabled = state.phase !== 'lobby' || state.lobbyView === 'intro';
    $('showQrBtn').disabled = state.phase !== 'lobby' || state.lobbyView === 'qr';
    $('configHostName').value = state.config?.hostName || '';
    $('configCelebrantName').value = state.config?.celebrantName || '';
    $('configLiveLine').value = state.config?.liveLine || '';
    $('configBackgroundImageUrl').value = state.config?.backgroundImageUrl || '';
    setPreview('configBackgroundPreview', state.config?.backgroundImageUrl, 'Baggrundsbillede');

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
    syncImagePreviews();
    syncEditorState();
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
      options: [makeOption(0, { isCorrect: true }), makeOption(1, { isCorrect: false })],
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
      <div class="option-editor" data-option-row="${idx}" data-option-id="${escapeAttr(opt.id || '')}" data-option-color="${escapeAttr(opt.color || optionColors[idx % optionColors.length])}" data-option-shape="${escapeAttr(opt.shape || optionShapes[idx % optionShapes.length])}">
        <div class="row">
          <label style="min-width: 90px;">Svar ${idx + 1}</label>
          <input type="text" data-option-text="${idx}" value="${escapeAttr(opt.text || '')}" />
          <label><input type="checkbox" data-option-correct="${idx}" ${opt.isCorrect ? 'checked' : ''} /> Korrekt</label>
          <button type="button" class="btn danger option-remove-btn" data-option-remove="${idx}" ${q.options.length <= 2 ? 'disabled' : ''}>Fjern</button>
        </div>
        <div class="row">
          <input type="text" data-option-image="${idx}" value="${escapeAttr(opt.imageUrl || '')}" placeholder="/uploads/svar-${idx + 1}.png" />
          <button type="button" class="btn secondary option-upload-btn" data-option-upload="${idx}">Upload billede til svar ${idx + 1}</button>
        </div>
      </div>
    `).join('');

    wrap.querySelectorAll('[data-option-upload]').forEach((btn) => {
      btn.onclick = async () => {
        const idx = btn.dataset.optionUpload;
        const input = document.querySelector(`[data-option-image="${idx}"]`);
        const picker = document.createElement('input');
        picker.type = 'file';
        picker.accept = 'image/*';
        picker.onchange = async () => {
          const file = picker.files?.[0];
          if (!file) return;
          const result = await uploadImage(file);
          if (result?.url && input) {
            input.value = result.url;
            notice(`Billede gemt til svar ${Number(idx) + 1}`);
          }
        };
        picker.click();
      };
    });
    wrap.querySelectorAll('[data-option-remove]').forEach((btn) => {
      btn.onclick = () => {
        const idx = Number(btn.dataset.optionRemove);
        const row = btn.closest('[data-option-row]');
        const optionId = row?.dataset.optionId || '';
        const draft = hasOptionEditors() ? readQuestionForm() : (editingQuestion || blankQuestion());
        const nextOptions = draft.options.filter((opt, optionIdx) => {
          if (optionId) return opt.id !== optionId;
          return optionIdx !== idx;
        });
        if (nextOptions.length < 2) {
          notice('Et spørgsmål skal have mindst 2 svarmuligheder');
          return;
        }
        editingQuestion = {
          ...draft,
          options: nextOptions.map((opt, optionIdx) => ({
            ...makeOption(optionIdx, opt),
            id: opt.id || '',
          })),
        };
        fillQuestionForm(editingQuestion);
        if (editingQuestion.id) {
          emitWithPin('host:save-question', { question: editingQuestion });
          notice('Svarmulighed fjernet og gemt');
        } else {
          notice('Svarmulighed fjernet - husk at gemme spørgsmålet');
        }
      };
    });
    syncImagePreviews();
  }

  function readQuestionForm() {
    const type = document.querySelector('input[name="qType"]:checked')?.value || 'single';
    const optionRows = Array.from(document.querySelectorAll('[data-option-row]'));
    const options = optionRows.map((row, displayIdx) => {
      const idx = Number(row.dataset.optionRow);
      return {
        id: row.dataset.optionId || '',
        text: document.querySelector(`[data-option-text="${idx}"]`)?.value?.trim() || `Svar ${displayIdx + 1}`,
        isCorrect: Boolean(document.querySelector(`[data-option-correct="${idx}"]`)?.checked),
        color: row.dataset.optionColor || optionColors[displayIdx % optionColors.length],
        shape: row.dataset.optionShape || optionShapes[displayIdx % optionShapes.length],
        imageUrl: document.querySelector(`[data-option-image="${idx}"]`)?.value?.trim() || '',
      };
    });

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
      pre_question: 'Nedtælling',
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

  function preferredImageTarget() {
    const active = document.activeElement;
    if (active?.matches?.('[data-option-image], #qQuestionImageUrl, #qRevealImageUrl')) return active;
    return $('qQuestionImageUrl').value ? $('qRevealImageUrl') : $('qQuestionImageUrl');
  }

  async function uploadIntoField(fieldId, successMessage) {
    const picker = document.createElement('input');
    picker.type = 'file';
    picker.accept = 'image/*';
    picker.onchange = async () => {
      const file = picker.files?.[0];
      if (!file) return;
      const result = await uploadImage(file);
      if (result?.url) {
        $(fieldId).value = result.url;
        syncImagePreviews();
        notice(successMessage);
      }
    };
    picker.click();
  }

  function syncImagePreviews() {
    setPreview('qQuestionImagePreview', $('qQuestionImageUrl')?.value, 'Samlet spørgsmålsbillede');
    setPreview('qRevealImagePreview', $('qRevealImageUrl')?.value, 'Reveal billede');
  }

  function setPreview(previewId, url, alt) {
    const box = $(previewId);
    if (!box) return;
    const cleanUrl = String(url || '').trim();
    if (!cleanUrl) {
      box.innerHTML = '';
      box.classList.add('hidden');
      return;
    }
    box.innerHTML = `<img src="${escapeAttr(cleanUrl)}" alt="${escapeAttr(alt)}" />`;
    box.classList.remove('hidden');
  }

  function clearImageField(fieldId, previewId, message) {
    const input = $(fieldId);
    const preview = $(previewId);
    if (input) input.value = '';
    if (preview) {
      preview.innerHTML = '';
      preview.classList.add('hidden');
    }
    notice(message);
  }

  function syncEditorState() {
    const card = document.querySelector('.editor-card');
    const btn = $('toggleEditorBtn');
    if (!card || !btn) return;
    card.classList.toggle('minimized', editorCollapsed);
    btn.textContent = editorCollapsed ? 'Åbn editor' : 'Minimér editor';
  }

  function makeOption(idx, overrides = {}) {
    return {
      id: overrides.id || '',
      text: overrides.text || `Svar ${idx + 1}`,
      isCorrect: Boolean(overrides.isCorrect),
      color: overrides.color || optionColors[idx % optionColors.length],
      shape: overrides.shape || optionShapes[idx % optionShapes.length],
      imageUrl: overrides.imageUrl || '',
    };
  }

  function hasOptionEditors() {
    return Boolean(document.querySelector('[data-option-row]'));
  }

  function applyConfig(config) {
    if (!config) return;
    const hostText = document.getElementById('brandHostText');
    const celebrantText = document.getElementById('brandCelebrantText');
    const liveText = document.getElementById('liveLineText');
    const hostLoginTitle = document.getElementById('hostLoginTitle');
    const celebrantStatusLabel = document.getElementById('celebrantStatusLabel');
    const hostSideDescription = document.getElementById('hostSideDescription');
    if (hostText) hostText.textContent = config.hostBrandText || config.hostName || '';
    if (celebrantText) celebrantText.textContent = config.celebrantName || '';
    if (liveText) liveText.textContent = config.liveLine || '';
    if (hostLoginTitle) hostLoginTitle.textContent = config.quizTitle || '';
    if (celebrantStatusLabel) celebrantStatusLabel.textContent = config.celebrantName || '';
    if (hostSideDescription) hostSideDescription.textContent = `Her kan du holde øje med, om publikum og ${config.celebrantName || ''} er med.`;
    document.title = `${config.quizTitle || 'Quiz'} - Host`;
    document.documentElement.style.setProperty('--dynamic-bg-image', `url("${config.backgroundImageUrl || '/reference_code/Marius%20konf-17.png'}")`);
  }
})();

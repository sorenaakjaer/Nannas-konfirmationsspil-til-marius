const fs = require('fs');
const path = require('path');
const http = require('http');
const express = require('express');
const multer = require('multer');
const QRCode = require('qrcode');
const { Server } = require('socket.io');
require('dotenv').config();

const PORT = Number(process.env.PORT || 3333);
const HOST_PIN = process.env.HOST_PIN || '1234';
const MARIUS_PIN = process.env.MARIUS_PIN || '2012';
const PUBLIC_BASE_URL = process.env.PUBLIC_BASE_URL || null;

const ROOT_DIR = __dirname;
const DATA_DIR = path.join(ROOT_DIR, 'data');
const PUBLIC_DIR = path.join(ROOT_DIR, 'public');
const UPLOAD_DIR = path.join(PUBLIC_DIR, 'uploads');
const QUESTIONS_FILE = path.join(DATA_DIR, 'questions.json');
const STATE_FILE = path.join(DATA_DIR, 'state.json');
const ROOT_QUESTIONS_MD = path.join(ROOT_DIR, 'Questions.md');

for (const dir of [DATA_DIR, PUBLIC_DIR, UPLOAD_DIR]) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function safeReadJson(filePath, fallback) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (_e) {
    return fallback;
  }
}

function normalizeQuestion(raw, index) {
  const palette = ['#ff4fa1', '#4666ff', '#ffad33', '#13a06f'];
  const shapes = ['triangle', 'diamond', 'circle', 'square'];
  const id = raw.id || `q${Date.now().toString(36)}${index}`;
  const options = (raw.options || []).slice(0, 4).map((opt, idx) => ({
    id: opt.id || `${id}_o${idx + 1}`,
    text: String(opt.text || `Svar ${idx + 1}`).slice(0, 90),
    isCorrect: Boolean(opt.isCorrect),
    color: opt.color || palette[idx % palette.length],
    shape: opt.shape || shapes[idx % shapes.length],
  }));
  while (options.length < 4) {
    const idx = options.length;
    options.push({
      id: `${id}_o${idx + 1}`,
      text: `Svar ${idx + 1}`,
      isCorrect: false,
      color: palette[idx % palette.length],
      shape: shapes[idx % shapes.length],
    });
  }
  const hasAnyCorrect = options.some((o) => o.isCorrect);
  if (!hasAnyCorrect) options[0].isCorrect = true;

  return {
    id,
    prompt: String(raw.prompt || raw.question || `Sporgsmal ${index + 1}`).slice(0, 280),
    type: raw.type === 'multi' ? 'multi' : 'single',
    timeLimitSeconds: Math.max(5, Math.min(90, Number(raw.timeLimitSeconds || 20) || 20)),
    questionImageUrl: raw.questionImageUrl || '',
    revealImageUrl: raw.revealImageUrl || '',
    revealText: String(raw.revealText || '').slice(0, 400),
    enabled: raw.enabled !== false,
    options,
  };
}

function saveQuestions(doc) {
  fs.writeFileSync(QUESTIONS_FILE, JSON.stringify(doc, null, 2));
}

function parseQuestionsFromMarkdown(markdownText) {
  const lines = (markdownText || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => line !== '\uFFFC');

  const blocks = [];
  let current = [];
  for (const line of lines) {
    if (line === '---') {
      if (current.length) blocks.push(current), (current = []);
    } else {
      current.push(line);
    }
  }
  if (current.length) blocks.push(current);

  const questions = [];
  for (const block of blocks) {
    if (block.length < 2) continue;
    const prompt = block[0];
    const choicesRaw = block.slice(1).filter((v) => v);
    if (choicesRaw.length < 2) continue;
    const options = choicesRaw.slice(0, 4).map((choice, idx) => {
      const isCorrect = /\*$/.test(choice.trim());
      const clean = choice.replace(/\*+$/, '').trim();
      return {
        id: `q${questions.length + 1}o${idx + 1}`,
        text: clean,
        isCorrect,
      };
    });
    const correctCount = options.filter((o) => o.isCorrect).length;
    if (!correctCount) options[0].isCorrect = true;
    questions.push({
      id: `q${questions.length + 1}`,
      prompt,
      type: correctCount > 1 ? 'multi' : 'single',
      timeLimitSeconds: 20,
      questionImageUrl: '',
      revealImageUrl: '',
      revealText: '',
      enabled: true,
      options,
    });
  }
  return questions;
}

function createDefaultQuestionDoc() {
  return safeReadJson(QUESTIONS_FILE, {
    title: 'Nanna STORE Quiz til Marius',
    defaultTimeLimitSeconds: 20,
    questions: [],
  });
}

let questionDoc = createDefaultQuestionDoc();
if ((!questionDoc.questions || !questionDoc.questions.length) && fs.existsSync(ROOT_QUESTIONS_MD)) {
  const imported = parseQuestionsFromMarkdown(fs.readFileSync(ROOT_QUESTIONS_MD, 'utf8'));
  if (imported.length) {
    questionDoc.questions = imported.map(normalizeQuestion);
    saveQuestions(questionDoc);
  }
}
questionDoc.questions = (questionDoc.questions || []).map(normalizeQuestion);
saveQuestions(questionDoc);

const state = {
  phase: 'lobby',
  phaseEndsAt: null,
  questionOrder: [],
  questionPointer: -1,
  selectedQuestionCount: Math.max(1, Math.min(50, questionDoc.questions.length || 1)),
  activeQuestionId: null,
  round: {
    startedAt: null,
    answers: {},
    mariusAnswer: null,
    correctOptionIds: [],
    top3: [],
    huntPlayers: [],
  },
  players: {},
  knownGuests: {},
  finalTop4: [],
};

const savedState = safeReadJson(STATE_FILE, null);
if (savedState && savedState.players && savedState.knownGuests) {
  state.players = savedState.players;
  state.knownGuests = savedState.knownGuests;
}

function persistState() {
  const persisted = {
    players: state.players,
    knownGuests: state.knownGuests,
  };
  fs.writeFileSync(STATE_FILE, JSON.stringify(persisted, null, 2));
}

function sortedEnabledQuestions() {
  return questionDoc.questions.filter((q) => q.enabled !== false);
}

function getQuestionById(id) {
  return questionDoc.questions.find((q) => q.id === id) || null;
}

function currentQuestion() {
  if (!state.activeQuestionId) return null;
  return getQuestionById(state.activeQuestionId);
}

function makeSessionId(prefix = 'g') {
  return `${prefix}_${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
}

function computeLeaderboard() {
  return Object.entries(state.players)
    .map(([sessionId, p]) => ({
      sessionId,
      name: p.name,
      avatar: p.avatar,
      points: p.points || 0,
      correctCount: p.correctCount || 0,
      answeredCount: p.answeredCount || 0,
    }))
    .sort((a, b) => b.points - a.points || b.correctCount - a.correctCount || a.name.localeCompare(b.name));
}

function computeHuntPlayers(leaderboard) {
  if (!leaderboard.length) return [];
  const leaderPoints = leaderboard[0].points;
  return leaderboard.filter((p) => leaderPoints - p.points <= 800).slice(0, 6);
}

function concealQuestion(q, reveal = false) {
  if (!q) return null;
  return {
    id: q.id,
    prompt: q.prompt,
    type: q.type,
    timeLimitSeconds: q.timeLimitSeconds,
    questionImageUrl: q.questionImageUrl,
    revealImageUrl: reveal ? q.revealImageUrl : '',
    revealText: reveal ? q.revealText : '',
    options: q.options.map((opt) => ({
      id: opt.id,
      text: opt.text,
      color: opt.color,
      shape: opt.shape,
    })),
    ...(reveal ? { correctOptionIds: q.options.filter((o) => o.isCorrect).map((o) => o.id) } : {}),
  };
}

function publicView() {
  const q = currentQuestion();
  const reveal = state.phase === 'answer_reveal' || state.phase === 'scoreboard' || state.phase === 'finale';
  const leaderboard = computeLeaderboard();
  return {
    title: questionDoc.title || 'Nanna STORE Quiz til Marius',
    phase: state.phase,
    phaseEndsAt: state.phaseEndsAt,
    selectedQuestionCount: state.selectedQuestionCount,
    questionIndex: state.questionPointer + 1,
    totalQuestions: state.questionOrder.length || state.selectedQuestionCount,
    question: concealQuestion(q, reveal),
    connectedGuests: Object.keys(state.knownGuests).length,
    knownGuests: Object.values(state.knownGuests).sort((a, b) => a.joinedAt - b.joinedAt),
    round: {
      answersCount: Object.keys(state.round.answers).length,
      mariusAnswered: Boolean(state.round.mariusAnswer),
      mariusAnswer: reveal ? state.round.mariusAnswer : null,
      top3: state.round.top3,
      huntPlayers: state.round.huntPlayers,
    },
    leaderboardTop4: leaderboard.slice(0, 4),
    finalTop4: state.finalTop4,
  };
}

function hostView() {
  return {
    ...publicView(),
    questionBank: questionDoc.questions,
  };
}

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.json({ limit: '5mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(express.static(PUBLIC_DIR));

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOAD_DIR),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname || '.png') || '.png';
    cb(null, `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}${ext}`);
  },
});
const upload = multer({
  storage,
  limits: { fileSize: 8 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (!file.mimetype.startsWith('image/')) return cb(new Error('Kun billedfiler er tilladt'));
    cb(null, true);
  },
});

app.get('/screen', (_req, res) => res.sendFile(path.join(PUBLIC_DIR, 'screen.html')));
app.get('/host', (_req, res) => res.sendFile(path.join(PUBLIC_DIR, 'host.html')));
app.get('/play', (_req, res) => res.sendFile(path.join(PUBLIC_DIR, 'play.html')));
app.get('/marius', (_req, res) => res.sendFile(path.join(PUBLIC_DIR, 'marius.html')));
app.get('/', (_req, res) => res.redirect('/screen'));

app.get('/api/state', (_req, res) => res.json(publicView()));
app.get('/api/qr', async (req, res) => {
  const host = PUBLIC_BASE_URL || `${req.protocol}://${req.get('host')}`;
  const url = `${host}/play`;
  const dataUrl = await QRCode.toDataURL(url);
  res.json({ url, dataUrl });
});
app.get('/healthz', (_req, res) => res.json({ ok: true }));

app.post('/api/upload', upload.single('image'), (req, res) => {
  const pin = req.body.pin || req.headers['x-host-pin'];
  if (pin !== HOST_PIN) return res.status(403).json({ ok: false, error: 'Forkert host-PIN' });
  if (!req.file) return res.status(400).json({ ok: false, error: 'Mangler billedfil' });
  res.json({ ok: true, url: `/uploads/${req.file.filename}` });
});

let autoLockTimer = null;
function clearAutoLockTimer() {
  if (autoLockTimer) {
    clearTimeout(autoLockTimer);
    autoLockTimer = null;
  }
}

function startQuestionRound() {
  const questionId = state.questionOrder[state.questionPointer] || null;
  const q = getQuestionById(questionId);
  if (!q) return false;
  clearAutoLockTimer();
  state.phase = 'question_open';
  state.activeQuestionId = q.id;
  state.round = {
    startedAt: Date.now(),
    answers: {},
    mariusAnswer: null,
    correctOptionIds: q.options.filter((o) => o.isCorrect).map((o) => o.id).sort(),
    top3: [],
    huntPlayers: [],
  };
  state.phaseEndsAt = Date.now() + q.timeLimitSeconds * 1000;
  autoLockTimer = setTimeout(() => lockQuestionRound(), q.timeLimitSeconds * 1000);
  return true;
}

function normalizeSubmittedOptions(optionIds, q) {
  const raw = Array.isArray(optionIds) ? optionIds : [optionIds];
  const ids = Array.from(new Set(raw.map((v) => String(v))));
  const validIds = new Set(q.options.map((o) => o.id));
  return ids.filter((id) => validIds.has(id)).sort();
}

function isAnswerCorrect(submittedIds, correctIds) {
  if (submittedIds.length !== correctIds.length) return false;
  for (let i = 0; i < submittedIds.length; i += 1) {
    if (submittedIds[i] !== correctIds[i]) return false;
  }
  return true;
}

function lockQuestionRound() {
  if (state.phase !== 'question_open') return false;
  clearAutoLockTimer();
  state.phase = 'question_locked';
  state.phaseEndsAt = null;
  const q = currentQuestion();
  if (!q) return false;
  const correctIds = state.round.correctOptionIds.slice().sort();
  const roundDuration = q.timeLimitSeconds * 1000;
  for (const [sessionId, answer] of Object.entries(state.round.answers)) {
    const player = state.players[sessionId];
    if (!player) continue;
    const isCorrect = isAnswerCorrect(answer.optionIds, correctIds);
    const elapsed = Math.max(0, answer.submittedAt - state.round.startedAt);
    const speedRatio = Math.max(0, Math.min(1, 1 - elapsed / roundDuration));
    const points = isCorrect ? 1000 + Math.round(speedRatio * 500) : 0;
    answer.isCorrect = isCorrect;
    answer.points = points;
    player.answeredCount = (player.answeredCount || 0) + 1;
    if (isCorrect) player.correctCount = (player.correctCount || 0) + 1;
    player.points = (player.points || 0) + points;
  }
  persistState();
  return true;
}

function revealAnswer() {
  if (!['question_locked', 'question_open'].includes(state.phase)) return false;
  if (state.phase === 'question_open') lockQuestionRound();
  state.phase = 'answer_reveal';
  state.phaseEndsAt = null;
  const leaderboard = computeLeaderboard();
  state.round.top3 = leaderboard.slice(0, 3);
  state.round.huntPlayers = computeHuntPlayers(leaderboard);
  return true;
}

function showScoreboard() {
  if (!['answer_reveal', 'question_locked'].includes(state.phase)) return false;
  if (state.phase === 'question_locked') revealAnswer();
  state.phase = 'scoreboard';
  return true;
}

function openNextQuestion() {
  const enabled = sortedEnabledQuestions();
  if (!enabled.length) return { ok: false, error: 'Ingen aktive spørgsmål i banken' };
  if (!state.questionOrder.length) {
    state.questionOrder = enabled.slice(0, state.selectedQuestionCount).map((q) => q.id);
    state.questionPointer = -1;
  }
  if (state.questionPointer + 1 >= state.questionOrder.length) {
    state.phase = 'finale';
    state.phaseEndsAt = null;
    state.finalTop4 = computeLeaderboard().slice(0, 4);
    return { ok: true, finale: true };
  }
  state.questionPointer += 1;
  const ok = startQuestionRound();
  if (!ok) return { ok: false, error: 'Kunne ikke starte næste spørgsmål' };
  return { ok: true, finale: false };
}

function startGame(questionCount) {
  const enabled = sortedEnabledQuestions();
  if (!enabled.length) return { ok: false, error: 'Ingen spørgsmål er aktiveret' };
  const selectedCount = Math.max(1, Math.min(enabled.length, Number(questionCount) || state.selectedQuestionCount || enabled.length));
  state.selectedQuestionCount = selectedCount;
  state.questionOrder = enabled.slice(0, selectedCount).map((q) => q.id);
  state.questionPointer = -1;
  state.activeQuestionId = null;
  state.finalTop4 = [];
  for (const player of Object.values(state.players)) {
    player.points = 0;
    player.correctCount = 0;
    player.answeredCount = 0;
  }
  return openNextQuestion();
}

function resetGame() {
  clearAutoLockTimer();
  state.phase = 'lobby';
  state.phaseEndsAt = null;
  state.questionOrder = [];
  state.questionPointer = -1;
  state.activeQuestionId = null;
  state.round = {
    startedAt: null,
    answers: {},
    mariusAnswer: null,
    correctOptionIds: [],
    top3: [],
    huntPlayers: [],
  };
  state.finalTop4 = [];
  for (const player of Object.values(state.players)) {
    player.points = 0;
    player.correctCount = 0;
    player.answeredCount = 0;
  }
  persistState();
}

function broadcast() {
  io.to('screen').emit('state', publicView());
  io.to('play').emit('state', publicView());
  io.to('marius').emit('state', publicView());
  io.to('host').emit('state', hostView());
}

function requireHost(pin, socket) {
  if (pin !== HOST_PIN) {
    socket.emit('auth-error', { message: 'Forkert host-PIN' });
    return false;
  }
  return true;
}

io.on('connection', (socket) => {
  socket.on('hello', ({ as, pin } = {}) => {
    if (as === 'host') {
      if (!requireHost(pin, socket)) return;
      socket.join('host');
      socket.emit('state', hostView());
      return;
    }
    if (as === 'marius') {
      if (pin !== MARIUS_PIN) {
        socket.emit('auth-error', { message: 'Forkert Marius-PIN' });
        return;
      }
      socket.join('marius');
      socket.emit('state', publicView());
      return;
    }
    if (as === 'screen') {
      socket.join('screen');
      socket.emit('state', publicView());
      return;
    }
    socket.join('play');
    socket.emit('state', publicView());
  });

  socket.on('guest:identity', ({ sessionId, name, avatar } = {}) => {
    const id = String(sessionId || makeSessionId('g'));
    const safeName = String(name || 'Ukendt').trim().slice(0, 24) || 'Ukendt';
    const safeAvatar = String(avatar || '🎉').slice(0, 4);
    state.knownGuests[id] = {
      sessionId: id,
      name: safeName,
      avatar: safeAvatar,
      joinedAt: state.knownGuests[id]?.joinedAt || Date.now(),
    };
    state.players[id] = state.players[id] || { points: 0, correctCount: 0, answeredCount: 0 };
    state.players[id].name = safeName;
    state.players[id].avatar = safeAvatar;
    persistState();
    io.to('screen').emit('guest:ready', { name: safeName, avatar: safeAvatar });
    broadcast();
  });

  socket.on('guest:answer', ({ sessionId, optionIds } = {}) => {
    const q = currentQuestion();
    if (state.phase !== 'question_open' || !q) {
      socket.emit('guest:answer:result', { ok: false, error: 'Spørgsmålet er lukket' });
      return;
    }
    const id = String(sessionId || '').trim();
    if (!id) {
      socket.emit('guest:answer:result', { ok: false, error: 'Mangler sessionId' });
      return;
    }
    if (!state.players[id]) {
      socket.emit('guest:answer:result', { ok: false, error: 'Identitet mangler - vælg navn først' });
      return;
    }
    const submitted = normalizeSubmittedOptions(optionIds, q);
    if (!submitted.length) {
      socket.emit('guest:answer:result', { ok: false, error: 'Vælg mindst et svar' });
      return;
    }
    state.round.answers[id] = {
      optionIds: submitted,
      submittedAt: Date.now(),
      isCorrect: false,
      points: 0,
    };
    socket.emit('guest:answer:result', { ok: true });
    io.to('screen').emit('guest:joined', {
      name: state.players[id].name,
      avatar: state.players[id].avatar,
      isNew: true,
    });
    broadcast();
  });

  socket.on('marius:answer', ({ pin, optionIds } = {}) => {
    if (pin !== MARIUS_PIN) {
      socket.emit('auth-error', { message: 'Forkert Marius-PIN' });
      return;
    }
    const q = currentQuestion();
    if (state.phase !== 'question_open' || !q) {
      socket.emit('marius:answer:result', { ok: false, error: 'Spørgsmålet er lukket' });
      return;
    }
    const submitted = normalizeSubmittedOptions(optionIds, q);
    if (!submitted.length) {
      socket.emit('marius:answer:result', { ok: false, error: 'Vælg mindst et svar' });
      return;
    }
    state.round.mariusAnswer = {
      optionIds: submitted,
      submittedAt: Date.now(),
      isCorrect: isAnswerCorrect(submitted, state.round.correctOptionIds),
    };
    socket.emit('marius:answer:result', { ok: true });
    broadcast();
  });

  socket.on('host:set-question-count', ({ pin, count } = {}) => {
    if (!requireHost(pin, socket)) return;
    const enabled = sortedEnabledQuestions();
    state.selectedQuestionCount = Math.max(1, Math.min(enabled.length || 1, Number(count) || 1));
    socket.emit('host:set-question-count:result', { ok: true });
    broadcast();
  });

  socket.on('host:start', ({ pin, count } = {}) => {
    if (!requireHost(pin, socket)) return;
    const result = startGame(count);
    socket.emit('host:start:result', result);
    broadcast();
  });

  socket.on('host:lock', ({ pin } = {}) => {
    if (!requireHost(pin, socket)) return;
    const ok = lockQuestionRound();
    socket.emit('host:lock:result', { ok, error: ok ? null : 'Kan kun låse i spørgsmålsfasen' });
    broadcast();
  });

  socket.on('host:reveal', ({ pin } = {}) => {
    if (!requireHost(pin, socket)) return;
    const ok = revealAnswer();
    socket.emit('host:reveal:result', { ok, error: ok ? null : 'Kan kun afsløre efter spørgsmål er låst' });
    broadcast();
  });

  socket.on('host:show-scoreboard', ({ pin } = {}) => {
    if (!requireHost(pin, socket)) return;
    const ok = showScoreboard();
    socket.emit('host:show-scoreboard:result', { ok, error: ok ? null : 'Kan kun vise scoreboard efter reveal' });
    broadcast();
  });

  socket.on('host:next', ({ pin } = {}) => {
    if (!requireHost(pin, socket)) return;
    const result = openNextQuestion();
    socket.emit('host:next:result', result);
    broadcast();
  });

  socket.on('host:finish', ({ pin } = {}) => {
    if (!requireHost(pin, socket)) return;
    state.phase = 'finale';
    state.phaseEndsAt = null;
    state.finalTop4 = computeLeaderboard().slice(0, 4);
    socket.emit('host:finish:result', { ok: true });
    broadcast();
  });

  socket.on('host:reset', ({ pin } = {}) => {
    if (!requireHost(pin, socket)) return;
    resetGame();
    socket.emit('host:reset:result', { ok: true });
    broadcast();
  });

  socket.on('host:save-question', ({ pin, question } = {}) => {
    if (!requireHost(pin, socket)) return;
    if (!question || !question.prompt) {
      socket.emit('host:save-question:result', { ok: false, error: 'Spørgsmål mangler' });
      return;
    }
    const normalized = normalizeQuestion({
      ...question,
      id: question.id || `q${Date.now().toString(36)}`,
    }, questionDoc.questions.length);
    const idx = questionDoc.questions.findIndex((q) => q.id === normalized.id);
    if (idx >= 0) questionDoc.questions[idx] = normalized;
    else questionDoc.questions.push(normalized);
    saveQuestions(questionDoc);
    socket.emit('host:save-question:result', { ok: true, id: normalized.id });
    broadcast();
  });

  socket.on('host:delete-question', ({ pin, id } = {}) => {
    if (!requireHost(pin, socket)) return;
    questionDoc.questions = questionDoc.questions.filter((q) => q.id !== id);
    saveQuestions(questionDoc);
    socket.emit('host:delete-question:result', { ok: true });
    broadcast();
  });

  socket.on('host:import-questions-md', ({ pin } = {}) => {
    if (!requireHost(pin, socket)) return;
    if (!fs.existsSync(ROOT_QUESTIONS_MD)) {
      socket.emit('host:import-questions-md:result', { ok: false, error: 'Questions.md blev ikke fundet i roden' });
      return;
    }
    const parsed = parseQuestionsFromMarkdown(fs.readFileSync(ROOT_QUESTIONS_MD, 'utf8'));
    if (!parsed.length) {
      socket.emit('host:import-questions-md:result', { ok: false, error: 'Ingen gyldige spørgsmål fundet i Questions.md' });
      return;
    }
    questionDoc.questions = parsed.map(normalizeQuestion);
    saveQuestions(questionDoc);
    state.selectedQuestionCount = Math.min(state.selectedQuestionCount, sortedEnabledQuestions().length);
    socket.emit('host:import-questions-md:result', { ok: true, count: parsed.length });
    broadcast();
  });
});

broadcast();

server.listen(PORT, () => {
  console.log(`[quiz] Nanna STORE Quiz kører på http://localhost:${PORT}`);
  console.log(`[quiz] Host PIN: ${HOST_PIN} | Marius PIN: ${MARIUS_PIN}`);
});

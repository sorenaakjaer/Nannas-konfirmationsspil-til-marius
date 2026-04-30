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
/** Synthetic session id for konfirmant — merged into leaderboard / live podie, ikke en rigtig socket-spiller */
const CELEBRANT_SESSION_ID = '__celebrant__';
const PUBLIC_BASE_URL = process.env.PUBLIC_BASE_URL || null;

const ROOT_DIR = __dirname;
const DATA_DIR = path.join(ROOT_DIR, 'data');
const PUBLIC_DIR = path.join(ROOT_DIR, 'public');
const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');
const QUESTIONS_FILE = path.join(DATA_DIR, 'questions.json');
const CONFIG_FILE = path.join(DATA_DIR, 'config.json');
const STATE_FILE = path.join(DATA_DIR, 'state.json');
const ROOT_QUESTIONS_MD = path.join(ROOT_DIR, 'Questions.md');
const REVEAL_PHASE_MS = 5000;
const PRE_QUESTION_MS = 5000;

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

function normalizeConfig(raw) {
  const hostName = String(raw?.hostName || 'Nanna').trim() || 'Nanna';
  const celebrantName = String(raw?.celebrantName || 'Marius').trim() || 'Marius';
  const liveLine = String(raw?.liveLine || 'Live fra konfirmationen den 2. maj i Den Japanske Have').trim()
    || 'Live fra konfirmationen den 2. maj i Den Japanske Have';
  const backgroundImageUrl = String(raw?.backgroundImageUrl || '/reference_code/Marius%20konf-17.png').trim()
    || '/reference_code/Marius%20konf-17.png';
  const browserTitle = String(raw?.browserTitle || `${hostName} STORE Quiz til ${celebrantName}`).trim()
    || `${hostName} STORE Quiz til ${celebrantName}`;
  return { hostName, celebrantName, liveLine, backgroundImageUrl, browserTitle };
}

function brandHostText(name) {
  const trimmed = String(name || '').trim();
  if (!trimmed) return 'Nannas';
  return trimmed.endsWith('s') ? trimmed : `${trimmed}s`;
}

function normalizeQuestion(raw, index) {
  const palette = ['#ff4fa1', '#4666ff', '#ffad33', '#13a06f'];
  const shapes = ['triangle', 'diamond', 'circle', 'square'];
  const id = raw.id || `q${Date.now().toString(36)}${index}`;
  const options = (raw.options || []).slice(0, 8).map((opt, idx) => ({
    id: opt.id || `${id}_o${idx + 1}`,
    text: String(opt.text || `Svar ${idx + 1}`).slice(0, 90),
    isCorrect: Boolean(opt.isCorrect),
    color: opt.color || palette[idx % palette.length],
    shape: opt.shape || shapes[idx % shapes.length],
    imageUrl: String(opt.imageUrl || '').slice(0, 500),
  }));
  while (options.length < 2) {
    const idx = options.length;
    options.push({
      id: `${id}_o${idx + 1}`,
      text: `Svar ${idx + 1}`,
      isCorrect: false,
      color: palette[idx % palette.length],
      shape: shapes[idx % shapes.length],
      imageUrl: '',
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
    const options = choicesRaw.slice(0, 8).map((choice, idx) => {
      const isCorrect = /\*$/.test(choice.trim());
      const clean = choice.replace(/\*+$/, '').trim();
      return {
        id: `q${questions.length + 1}o${idx + 1}`,
        text: clean,
        isCorrect,
        imageUrl: '',
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
let configDoc = normalizeConfig(safeReadJson(CONFIG_FILE, {}));
if ((!questionDoc.questions || !questionDoc.questions.length) && fs.existsSync(ROOT_QUESTIONS_MD)) {
  const imported = parseQuestionsFromMarkdown(fs.readFileSync(ROOT_QUESTIONS_MD, 'utf8'));
  if (imported.length) {
    questionDoc.questions = imported.map(normalizeQuestion);
    saveQuestions(questionDoc);
  }
}
questionDoc.questions = (questionDoc.questions || []).map(normalizeQuestion);
saveQuestions(questionDoc);
fs.writeFileSync(CONFIG_FILE, JSON.stringify(configDoc, null, 2));

const state = {
  phase: 'lobby',
  lobbyView: 'intro',
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
    pointAwards: {},
  },
  players: {},
  knownGuests: {},
  finalTop4: [],
  celebrantPoints: 0,
  celebrantCorrectCount: 0,
  celebrantAnsweredCount: 0,
  celebrantStreak: 0,
};

const savedState = safeReadJson(STATE_FILE, null);
if (savedState) {
  if (savedState.players && savedState.knownGuests) {
    state.players = savedState.players;
    state.knownGuests = savedState.knownGuests;
  }
  if (Number.isFinite(savedState.selectedQuestionCount)) {
    state.selectedQuestionCount = Math.max(1, Math.min(questionDoc.questions.length || 1, Number(savedState.selectedQuestionCount)));
  }
  if (savedState.celebrantPoints != null) state.celebrantPoints = Number(savedState.celebrantPoints) || 0;
  if (savedState.celebrantCorrectCount != null) state.celebrantCorrectCount = Number(savedState.celebrantCorrectCount) || 0;
  if (savedState.celebrantAnsweredCount != null) state.celebrantAnsweredCount = Number(savedState.celebrantAnsweredCount) || 0;
  if (savedState.celebrantStreak != null) state.celebrantStreak = Number(savedState.celebrantStreak) || 0;
}

function persistState() {
  const persisted = {
    players: state.players,
    knownGuests: state.knownGuests,
    selectedQuestionCount: state.selectedQuestionCount,
    celebrantPoints: state.celebrantPoints,
    celebrantCorrectCount: state.celebrantCorrectCount,
    celebrantAnsweredCount: state.celebrantAnsweredCount,
    celebrantStreak: state.celebrantStreak,
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
  const celebrantName = String(configDoc.celebrantName || 'Marius').trim() || 'Marius';
  const rows = Object.entries(state.players)
    .map(([sessionId, p]) => ({
      sessionId,
      name: p.name,
      avatar: p.avatar,
      points: p.points || 0,
      correctCount: p.correctCount || 0,
      answeredCount: p.answeredCount || 0,
      streak: p.streak || 0,
      pointsDelta: state.round.pointAwards?.[sessionId]?.points || 0,
    }));
  const includeCelebrant =
    Object.keys(state.players).length > 0
    || (state.celebrantAnsweredCount || 0) > 0
    || (state.celebrantPoints || 0) > 0;
  if (includeCelebrant) {
    rows.push({
      sessionId: CELEBRANT_SESSION_ID,
      name: celebrantName,
      avatar: '👑',
      points: state.celebrantPoints || 0,
      correctCount: state.celebrantCorrectCount || 0,
      answeredCount: state.celebrantAnsweredCount || 0,
      streak: state.celebrantStreak || 0,
      pointsDelta: state.round.pointAwards?.[CELEBRANT_SESSION_ID]?.points || 0,
    });
  }
  return rows.sort((a, b) => b.points - a.points || b.correctCount - a.correctCount || a.name.localeCompare(b.name));
}

/** Top 4 kun blandt gæster — bruges til finale-podie (konfirmanten vises separat med 👑) */
function computeGuestTop4() {
  return computeLeaderboard().filter((p) => p.sessionId !== CELEBRANT_SESSION_ID).slice(0, 4);
}

/** Stor-skærm / spiller-podiet: konfirmant kun med i listen når samlet rang er 1–3 */
function leaderboardForSidebarPodium(maxEntries) {
  const ranked = computeLeaderboard();
  const ci = ranked.findIndex((p) => p.sessionId === CELEBRANT_SESSION_ID);
  if (ci === -1 || ci >= 3) {
    return ranked.filter((p) => p.sessionId !== CELEBRANT_SESSION_ID).slice(0, maxEntries);
  }
  return ranked.slice(0, maxEntries);
}

function computeHuntPlayers(leaderboard) {
  const guests = leaderboard.filter((p) => p.sessionId !== CELEBRANT_SESSION_ID);
  if (!guests.length) return [];
  const leaderPoints = guests[0].points;
  return guests.filter((p) => leaderPoints - p.points <= 800).slice(0, 6);
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
      imageUrl: opt.imageUrl || '',
    })),
    ...(reveal ? { correctOptionIds: q.options.filter((o) => o.isCorrect).map((o) => o.id) } : {}),
  };
}

function publicView() {
  configDoc = normalizeConfig(safeReadJson(CONFIG_FILE, configDoc));
  const q = currentQuestion();
  const reveal = state.phase === 'answer_reveal' || state.phase === 'scoreboard' || state.phase === 'finale';
  const answerEntries = Object.entries(state.round.answers || {});
  const guestCorrect = reveal ? answerEntries.filter(([, a]) => a.isCorrect).length : 0;
  const guestIncorrect = reveal ? answerEntries.filter(([, a]) => !a.isCorrect).length : 0;
  const maHit = reveal && state.round.mariusAnswer;
  const mariusCorrect = Boolean(maHit && state.round.mariusAnswer.isCorrect);
  const correctGuests = reveal ? guestCorrect + (maHit && mariusCorrect ? 1 : 0) : 0;
  const incorrectGuests = reveal ? guestIncorrect + (maHit && !mariusCorrect ? 1 : 0) : 0;
  return {
    config: {
      ...configDoc,
      hostBrandText: brandHostText(configDoc.hostName),
      quizTitle: `${brandHostText(configDoc.hostName)} STORE quiz til ${configDoc.celebrantName}`,
    },
    title: `${brandHostText(configDoc.hostName)} STORE quiz til ${configDoc.celebrantName}`,
    phase: state.phase,
    lobbyView: state.lobbyView,
    phaseEndsAt: state.phaseEndsAt,
    phaseDurationMs: state.phase === 'pre_question'
      ? PRE_QUESTION_MS
      : state.phase === 'question_open' && q
        ? q.timeLimitSeconds * 1000
        : 0,
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
      mariusCorrect: reveal ? Boolean(state.round.mariusAnswer?.isCorrect) : null,
      correctGuests: reveal ? correctGuests : 0,
      incorrectGuests: reveal ? incorrectGuests : 0,
      guestResults: reveal ? Object.fromEntries(
        Object.entries(state.round.answers || {}).map(([sessionId, answer]) => [
          sessionId,
          { isCorrect: Boolean(answer.isCorrect), points: Number(answer.points || 0) },
        ]),
      ) : {},
      top3: state.round.top3,
      huntPlayers: state.round.huntPlayers,
    },
    leaderboardTop4: leaderboardForSidebarPodium(4),
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
app.use('/uploads', express.static(UPLOAD_DIR));
app.use('/reference_code', express.static(path.join(ROOT_DIR, 'reference_code')));

app.get('/health', (_req, res) => {
  res.json({ ok: true, phase: state.phase, uptime: process.uptime() });
});

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
app.get('/konfirmant', (_req, res) => res.sendFile(path.join(PUBLIC_DIR, 'marius.html')));
app.get('/marius', (_req, res) => res.redirect('/konfirmant'));
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

app.post('/api/upload-avatar', upload.single('image'), (req, res) => {
  if (!req.file) return res.status(400).json({ ok: false, error: 'Mangler billedfil' });
  res.json({ ok: true, url: `/uploads/${req.file.filename}` });
});

let autoLockTimer = null;
let autoAdvanceTimer = null;
let autoQuestionStartTimer = null;
function clearAutoLockTimer() {
  if (autoLockTimer) {
    clearTimeout(autoLockTimer);
    autoLockTimer = null;
  }
}
function clearAutoAdvanceTimer() {
  if (autoAdvanceTimer) {
    clearTimeout(autoAdvanceTimer);
    autoAdvanceTimer = null;
  }
}
function clearAutoQuestionStartTimer() {
  if (autoQuestionStartTimer) {
    clearTimeout(autoQuestionStartTimer);
    autoQuestionStartTimer = null;
  }
}
function clearPhaseTimers() {
  clearAutoLockTimer();
  clearAutoAdvanceTimer();
  clearAutoQuestionStartTimer();
}
function scheduleQuestionTimeout(ms) {
  clearAutoLockTimer();
  autoLockTimer = setTimeout(() => {
    if (advanceToAnswerReveal()) broadcast();
  }, ms);
}
function scheduleScoreboardAuto(ms = REVEAL_PHASE_MS) {
  clearAutoAdvanceTimer();
  autoAdvanceTimer = setTimeout(() => {
    if (state.phase === 'answer_reveal') {
      state.phase = 'scoreboard';
      state.phaseEndsAt = null;
      broadcast();
    }
  }, ms);
}

function currentQueuedQuestion() {
  const questionId = state.questionOrder[state.questionPointer] || null;
  return getQuestionById(questionId);
}

function beginQuestionRound() {
  const q = currentQueuedQuestion();
  if (!q) return false;
  clearPhaseTimers();
  state.phase = 'question_open';
  state.activeQuestionId = q.id;
  state.round = {
    startedAt: Date.now(),
    answers: {},
    mariusAnswer: null,
    correctOptionIds: q.options.filter((o) => o.isCorrect).map((o) => o.id).sort(),
    top3: [],
    huntPlayers: [],
    pointAwards: {},
  };
  state.phaseEndsAt = Date.now() + q.timeLimitSeconds * 1000;
  scheduleQuestionTimeout(q.timeLimitSeconds * 1000);
  return true;
}

function queueQuestionRound() {
  const q = currentQueuedQuestion();
  if (!q) return false;
  clearPhaseTimers();
  state.phase = 'pre_question';
  state.activeQuestionId = q.id;
  state.phaseEndsAt = Date.now() + PRE_QUESTION_MS;
  autoQuestionStartTimer = setTimeout(() => {
    if (beginQuestionRound()) broadcast();
  }, PRE_QUESTION_MS);
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
    const previousStreak = player.streak || 0;
    const isCorrect = isAnswerCorrect(answer.optionIds, correctIds);
    const elapsed = Math.max(0, answer.submittedAt - state.round.startedAt);
    const speedRatio = Math.max(0, Math.min(1, 1 - elapsed / roundDuration));
    const points = isCorrect ? 1000 + Math.round(speedRatio * 500) : 0;
    answer.isCorrect = isCorrect;
    answer.points = points;
    player.answeredCount = (player.answeredCount || 0) + 1;
    if (isCorrect) player.correctCount = (player.correctCount || 0) + 1;
    player.points = (player.points || 0) + points;
    state.round.pointAwards[sessionId] = {
      points,
      isCorrect,
      prevPoints: player.points - points,
      prevAnsweredCount: player.answeredCount - 1,
      prevCorrectCount: isCorrect ? player.correctCount - 1 : player.correctCount,
      prevStreak: previousStreak,
    };
    player.streak = isCorrect ? (player.streak || 0) + 1 : 0;
  }
  const ma = state.round.mariusAnswer;
  if (ma && q) {
    const prevPoints = state.celebrantPoints || 0;
    const prevAnswered = state.celebrantAnsweredCount || 0;
    const prevCorrect = state.celebrantCorrectCount || 0;
    const previousStreak = state.celebrantStreak || 0;
    const isCorrect = isAnswerCorrect(ma.optionIds, correctIds);
    const elapsed = Math.max(0, ma.submittedAt - (state.round.startedAt || 0));
    const speedRatio = roundDuration > 0 ? Math.max(0, Math.min(1, 1 - elapsed / roundDuration)) : 1;
    const points = isCorrect ? 1000 + Math.round(speedRatio * 500) : 0;
    ma.isCorrect = isCorrect;
    ma.points = points;
    state.celebrantAnsweredCount = prevAnswered + 1;
    if (isCorrect) state.celebrantCorrectCount = prevCorrect + 1;
    state.celebrantPoints = prevPoints + points;
    state.round.pointAwards[CELEBRANT_SESSION_ID] = {
      points,
      isCorrect,
      prevPoints,
      prevAnsweredCount: prevAnswered,
      prevCorrectCount: prevCorrect,
      prevStreak: previousStreak,
    };
    state.celebrantStreak = isCorrect ? previousStreak + 1 : 0;
  }
  persistState();
  return true;
}

function rollbackCurrentRoundScores() {
  for (const [sessionId, award] of Object.entries(state.round.pointAwards || {})) {
    if (sessionId === CELEBRANT_SESSION_ID) {
      state.celebrantPoints = award.prevPoints ?? Math.max(0, (state.celebrantPoints || 0) - (award.points || 0));
      state.celebrantAnsweredCount = award.prevAnsweredCount ?? Math.max(0, (state.celebrantAnsweredCount || 0) - 1);
      state.celebrantCorrectCount = award.prevCorrectCount ?? Math.max(0, (state.celebrantCorrectCount || 0) - (award.isCorrect ? 1 : 0));
      state.celebrantStreak = award.prevStreak ?? 0;
      continue;
    }
    const player = state.players[sessionId];
    if (!player) continue;
    player.points = award.prevPoints ?? Math.max(0, (player.points || 0) - (award.points || 0));
    player.answeredCount = award.prevAnsweredCount ?? Math.max(0, (player.answeredCount || 0) - 1);
    player.correctCount = award.prevCorrectCount ?? Math.max(0, (player.correctCount || 0) - (award.isCorrect ? 1 : 0));
    player.streak = award.prevStreak ?? 0;
  }
  state.round.pointAwards = {};
  persistState();
}

function revealAnswer() {
  if (!['question_locked', 'question_open'].includes(state.phase)) return false;
  if (state.phase === 'question_open') lockQuestionRound();
  state.phase = 'answer_reveal';
  state.phaseEndsAt = null;
  const leaderboard = computeLeaderboard();
  state.round.top3 = leaderboardForSidebarPodium(3);
  state.round.huntPlayers = computeHuntPlayers(leaderboard);
  return true;
}

function advanceToAnswerReveal() {
  const ok = revealAnswer();
  if (!ok) return false;
  scheduleScoreboardAuto();
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
    clearPhaseTimers();
    state.phase = 'finale';
    state.phaseEndsAt = null;
    state.finalTop4 = computeGuestTop4();
    return { ok: true, finale: true };
  }
  state.questionPointer += 1;
  const ok = queueQuestionRound();
  if (!ok) return { ok: false, error: 'Kunne ikke starte næste spørgsmål' };
  return { ok: true, finale: false };
}

function startGame() {
  const enabled = sortedEnabledQuestions();
  if (!enabled.length) return { ok: false, error: 'Ingen spørgsmål er aktiveret' };
  const selectedCount = enabled.length;
  state.selectedQuestionCount = selectedCount;
  state.questionOrder = enabled.slice(0, selectedCount).map((q) => q.id);
  state.questionPointer = -1;
  state.activeQuestionId = null;
  state.finalTop4 = [];
  state.celebrantPoints = 0;
  state.celebrantCorrectCount = 0;
  state.celebrantAnsweredCount = 0;
  state.celebrantStreak = 0;
  for (const player of Object.values(state.players)) {
    player.points = 0;
    player.correctCount = 0;
    player.answeredCount = 0;
    player.streak = 0;
  }
  return openNextQuestion();
}

function resetGame() {
  clearPhaseTimers();
  state.phase = 'lobby';
  state.lobbyView = 'intro';
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
    pointAwards: {},
  };
  state.finalTop4 = [];
  state.celebrantPoints = 0;
  state.celebrantCorrectCount = 0;
  state.celebrantAnsweredCount = 0;
  state.celebrantStreak = 0;
  for (const player of Object.values(state.players)) {
    player.points = 0;
    player.correctCount = 0;
    player.answeredCount = 0;
    player.streak = 0;
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
    const rawAvatar = String(avatar || '🎉').trim();
    const safeAvatar = rawAvatar.startsWith('/uploads/') ? rawAvatar.slice(0, 500) : rawAvatar.slice(0, 4);
    state.knownGuests[id] = {
      sessionId: id,
      name: safeName,
      avatar: safeAvatar,
      joinedAt: state.knownGuests[id]?.joinedAt || Date.now(),
    };
    state.players[id] = state.players[id] || { points: 0, correctCount: 0, answeredCount: 0, streak: 0 };
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

  socket.on('host:start', ({ pin, count } = {}) => {
    if (!requireHost(pin, socket)) return;
    const result = startGame();
    socket.emit('host:start:result', result);
    broadcast();
  });

  socket.on('host:show-qr', ({ pin } = {}) => {
    if (!requireHost(pin, socket)) return;
    state.lobbyView = 'qr';
    socket.emit('host:show-qr:result', { ok: true });
    broadcast();
  });

  socket.on('host:show-intro', ({ pin } = {}) => {
    if (!requireHost(pin, socket)) return;
    state.lobbyView = 'intro';
    socket.emit('host:show-intro:result', { ok: true });
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

  socket.on('host:restart-current', ({ pin } = {}) => {
    if (!requireHost(pin, socket)) return;
    if (state.questionPointer < 0 || !state.questionOrder.length) {
      socket.emit('host:restart-current:result', { ok: false, error: 'Intet aktivt spørgsmål at starte forfra' });
      return;
    }
    if (state.round.pointAwards && Object.keys(state.round.pointAwards).length) {
      rollbackCurrentRoundScores();
    }
    state.round = {
      startedAt: 0,
      answers: {},
      mariusAnswer: null,
      correctOptionIds: [],
      top3: state.round.top3 || [],
      huntPlayers: [],
      pointAwards: {},
    };
    const ok = queueQuestionRound();
    socket.emit('host:restart-current:result', { ok, error: ok ? null : 'Kunne ikke starte spørgsmålet forfra' });
    broadcast();
  });

  socket.on('host:add-time', ({ pin, extraSeconds } = {}) => {
    if (!requireHost(pin, socket)) return;
    const extra = Math.max(1, Math.min(60, Number(extraSeconds) || 10));
    if (state.phase === 'question_open' && state.phaseEndsAt) {
      const remaining = Math.max(0, state.phaseEndsAt - Date.now());
      state.phaseEndsAt = Date.now() + remaining + extra * 1000;
      scheduleQuestionTimeout(remaining + extra * 1000);
      socket.emit('host:add-time:result', { ok: true, extraSeconds: extra, phase: 'question_open' });
      broadcast();
      return;
    }
    if (state.phase === 'pre_question' && state.phaseEndsAt) {
      const remaining = Math.max(0, state.phaseEndsAt - Date.now());
      state.phaseEndsAt = Date.now() + remaining + extra * 1000;
      clearAutoQuestionStartTimer();
      autoQuestionStartTimer = setTimeout(() => {
        if (beginQuestionRound()) broadcast();
      }, remaining + extra * 1000);
      socket.emit('host:add-time:result', { ok: true, extraSeconds: extra, phase: 'pre_question' });
      broadcast();
      return;
    }
    if (state.phase === 'question_locked' || state.phase === 'answer_reveal' || state.phase === 'scoreboard') {
      if (state.round.pointAwards && Object.keys(state.round.pointAwards).length) {
        rollbackCurrentRoundScores();
      }
      clearPhaseTimers();
      state.phase = 'question_open';
      state.phaseEndsAt = Date.now() + extra * 1000;
      scheduleQuestionTimeout(extra * 1000);
      socket.emit('host:add-time:result', { ok: true, extraSeconds: extra, phase: 'reopened' });
      broadcast();
      return;
    }
    socket.emit('host:add-time:result', { ok: false, error: 'Ingen aktiv runde at give mere tid til' });
  });

  socket.on('host:finish', ({ pin } = {}) => {
    if (!requireHost(pin, socket)) return;
    state.phase = 'finale';
    state.phaseEndsAt = null;
    state.finalTop4 = computeGuestTop4();
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

  socket.on('host:save-config', ({ pin, config } = {}) => {
    if (!requireHost(pin, socket)) return;
    configDoc = normalizeConfig(config || {});
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(configDoc, null, 2));
    socket.emit('host:save-config:result', { ok: true });
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

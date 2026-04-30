/**
 * Alle mod Emil — live quiz server
 *
 * Round phases:
 *   idle      -> game not started yet (or between rounds)
 *   question  -> question revealed; Emil AND guests can submit (in parallel)
 *   closed    -> submissions closed; host enters facit
 *   answer    -> facit + Emil's guess revealed; suspense before full reveal
 *   reveal    -> full breakdown (chart + winner banner)
 *   gameover  -> all rounds done, final scoreboard
 */

const path = require('path');
const fs = require('fs');
const http = require('http');
const express = require('express');
const QRCode = require('qrcode');
const { Server } = require('socket.io');

const PORT = process.env.PORT || 3333;
const PUBLIC_BASE_URL = process.env.PUBLIC_BASE_URL || null;
const HOST_PIN = process.env.HOST_PIN || '1234';
const EMIL_PIN = process.env.EMIL_PIN || '0000';

const DATA_DIR = path.join(__dirname, 'data');
const QUESTIONS_FILE = path.join(DATA_DIR, 'questions.json');
const STATE_FILE = path.join(DATA_DIR, 'state.json');

const questions = JSON.parse(fs.readFileSync(QUESTIONS_FILE, 'utf8'));

/* ---------------------------- Game state ---------------------------- */

function freshRoundState() {
  return {
    phase: 'idle',
    phaseEndsAt: null,    // ms timestamp when 'question' phase auto-closes
    lockSeconds: null,    // total seconds for the timer (for client display)
    emilAnswer: null,
    emilLockedAt: null,
    correctAnswer: null,
    guestAnswers: [], // { sessionId, name, avatar, value, ts }
    winner: null,
    stats: null,
  };
}

let autoCloseTimer = null; // setTimeout handle for auto-closing the question phase
let loadTestStatus = {
  running: false,
  startedAt: null,
  finishedAt: null,
  target: null,
  mode: null,
  total: 0,
  connected: 0,
  identified: 0,
  submitAcks: 0,
  errors: 0,
  latestPhase: null,
  latestGuestCount: null,
};

// All guests who have set an identity (name + avatar). Kept across rounds —
// these are the "ready to play" people shown on the front page.
// sessionId -> { name, avatar, joinedAt }
const knownGuests = new Map();

function knownGuestList() {
  return Array.from(knownGuests.values())
    .sort((a, b) => a.joinedAt - b.joinedAt)
    .map((g) => ({ name: g.name, avatar: g.avatar }));
}

function registerGuestIdentity(sessionId, name, avatar) {
  if (!sessionId) return;
  const trimmed = (name || '').toString().trim();
  const cleanName = (trimmed || 'Ukendt').slice(0, 24);
  const cleanAvatar = (avatar || '🎭').toString().slice(0, 4);
  const existing = knownGuests.get(sessionId);
  knownGuests.set(sessionId, {
    name: cleanName,
    avatar: cleanAvatar,
    joinedAt: existing ? existing.joinedAt : Date.now(),
  });
}

let state = {
  currentRoundIndex: -1,
  emilCandy: 0,
  guestsCandy: 0,
  totalCandy: questions.totalCandy,
  rewardLadder: questions.rewardLadder,
  totalRounds: questions.rounds.length,
  history: [],
  round: freshRoundState(),
};

try {
  if (fs.existsSync(STATE_FILE)) {
    const saved = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
    state = { ...state, ...saved };
    console.log('[state] restored from', STATE_FILE);
  }
} catch (e) {
  console.warn('[state] could not restore:', e.message);
}

function persist() {
  try {
    fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
  } catch (e) {
    console.warn('[state] could not persist:', e.message);
  }
}

function persistQuestions() {
  try {
    fs.writeFileSync(QUESTIONS_FILE, JSON.stringify(questions, null, 2));
    // keep derived state in sync
    state.totalCandy = questions.totalCandy;
    state.rewardLadder = questions.rewardLadder;
    state.totalRounds = questions.rounds.length;
    persist();
  } catch (e) {
    console.warn('[questions] could not persist:', e.message);
  }
}

/* ---------------------------- Helpers ---------------------------- */

function currentQuestion() {
  if (state.currentRoundIndex < 0 || state.currentRoundIndex >= questions.rounds.length) {
    return null;
  }
  return questions.rounds[state.currentRoundIndex];
}

function questionBankView() {
  return questions.rounds.map((q) => ({
    id: q.id,
    title: q.title,
    reward: q.reward,
    question: q.question,
    unit: q.unit,
    min: q.min ?? null,
    max: q.max ?? null,
    lockSeconds: q.lockSeconds ?? questions.defaultLockSeconds ?? 60,
    hint: q.hint ?? '',
  }));
}

function normalizeRoundInteger(rawValue, kind = 'tal') {
  const q = currentQuestion();
  const value = Number(rawValue);
  if (!Number.isFinite(value)) {
    return { ok: false, error: `Ugyldigt ${kind}` };
  }
  if (!Number.isInteger(value)) {
    return { ok: false, error: `${kind[0].toUpperCase() + kind.slice(1)} skal være et helt tal` };
  }
  if (q && q.min != null && value < q.min) {
    return { ok: false, error: `${kind[0].toUpperCase() + kind.slice(1)} skal være mindst ${q.min}` };
  }
  if (q && q.max != null && value > q.max) {
    return { ok: false, error: `${kind[0].toUpperCase() + kind.slice(1)} skal være højst ${q.max}` };
  }
  return { ok: true, value };
}

function publicView() {
  const q = currentQuestion();
  const phase = state.round.phase;
  const showEmilAnswer = phase === 'answer' || phase === 'reveal' || phase === 'gameover';
  const showCorrect = phase === 'answer' || phase === 'reveal' || phase === 'gameover';
  const showFullStats = phase === 'reveal' || phase === 'gameover';

  return {
    currentRoundIndex: state.currentRoundIndex,
    totalRounds: state.totalRounds,
    totalCandy: state.totalCandy,
    rewardLadder: state.rewardLadder,
    emilCandy: state.emilCandy,
    guestsCandy: state.guestsCandy,
    history: state.history,
    connectedGuests: (io.sockets.adapter.rooms.get('play')?.size) || 0,
    connectedEmil: (io.sockets.adapter.rooms.get('emil')?.size) > 0,
    knownGuests: knownGuestList(),
    question: q
      ? {
          id: q.id,
          title: q.title,
          reward: q.reward,
          question: q.question,
          unit: q.unit,
          min: q.min ?? null,
          max: q.max ?? null,
          hint: q.hint,
        }
      : null,
    round: {
      phase,
      phaseEndsAt: state.round.phaseEndsAt,
      lockSeconds: state.round.lockSeconds,
      emilAnswered: state.round.emilAnswer !== null,
      emilLocked: state.round.emilAnswer !== null,
      emilAnswer: showEmilAnswer ? state.round.emilAnswer : null,
      correctAnswer: showCorrect ? state.round.correctAnswer : null,
      guestCount: state.round.guestAnswers.length,
      answeredGuests: state.round.guestAnswers.map((g) => ({ name: g.name, avatar: g.avatar })),
      guestAnswers: showFullStats
        ? state.round.guestAnswers.map((g) => ({ name: g.name, avatar: g.avatar, value: g.value }))
        : [],
      winner: state.round.winner,
      stats: state.round.stats,
    },
  };
}

function emilView() {
  const pub = publicView();
  pub.round.emilAnswer = state.round.emilAnswer;
  return pub;
}

function hostView() {
  return {
    ...publicView(),
    questionBank: questionBankView(),
    loadTestStatus,
    round: {
      phase: state.round.phase,
      emilAnswer: state.round.emilAnswer,
      correctAnswer: state.round.correctAnswer,
      guestCount: state.round.guestAnswers.length,
      guestAnswers: state.round.guestAnswers.map((g) => ({
        name: g.name,
        avatar: g.avatar,
        value: g.value,
        sessionId: g.sessionId,
      })),
      winner: state.round.winner,
      stats: state.round.stats,
    },
  };
}

function broadcast() {
  io.to('screen').emit('state', publicView());
  io.to('play').emit('state', publicView());
  io.to('emil').emit('state', emilView());
  io.to('host').emit('state', hostView());
}

function resetLoadTestStatus(target, total) {
  loadTestStatus = {
    running: true,
    startedAt: Date.now(),
    finishedAt: null,
    target,
    mode: null,
    total,
    connected: 0,
    identified: 0,
    submitAcks: 0,
    errors: 0,
    latestPhase: null,
    latestGuestCount: null,
  };
  broadcast();
}

function finishLoadTest() {
  loadTestStatus.running = false;
  loadTestStatus.finishedAt = Date.now();
  broadcast();
}

function makeLoadTestName(i) {
  const names = [
    'Mormor Inger', 'Morfar Erik', 'Onkel Jens', 'Tante Lise',
    'Faster Hanne', 'Moster Pia', 'Kusine Anna', 'Fætter Mads',
    'Ven Sofie', 'Ven Jonas', 'Nabo Karen', 'Nabo Ole',
  ];
  return `${names[i % names.length]} ${i + 1}`;
}

function makeLoadTestAvatar(i) {
  const avatars = ['🐶','🐱','🐰','🦊','🐻','🐼','🐨','🦁','🐵','🐸','🦄','🐧'];
  return avatars[i % avatars.length];
}

async function runLoadTest({ baseUrl, total = 100, spreadMs = 30, mode = 'internal' }) {
  if (loadTestStatus.running) {
    return { ok: false, error: 'En loadtest kører allerede' };
  }
  resetLoadTestStatus(baseUrl, total);
  loadTestStatus.mode = mode;

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  (async () => {
    try {
      // SAFE MODE: simulate the same application work without opening 100
      // actual client sockets inside the same tiny Render Free instance.
      // This stresses the quiz logic/state/broadcast path without self-DDoSing.
      const batchSize = Math.max(5, Math.min(20, Math.floor(1000 / Math.max(10, spreadMs))));
      for (let i = 0; i < total; i += batchSize) {
        const upper = Math.min(total, i + batchSize);
        for (let j = i; j < upper; j++) {
          const sessionId = `render_loadtest_${Date.now()}_${j}`;
          const name = makeLoadTestName(j);
          const avatar = makeLoadTestAvatar(j);
          loadTestStatus.connected++;
          registerGuestIdentity(sessionId, name, avatar);
          loadTestStatus.identified++;

          if (state.round.phase === 'question') {
            const q = currentQuestion() || {};
            const min = Number.isInteger(q.min) ? q.min : 1;
            const max = Number.isInteger(q.max) ? q.max : min + 100;
            const span = Math.max(1, max - min + 1);
            const value = min + (j % span);
            const r = submitGuest(sessionId, name, avatar, value);
            if (r.ok) loadTestStatus.submitAcks++;
            else loadTestStatus.errors++;
          }
        }
        loadTestStatus.latestPhase = state.round.phase;
        loadTestStatus.latestGuestCount = state.round.guestAnswers.length;
        broadcast();
        await sleep(Math.max(50, spreadMs * batchSize));
      }
    } finally {
      finishLoadTest();
    }
  })();

  return { ok: true };
}

function median(values) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

function computeStats(correct, emil, guests) {
  const values = guests.map((g) => g.value);
  if (!values.length) {
    return {
      count: 0,
      avg: null,
      median: null,
      min: null,
      max: null,
      emilDist: emil !== null ? Math.abs(emil - correct) : null,
      guestsDist: null,
    };
  }
  const sum = values.reduce((a, b) => a + b, 0);
  const avg = sum / values.length;
  return {
    count: values.length,
    avg,
    median: median(values),
    min: Math.min(...values),
    max: Math.max(...values),
    emilDist: emil !== null ? Math.abs(emil - correct) : null,
    guestsDist: Math.abs(avg - correct),
  };
}

function determineWinner(stats) {
  // Tie-breaker rule: at exact tie OR when both distances round to the same
  // whole number, Emil wins. (Hjemmebanefordel til konfirmanden.)
  if (!stats || stats.count === 0) return 'emil';
  if (stats.emilDist === null) return 'guests';
  const emilRound = Math.round(stats.emilDist);
  const guestsRound = Math.round(stats.guestsDist);
  if (emilRound === guestsRound) return 'emil';
  return stats.emilDist < stats.guestsDist ? 'emil' : 'guests';
}

/* ---------------------------- HTTP setup ---------------------------- */

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// Trust the first reverse proxy (Render, ngrok, Cloudflare, etc.) so
// req.protocol returns "https" and req.get('host') returns the public hostname.
app.set('trust proxy', 1);

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

app.get('/', (_req, res) => res.redirect('/screen'));
app.get('/screen', (_req, res) => res.sendFile(path.join(__dirname, 'public', 'screen.html')));
app.get('/host', (_req, res) => res.sendFile(path.join(__dirname, 'public', 'host.html')));
app.get('/emil', (_req, res) => res.sendFile(path.join(__dirname, 'public', 'emil.html')));
app.get('/play', (_req, res) => res.sendFile(path.join(__dirname, 'public', 'play.html')));
app.get('/loadtest', (_req, res) => res.sendFile(path.join(__dirname, 'public', 'loadtest.html')));

app.get('/api/qr', async (req, res) => {
  try {
    const target = guestUrl(req);
    const dataUrl = await QRCode.toDataURL(target, {
      margin: 1,
      width: 600,
      color: { dark: '#0b0220', light: '#ffffff' },
    });
    res.json({ url: target, dataUrl });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

function guestUrl(req) {
  if (PUBLIC_BASE_URL) return `${PUBLIC_BASE_URL.replace(/\/$/, '')}/play`;
  const host = req.get('host');
  const proto = req.protocol;
  return `${proto}://${host}/play`;
}

app.get('/api/state', (_req, res) => res.json(publicView()));
app.get('/healthz', (_req, res) => res.status(200).json({ ok: true }));

function requireHostHttp(req, res) {
  const pin = req.body?.pin || req.query?.pin || req.get('x-host-pin');
  if (pin !== HOST_PIN) {
    res.status(401).json({ ok: false, error: 'Forkert host-PIN' });
    return false;
  }
  return true;
}

app.get('/api/loadtest/status', (req, res) => {
  if (!requireHostHttp(req, res)) return;
  res.json({ ok: true, ...loadTestStatus });
});

app.post('/api/loadtest', async (req, res) => {
  if (!requireHostHttp(req, res)) return;
  const count = Math.min(200, Math.max(1, Number(req.body?.count || 100)));
  const spreadMs = Math.min(200, Math.max(0, Number(req.body?.spreadMs || 30)));
  const baseUrl = PUBLIC_BASE_URL || `${req.protocol}://${req.get('host')}`;
  const result = await runLoadTest({ baseUrl, total: count, spreadMs });
  if (!result.ok) {
    return res.status(409).json(result);
  }
  res.json({ ok: true, message: `Startede loadtest med ${count} brugere`, target: baseUrl });
});

/* ---------------------------- Game actions ---------------------------- */

function showQuestion() {
  if (state.currentRoundIndex < 0) state.currentRoundIndex = 0;
  state.round = freshRoundState();
  state.round.phase = 'question';

  // Set timer based on the question's lockSeconds (or global default)
  const q = currentQuestion();
  const lockSec = (q && q.lockSeconds) || questions.defaultLockSeconds || 60;
  state.round.lockSeconds = lockSec;
  state.round.phaseEndsAt = Date.now() + lockSec * 1000;

  // Auto-close when the timer runs out
  if (autoCloseTimer) clearTimeout(autoCloseTimer);
  autoCloseTimer = setTimeout(() => {
    if (state.round.phase === 'question') {
      state.round.phase = 'closed';
      state.round.phaseEndsAt = null;
      persist();
      broadcast();
    }
  }, lockSec * 1000);

  persist();
}

function lockEmil(value) {
  // Allowed during 'question' (Emil locks early) or 'closed' (auto-lock at timer end)
  if (!['question', 'closed'].includes(state.round.phase)) {
    return { ok: false, error: 'Forkert fase' };
  }
  const parsed = normalizeRoundInteger(value, 'svar');
  if (!parsed.ok) return parsed;
  state.round.emilAnswer = parsed.value;
  state.round.emilLockedAt = Date.now();
  persist();
  return { ok: true };
}

function submitGuest(sessionId, name, avatar, value) {
  if (state.round.phase !== 'question') return { ok: false, error: 'Afstemning er lukket' };
  const parsed = normalizeRoundInteger(value, 'gæt');
  if (!parsed.ok) return parsed;
  const trimmed = (name || '').toString().trim();
  const cleanName = (trimmed || 'Ukendt').slice(0, 24);
  const cleanAvatar = (avatar || '🎭').toString().slice(0, 4);
  const existing = state.round.guestAnswers.find((g) => g.sessionId === sessionId);
  const isNew = !existing;
  if (existing) {
    existing.value = parsed.value;
    existing.name = cleanName;
    existing.avatar = cleanAvatar;
    existing.ts = Date.now();
  } else {
    state.round.guestAnswers.push({
      sessionId,
      name: cleanName,
      avatar: cleanAvatar,
      value: parsed.value,
      ts: Date.now(),
    });
  }
  persist();
  return { ok: true, isNew };
}

function closeSubmissions() {
  if (state.round.phase !== 'question') return { ok: false, error: 'Forkert fase' };
  state.round.phase = 'closed';
  state.round.phaseEndsAt = null;
  if (autoCloseTimer) { clearTimeout(autoCloseTimer); autoCloseTimer = null; }
  persist();
  return { ok: true };
}

function setCorrectAnswer(correctAnswer) {
  // Allowed from 'closed' (and also from 'question' as a shortcut)
  if (!['question', 'closed'].includes(state.round.phase)) {
    return { ok: false, error: 'Forkert fase' };
  }
  const parsed = normalizeRoundInteger(correctAnswer, 'facit');
  if (!parsed.ok) return parsed;
  state.round.correctAnswer = parsed.value;
  state.round.phase = 'answer';
  persist();
  return { ok: true };
}

function updateQuestionConfig(roundIndex, payload = {}) {
  const idx = Number(roundIndex);
  if (!Number.isInteger(idx) || idx < 0 || idx >= questions.rounds.length) {
    return { ok: false, error: 'Ugyldig runde' };
  }

  const target = questions.rounds[idx];
  const updated = {
    ...target,
    title: String(payload.title ?? target.title).trim() || target.title,
    question: String(payload.question ?? target.question).trim() || target.question,
    unit: String(payload.unit ?? target.unit).trim() || target.unit,
    hint: String(payload.hint ?? target.hint ?? '').trim(),
  };

  const numericFields = ['reward', 'min', 'max', 'lockSeconds'];
  for (const field of numericFields) {
    const raw = payload[field];
    const value = Number(raw);
    if (!Number.isFinite(value) || !Number.isInteger(value)) {
      return { ok: false, error: `${field} skal være et helt tal` };
    }
    updated[field] = value;
  }

  if (updated.min > updated.max) {
    return { ok: false, error: 'Min må ikke være større end max' };
  }
  if (updated.reward < 0) {
    return { ok: false, error: 'reward skal være 0 eller højere' };
  }
  if (updated.lockSeconds < 5) {
    return { ok: false, error: 'lockSeconds skal være mindst 5 sekunder' };
  }

  questions.rounds[idx] = updated;
  questions.rewardLadder = questions.rounds.map((r) => r.reward);
  questions.totalCandy = questions.rewardLadder.reduce((sum, reward) => sum + reward, 0);
  persistQuestions();
  return { ok: true, question: updated };
}

function reveal() {
  if (state.round.phase !== 'answer') return { ok: false, error: 'Forkert fase' };
  state.round.stats = computeStats(
    state.round.correctAnswer,
    state.round.emilAnswer,
    state.round.guestAnswers
  );
  state.round.winner = determineWinner(state.round.stats);
  state.round.phase = 'reveal';

  const q = currentQuestion();
  const reward = q ? q.reward : 0;
  if (state.round.winner === 'emil') state.emilCandy += reward;
  else if (state.round.winner === 'guests') state.guestsCandy += reward;

  state.history.push({
    roundIndex: state.currentRoundIndex,
    question: q ? q.question : null,
    title: q ? q.title : null,
    unit: q ? q.unit : null,
    reward,
    emilAnswer: state.round.emilAnswer,
    correctAnswer: state.round.correctAnswer,
    winner: state.round.winner,
    stats: state.round.stats,
  });

  persist();
  return { ok: true };
}

function nextRound() {
  if (autoCloseTimer) { clearTimeout(autoCloseTimer); autoCloseTimer = null; }
  if (state.currentRoundIndex + 1 >= state.totalRounds) {
    state.round = freshRoundState();
    state.round.phase = 'gameover';
    persist();
    return { ok: true, gameover: true };
  }
  state.currentRoundIndex += 1;
  showQuestion();
  return { ok: true };
}

function resetGame() {
  if (autoCloseTimer) { clearTimeout(autoCloseTimer); autoCloseTimer = null; }
  state.currentRoundIndex = -1;
  state.emilCandy = 0;
  state.guestsCandy = 0;
  state.history = [];
  state.round = freshRoundState();
  knownGuests.clear();
  persist();
}

/* ---------------------------- Sockets ---------------------------- */

io.on('connection', (socket) => {
  let joinedAs = null;

  socket.on('hello', ({ as, pin } = {}) => {
    if (as === 'host') {
      if (pin !== HOST_PIN) {
        socket.emit('auth-error', { message: 'Forkert host-PIN' });
        return;
      }
      joinedAs = 'host';
      socket.join('host');
      socket.emit('state', hostView());
    } else if (as === 'emil') {
      if (pin !== EMIL_PIN) {
        socket.emit('auth-error', { message: 'Forkert PIN' });
        return;
      }
      joinedAs = 'emil';
      socket.join('emil');
      socket.emit('state', emilView());
      broadcast();
    } else if (as === 'screen') {
      joinedAs = 'screen';
      socket.join('screen');
      socket.emit('state', publicView());
    } else {
      joinedAs = 'play';
      socket.join('play');
      socket.emit('state', publicView());
      // A guest just joined — let the screen know so the idle counter updates
      broadcast();
    }
  });

  socket.on('disconnect', () => {
    if (joinedAs === 'play' || joinedAs === 'emil') {
      // Slight delay so the room count is accurate
      setTimeout(broadcast, 50);
    }
  });

  socket.on('emil:lock', ({ value, pin } = {}) => {
    if (pin !== EMIL_PIN) return socket.emit('auth-error', { message: 'Forkert PIN' });
    const result = lockEmil(Number(value));
    socket.emit('emil:lock:result', result);
    if (result.ok) {
      // Tell screen Emil locked (kahoot-style indicator)
      io.to('screen').emit('emil:locked');
      broadcast();
    }
  });

  socket.on('guest:submit', ({ sessionId, name, avatar, value } = {}) => {
    if (!sessionId) return socket.emit('guest:submit:result', { ok: false, error: 'Mangler session' });
    const result = submitGuest(sessionId, name, avatar, Number(value));
    socket.emit('guest:submit:result', result);
    if (result.ok) {
      registerGuestIdentity(sessionId, name, avatar);
      io.to('screen').emit('guest:joined', {
        name: (name || 'Ukendt').toString().slice(0, 24),
        avatar: (avatar || '🎭').toString().slice(0, 4),
        isNew: result.isNew,
      });
      broadcast();
    }
  });

  // Guests register their identity as soon as they pick a name+avatar
  // (even before they submit a guess). This lets the front-page waiting
  // room show them right away.
  socket.on('guest:identity', ({ sessionId, name, avatar } = {}) => {
    if (!sessionId) return;
    const isNew = !knownGuests.has(sessionId);
    registerGuestIdentity(sessionId, name, avatar);
    if (isNew) {
      io.to('screen').emit('guest:ready', {
        name: knownGuests.get(sessionId).name,
        avatar: knownGuests.get(sessionId).avatar,
      });
    }
    broadcast();
  });

  function requireHost(pin) {
    if (pin !== HOST_PIN) {
      socket.emit('auth-error', { message: 'Forkert host-PIN' });
      return false;
    }
    return true;
  }

  socket.on('host:show-question', ({ pin } = {}) => {
    if (!requireHost(pin)) return;
    showQuestion();
    broadcast();
  });

  socket.on('host:close', ({ pin } = {}) => {
    if (!requireHost(pin)) return;
    closeSubmissions();
    broadcast();
  });

  socket.on('host:set-correct', ({ pin, correctAnswer } = {}) => {
    if (!requireHost(pin)) return;
    const result = setCorrectAnswer(Number(correctAnswer));
    socket.emit('host:set-correct:result', result);
    if (result.ok) broadcast();
  });

  socket.on('host:update-question', ({ pin, roundIndex, question } = {}) => {
    if (!requireHost(pin)) return;
    const result = updateQuestionConfig(roundIndex, question);
    socket.emit('host:update-question:result', result);
    if (result.ok) broadcast();
  });

  socket.on('host:reveal', ({ pin } = {}) => {
    if (!requireHost(pin)) return;
    const result = reveal();
    socket.emit('host:reveal:result', result);
    if (result.ok) broadcast();
  });

  socket.on('host:next', ({ pin } = {}) => {
    if (!requireHost(pin)) return;
    nextRound();
    broadcast();
  });

  socket.on('host:reset', ({ pin } = {}) => {
    if (!requireHost(pin)) return;
    resetGame();
    broadcast();
  });

  socket.on('host:override-winner', ({ pin, winner } = {}) => {
    if (!requireHost(pin)) return;
    if (state.round.phase !== 'reveal') return;
    if (!['emil', 'guests', 'tie'].includes(winner)) return;
    const previous = state.round.winner;
    const q = currentQuestion();
    const reward = q ? q.reward : 0;
    if (previous === 'emil') state.emilCandy -= reward;
    else if (previous === 'guests') state.guestsCandy -= reward;
    state.round.winner = winner;
    if (winner === 'emil') state.emilCandy += reward;
    else if (winner === 'guests') state.guestsCandy += reward;
    const h = state.history[state.history.length - 1];
    if (h) h.winner = winner;
    persist();
    broadcast();
  });
});

server.listen(PORT, () => {
  console.log(`\n=== Alle mod Emil ===`);
  console.log(`Big screen   : http://localhost:${PORT}/screen`);
  console.log(`Host panel   : http://localhost:${PORT}/host    (PIN: ${HOST_PIN})`);
  console.log(`Emil's phone : http://localhost:${PORT}/emil    (PIN: ${EMIL_PIN})`);
  console.log(`Guest URL    : http://localhost:${PORT}/play`);
  console.log(`(Set PUBLIC_BASE_URL env var so QR code uses your public host)\n`);
});

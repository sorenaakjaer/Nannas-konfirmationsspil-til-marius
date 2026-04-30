const { io } = require("socket.io-client");

const BASE = process.env.TARGET_URL || "https://alle-mod-emil.onrender.com";
const TOTAL = Number(process.env.TOTAL_USERS || 100);
const sockets = [];
let connected = 0;
let identified = 0;
let submitAcks = 0;
let errors = 0;
let latestState = null;

function makeName(i) {
  const names = [
    "Mormor Inger", "Morfar Erik", "Onkel Jens", "Tante Lise",
    "Faster Hanne", "Moster Pia", "Kusine Anna", "Fætter Mads",
    "Ven Sofie", "Ven Jonas", "Nabo Karen", "Nabo Ole",
  ];
  return `${names[i % names.length]} ${i + 1}`;
}

function makeAvatar(i) {
  const avatars = ["🐶","🐱","🐰","🦊","🐻","🐼","🐨","🦁","🐵","🐸","🦄","🐧"];
  return avatars[i % avatars.length];
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  console.log(`Connecting ${TOTAL} simulated guests to ${BASE} ...`);

  for (let i = 0; i < TOTAL; i++) {
    const sessionId = `loadtest_${Date.now()}_${i}`;
    const name = makeName(i);
    const avatar = makeAvatar(i);
    const socket = io(BASE, {
      transports: ["websocket", "polling"],
      reconnection: false,
      timeout: 15000,
      forceNew: true,
    });

    socket.on("connect", () => {
      connected++;
      socket.emit("hello", { as: "play" });
      socket.emit("guest:identity", { sessionId, name, avatar });
      identified++;
    });

    socket.on("state", (s) => {
      latestState = s;
      if (s && s.round && s.round.phase === "question") {
        const q = s.question || {};
        const min = Number.isInteger(q.min) ? q.min : 1;
        const max = Number.isInteger(q.max) ? q.max : min + 100;
        const span = Math.max(1, max - min + 1);
        const value = min + (i % span);
        socket.emit("guest:submit", { sessionId, name, avatar, value });
      }
    });

    socket.on("guest:submit:result", (r) => {
      if (r && r.ok) submitAcks++;
      else errors++;
    });

    socket.on("connect_error", (e) => {
      errors++;
      console.log(`connect_error[${i}]: ${e.message}`);
    });

    socket.on("auth-error", (e) => {
      errors++;
      console.log(`auth_error[${i}]: ${JSON.stringify(e)}`);
    });

    sockets.push(socket);
    await sleep(30);
  }

  await sleep(15000);

  const summary = {
    connected,
    identified,
    submitAcks,
    errors,
    latestPhase: latestState?.round?.phase ?? null,
    knownGuests: latestState?.knownGuests?.length ?? null,
    connectedGuests: latestState?.connectedGuests ?? null,
    guestCountInRound: latestState?.round?.guestCount ?? null,
  };

  console.log("--- Load test summary ---");
  console.log(JSON.stringify(summary, null, 2));

  sockets.forEach((s) => { try { s.close(); } catch {} });
  await sleep(1000);
})();

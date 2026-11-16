import createFBNeoModule from "./wasm/kof98_fbneo.js";

const BTN = {
  UP: 0, DOWN: 1, LEFT: 2, RIGHT: 3,
  B1: 4, B2: 5, B3: 6, B4: 7,
  START: 10, COIN: 11, SERVICE: 12,
};

// Bit positions matching fbw_set_input_mask in wasm/fbneo_wasm.cpp
const MASK_BITS = [
  BTN.UP, BTN.DOWN, BTN.LEFT, BTN.RIGHT,
  BTN.B1, BTN.B2, BTN.B3, BTN.B4,
  BTN.START, BTN.COIN,
];

const CACHE_NAME = "kof98party-roms-v1";
const PEER_PREFIX = "kof98party-";
const ICE_SERVERS = [
  { urls: "stun:stun.l.google.com:19302" },
  { urls: "stun:stun1.l.google.com:19302" },
  { urls: "stun:stun.cloudflare.com:3478" },
];

// DOM
const canvas = document.getElementById("screen");
const ctx = canvas.getContext("2d", { alpha: false });
const remoteVideo = document.getElementById("remoteVideo");
const overlay = document.getElementById("overlay");
const lobbyPanel = document.getElementById("lobbyPanel");
const loadingPanel = document.getElementById("loadingPanel");
const overlayMsg = document.getElementById("overlayMsg");
const progressBar = document.getElementById("progressBar");
const romPicker = document.getElementById("romPicker");
const inputNeoZip = document.getElementById("inputNeoZip");
const inputKofZip = document.getElementById("inputKofZip");
const btnRetryLoad = document.getElementById("btnRetryLoad");

const statsEl = document.getElementById("stats");
const netBadge = document.getElementById("netBadge");
const nickInput = document.getElementById("nickInput");
const modeSelect = document.getElementById("modeSelect");
const roomCodeInput = document.getElementById("roomCodeInput");
const btnPlaySolo = document.getElementById("btnPlaySolo");
const btnCreateRoom = document.getElementById("btnCreateRoom");
const btnJoinRoom = document.getElementById("btnJoinRoom");

const roomInfoBar = document.getElementById("roomInfoBar");
const roomCodeText = document.getElementById("roomCodeText");
const roomModeText = document.getElementById("roomModeText");
const roomStatusText = document.getElementById("roomStatusText");
const pingText = document.getElementById("pingText");
const delaySelect = document.getElementById("delaySelect");
const delayWrap = document.getElementById("delayWrap");
const btnCopyCode = document.getElementById("btnCopyCode");
const btnCopyLink = document.getElementById("btnCopyLink");
const btnResync = document.getElementById("btnResync");
const btnLeaveRoom = document.getElementById("btnLeaveRoom");

const chatSection = document.getElementById("chatSection");
const chatLog = document.getElementById("chatLog");
const chatForm = document.getElementById("chatForm");
const chatInput = document.getElementById("chatInput");

const btnPause = document.getElementById("btnPause");
const btnReset = document.getElementById("btnReset");
const btnCoin = document.getElementById("btnCoin");
const btnStart = document.getElementById("btnStart");
const btnTest = document.getElementById("btnTest");
const btnSaveState = document.getElementById("btnSaveState");
const btnLoadState = document.getElementById("btnLoadState");
const btnMute = document.getElementById("btnMute");
const btnFullscreen = document.getElementById("btnFullscreen");
const volSlider = document.getElementById("volSlider");

// Emulator state
let Module = null;
let coreReady = false;
let rgbaPtr = 0;
let imgData = null;
let width = 304;
let height = 224;
let targetFps = 59.1856;
let running = false;
let paused = false;
let muted = false;
let volume = 0.8;
let rafStarted = false;

// Audio state
let audioCtx = null;
let scriptNode = null;
let streamDest = null;
let srcSampleRate = 48000;
const RING_CAP = 16384;
const ringL = new Float32Array(RING_CAP);
const ringR = new Float32Array(RING_CAP);
let ringRead = 0;
let ringWrite = 0;
let ringCount = 0;
let resamplePos = 0;

// Input state
const keyHeld = new Set();
const touchHeld = new Set(); // button indices held via on-screen buttons

// Netplay state
const net = {
  role: "solo", // "solo" | "host" | "guest"
  mode: "sync", // "sync" | "stream"
  roomCode: "",
  peer: null,
  conn: null,
  mediaCall: null,
  connected: false,
  synced: false,
  frame: 0,
  delay: 2,
  localInputs: new Map(),
  remoteInputs: new Map(),
  remoteMaskStream: 0,
  lastSentStreamMask: -1,
  lastResendAt: 0,
  pingMs: null,
  pingTimer: null,
  remoteNick: "",
  myNick: localStorage.getItem("kof98party_nick") || `Jogador-${Math.random().toString(36).slice(2, 6).toUpperCase()}`,
};

nickInput.value = net.myNick;
nickInput.addEventListener("change", () => {
  net.myNick = nickInput.value.trim() || "Jogador";
  localStorage.setItem("kof98party_nick", net.myNick);
});

// Pre-fill ?room= from URL
const urlParams = new URLSearchParams(window.location.search);
const initialRoom = urlParams.get("room");
if (initialRoom) {
  roomCodeInput.value = normalizeRoomCode(initialRoom);
}

function normalizeRoomCode(raw) {
  const s = (raw || "").trim();
  const m = s.match(/[?&]room=([A-Za-z0-9_-]+)/);
  const code = (m ? m[1] : s).toUpperCase().replace(/[^A-Z0-9-]/g, "");
  return code;
}

function randomRoomCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let out = "KOF-";
  for (let i = 0; i < 4; i++) out += chars[Math.floor(Math.random() * chars.length)];
  return out;
}

function appendChat(sender, text, isSystem = false) {
  const div = document.createElement("div");
  div.className = isSystem ? "chat-line sys" : "chat-line";
  if (isSystem) {
    div.textContent = text;
  } else {
    const strong = document.createElement("strong");
    strong.textContent = `${sender}: `;
    div.appendChild(strong);
    div.appendChild(document.createTextNode(text));
  }
  chatLog.appendChild(div);
  chatLog.scrollTop = chatLog.scrollHeight;
}

function setBadge(text, cls = "") {
  netBadge.textContent = text;
  netBadge.className = `badge ${cls}`.trim();
}

function pushAudio(int16Arr, frames) {
  for (let i = 0; i < frames; i++) {
    if (ringCount >= RING_CAP) {
      ringRead = (ringRead + 1) % RING_CAP;
      ringCount--;
    }
    ringL[ringWrite] = int16Arr[i * 2] / 32768.0;
    ringR[ringWrite] = int16Arr[i * 2 + 1] / 32768.0;
    ringWrite = (ringWrite + 1) % RING_CAP;
    ringCount++;
  }
}

function clearAudioRing() {
  ringRead = 0;
  ringWrite = 0;
  ringCount = 0;
  resamplePos = 0;
}

function initAudio() {
  if (audioCtx) {
    if (audioCtx.state === "suspended") audioCtx.resume();
    return;
  }
  const AC = window.AudioContext || window.webkitAudioContext;
  audioCtx = new AC();
  scriptNode = audioCtx.createScriptProcessor(1024, 0, 2);
  const step = srcSampleRate / audioCtx.sampleRate;
  scriptNode.onaudioprocess = (ev) => {
    const outL = ev.outputBuffer.getChannelData(0);
    const outR = ev.outputBuffer.getChannelData(1);
    const gain = muted ? 0 : volume;
    const len = outL.length;

    if (ringCount < 2 || paused || (net.role === "guest" && net.mode === "stream")) {
      outL.fill(0);
      outR.fill(0);
      return;
    }

    if (Math.abs(step - 1.0) < 0.001) {
      for (let i = 0; i < len; i++) {
        if (ringCount > 0) {
          outL[i] = ringL[ringRead] * gain;
          outR[i] = ringR[ringRead] * gain;
          ringRead = (ringRead + 1) % RING_CAP;
          ringCount--;
        } else {
          outL[i] = 0;
          outR[i] = 0;
        }
      }
    } else {
      for (let i = 0; i < len; i++) {
        const idx0 = Math.floor(resamplePos);
        const frac = resamplePos - idx0;
        if (idx0 + 1 < ringCount) {
          const p0 = (ringRead + idx0) % RING_CAP;
          const p1 = (ringRead + idx0 + 1) % RING_CAP;
          outL[i] = (ringL[p0] + (ringL[p1] - ringL[p0]) * frac) * gain;
          outR[i] = (ringR[p0] + (ringR[p1] - ringR[p0]) * frac) * gain;
          resamplePos += step;
        } else {
          outL[i] = 0;
          outR[i] = 0;
        }
      }
      const consumed = Math.min(ringCount, Math.floor(resamplePos));
      ringRead = (ringRead + consumed) % RING_CAP;
      ringCount -= consumed;
      resamplePos -= consumed;
    }
  };
  scriptNode.connect(audioCtx.destination);
  if (audioCtx.createMediaStreamDestination) {
    streamDest = audioCtx.createMediaStreamDestination();
    scriptNode.connect(streamDest);
  }
}

async function fetchCachedWithProgress(url, label, basePct, spanPct) {
  if ("caches" in window) {
    try {
      const cache = await caches.open(CACHE_NAME);
      const cached = await cache.match(url);
      if (cached && cached.ok) {
        progressBar.style.width = `${basePct + spanPct}%`;
        overlayMsg.textContent = `${label} (cache local)...`;
        return new Uint8Array(await cached.arrayBuffer());
      }
    } catch {
      // ignore Cache API restriction
    }
  }

  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`HTTP ${resp.status} ao baixar ${url}`);

  const total = Number(resp.headers.get("content-length") || 0);
  let out;
  if (!resp.body || !total) {
    out = new Uint8Array(await resp.arrayBuffer());
    progressBar.style.width = `${basePct + spanPct}%`;
  } else {
    const reader = resp.body.getReader();
    const chunks = [];
    let received = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      received += value.length;
      const pct = basePct + Math.round((received / total) * spanPct);
      progressBar.style.width = `${pct}%`;
      overlayMsg.textContent = `${label} (${(received / 1048576).toFixed(1)} / ${(total / 1048576).toFixed(1)} MB)...`;
    }
    out = new Uint8Array(received);
    let off = 0;
    for (const c of chunks) {
      out.set(c, off);
      off += c.length;
    }
  }

  if ("caches" in window) {
    try {
      const cache = await caches.open(CACHE_NAME);
      await cache.put(url, new Response(out.slice().buffer, {
        headers: { "Content-Type": "application/zip" },
      }));
    } catch {
      // ignore quota/cache errors
    }
  }
  return out;
}

async function ensureEmulatorLoaded() {
  if (coreReady) {
    initAudio();
    return;
  }

  lobbyPanel.style.display = "none";
  loadingPanel.style.display = "flex";
  romPicker.style.display = "none";
  progressBar.style.width = "5%";
  overlayMsg.textContent = "Carregando núcleo WebAssembly...";

  if (!Module) {
    Module = await createFBNeoModule();
    Module.FS.mkdirTree("/roms");
    Module.FS.mkdirTree("/config/games");
    Module.FS.mkdirTree("/states");
  }

  let neoZip;
  if (inputNeoZip.files?.[0]) {
    neoZip = new Uint8Array(await inputNeoZip.files[0].arrayBuffer());
  } else {
    try {
      neoZip = await fetchCachedWithProgress("./neogeo.zip", "Baixando BIOS (neogeo.zip)", 10, 10);
    } catch {
      romPicker.style.display = "flex";
      throw new Error("neogeo.zip não encontrado no servidor. Selecione os arquivos abaixo.");
    }
  }
  Module.FS.writeFile("/roms/neogeo.zip", neoZip);

  let kofZip;
  if (inputKofZip.files?.[0]) {
    kofZip = new Uint8Array(await inputKofZip.files[0].arrayBuffer());
  } else {
    try {
      kofZip = await fetchCachedWithProgress("./kof98.zip", "Baixando KOF '98 (kof98.zip)", 20, 70);
    } catch {
      romPicker.style.display = "flex";
      throw new Error("kof98.zip não encontrado no servidor. Selecione os arquivos abaixo.");
    }
  }
  Module.FS.writeFile("/roms/kof98.zip", kofZip);

  overlayMsg.textContent = "Inicializando hardware Neo Geo...";
  progressBar.style.width = "95%";

  Module._fbw_init();
  let rc = Module.ccall("fbw_load", "number", ["string"], ["kof98h"]);
  if (rc !== 0) {
    rc = Module.ccall("fbw_load", "number", ["string"], ["kof98"]);
  }
  if (rc !== 0) {
    throw new Error(`Falha ao carregar driver KOF '98 (código ${rc}).`);
  }

  width = Module._fbw_get_width() || 304;
  height = Module._fbw_get_height() || 224;
  const fpsRaw = Module._fbw_get_fps() || 5918;
  targetFps = fpsRaw / 100.0;
  srcSampleRate = Module._fbw_get_audio_rate() || 48000;

  canvas.width = width;
  canvas.height = height;
  imgData = ctx.createImageData(width, height);
  if (!rgbaPtr) rgbaPtr = Module._malloc(width * height * 4);

  initAudio();
  progressBar.style.width = "100%";
  coreReady = true;
}

function enableGameControls(enabled, isOnlineGuest = false) {
  for (const b of [btnCoin, btnStart, btnSaveState, btnLoadState]) {
    b.disabled = !enabled || (isOnlineGuest && (b === btnSaveState || b === btnLoadState));
  }
  btnPause.disabled = !enabled || isOnlineGuest;
  btnReset.disabled = !enabled || isOnlineGuest;
  btnTest.disabled = !enabled || isOnlineGuest;
}

// Keyboard bindings
const PRIMARY_KEYS = {
  KeyW: BTN.UP,
  KeyS: BTN.DOWN,
  KeyA: BTN.LEFT,
  KeyD: BTN.RIGHT,
  ArrowUp: BTN.UP,
  ArrowDown: BTN.DOWN,
  ArrowLeft: BTN.LEFT,
  ArrowRight: BTN.RIGHT,
  KeyU: BTN.B1,
  KeyI: BTN.B2,
  KeyJ: BTN.B3,
  KeyK: BTN.B4,
  KeyZ: BTN.B1,
  KeyX: BTN.B2,
  KeyC: BTN.B3,
  KeyV: BTN.B4,
  Digit1: BTN.START,
  Enter: BTN.START,
  Digit5: BTN.COIN,
};

const P2_LOCAL_KEYS = {
  Numpad8: BTN.UP,
  Numpad2: BTN.DOWN,
  Numpad4: BTN.LEFT,
  Numpad6: BTN.RIGHT,
  Numpad7: BTN.B1,
  Numpad9: BTN.B2,
  Numpad1: BTN.B3,
  Numpad3: BTN.B4,
  Digit2: BTN.START,
  Digit6: BTN.COIN,
};

window.addEventListener("keydown", (e) => {
  if (document.activeElement === chatInput || document.activeElement === roomCodeInput || document.activeElement === nickInput) {
    return;
  }
  if (e.code === "F2" && running && net.role !== "guest" && Module) {
    e.preventDefault();
    Module._fbw_set_input(0, BTN.SERVICE, 1);
    return;
  }
  if (PRIMARY_KEYS[e.code] !== undefined || P2_LOCAL_KEYS[e.code] !== undefined) {
    if (running) e.preventDefault();
    keyHeld.add(e.code);
  }
});

window.addEventListener("keyup", (e) => {
  if (e.code === "F2" && running && net.role !== "guest" && Module) {
    e.preventDefault();
    Module._fbw_set_input(0, BTN.SERVICE, 0);
    return;
  }
  keyHeld.delete(e.code);
});

window.addEventListener("blur", () => {
  keyHeld.clear();
  touchHeld.clear();
});

function readGamepadMask(padIdx) {
  if (!navigator.getGamepads) return 0;
  const gp = navigator.getGamepads()[padIdx];
  if (!gp) return 0;
  const axX = gp.axes[0] || 0;
  const axY = gp.axes[1] || 0;
  const pressed = {
    [BTN.UP]: !!(gp.buttons[12]?.pressed || axY < -0.4),
    [BTN.DOWN]: !!(gp.buttons[13]?.pressed || axY > 0.4),
    [BTN.LEFT]: !!(gp.buttons[14]?.pressed || axX < -0.4),
    [BTN.RIGHT]: !!(gp.buttons[15]?.pressed || axX > 0.4),
    [BTN.B1]: !!gp.buttons[2]?.pressed,
    [BTN.B2]: !!gp.buttons[0]?.pressed,
    [BTN.B3]: !!gp.buttons[3]?.pressed,
    [BTN.B4]: !!gp.buttons[1]?.pressed,
    [BTN.COIN]: !!gp.buttons[8]?.pressed,
    [BTN.START]: !!gp.buttons[9]?.pressed,
  };
  let mask = 0;
  for (let i = 0; i < MASK_BITS.length; i++) {
    if (pressed[MASK_BITS[i]]) mask |= (1 << i);
  }
  return mask;
}

function getPrimaryInputMask() {
  let mask = readGamepadMask(0);
  for (const code of keyHeld) {
    const btn = PRIMARY_KEYS[code];
    if (btn !== undefined) {
      const bit = MASK_BITS.indexOf(btn);
      if (bit >= 0) mask |= (1 << bit);
    }
  }
  for (const btn of touchHeld) {
    const bit = MASK_BITS.indexOf(btn);
    if (bit >= 0) mask |= (1 << bit);
  }
  return mask;
}

function getLocalP2Mask() {
  let mask = readGamepadMask(1);
  for (const code of keyHeld) {
    const btn = P2_LOCAL_KEYS[code];
    if (btn !== undefined) {
      const bit = MASK_BITS.indexOf(btn);
      if (bit >= 0) mask |= (1 << bit);
    }
  }
  return mask;
}

// On-screen buttons
function bindHoldButton(el, btn, isService = false) {
  const down = (e) => {
    e.preventDefault();
    if (!running) return;
    if (isService) {
      if (net.role !== "guest" && Module) Module._fbw_set_input(0, BTN.SERVICE, 1);
    } else {
      touchHeld.add(btn);
    }
  };
  const up = () => {
    if (isService) {
      if (net.role !== "guest" && Module) Module._fbw_set_input(0, BTN.SERVICE, 0);
    } else {
      touchHeld.delete(btn);
    }
  };
  el.addEventListener("pointerdown", down);
  el.addEventListener("pointerup", up);
  el.addEventListener("pointerleave", up);
  el.addEventListener("pointercancel", up);
}

bindHoldButton(btnCoin, BTN.COIN);
bindHoldButton(btnStart, BTN.START);
bindHoldButton(btnTest, BTN.SERVICE, true);

// Mobile arcade pad buttons
for (const el of document.querySelectorAll("[data-btn]")) {
  const b = BTN[el.dataset.btn];
  if (b !== undefined) bindHoldButton(el, b);
}

btnPause.addEventListener("click", () => {
  if (net.role === "guest") return;
  paused = !paused;
  btnPause.textContent = paused ? "Retomar" : "Pausar";
});

btnReset.addEventListener("click", () => {
  if (net.role === "guest" || !Module || !running) return;
  Module._fbw_reset();
  if (net.role === "host" && net.connected && net.mode === "sync") {
    sendSyncSnapshot();
  }
});

btnMute.addEventListener("click", () => {
  muted = !muted;
  remoteVideo.muted = muted;
  btnMute.textContent = muted ? "Ativar Som" : "Mudo";
});

volSlider.addEventListener("input", () => {
  volume = Number(volSlider.value);
  remoteVideo.volume = volume;
});

btnFullscreen.addEventListener("click", () => {
  const st = document.getElementById("stage");
  if (!document.fullscreenElement) st.requestFullscreen?.();
  else document.exitFullscreen?.();
});

const STATE_PATH = "/states/kof98.fs";
btnSaveState.addEventListener("click", () => {
  if (!Module || !running || net.role === "guest") return;
  const rc = Module.ccall("fbw_save_state", "number", ["string"], [STATE_PATH]);
  if (rc === 0) {
    const data = Module.FS.readFile(STATE_PATH);
    try {
      let bin = "";
      for (let i = 0; i < data.length; i += 0x8000) {
        bin += String.fromCharCode(...data.subarray(i, i + 0x8000));
      }
      localStorage.setItem("kof98_savestate", btoa(bin));
      statsEl.textContent = `Estado salvo (${(data.length / 1024).toFixed(0)} KB)`;
    } catch {
      statsEl.textContent = "Estado salvo na memória da sessão.";
    }
  }
});

btnLoadState.addEventListener("click", () => {
  if (!Module || !running || net.role === "guest") return;
  const saved = localStorage.getItem("kof98_savestate");
  if (saved) {
    const bin = atob(saved);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    Module.FS.writeFile(STATE_PATH, bytes);
  }
  try {
    const rc = Module.ccall("fbw_load_state", "number", ["string"], [STATE_PATH]);
    if (rc === 0 && net.role === "host" && net.connected && net.mode === "sync") {
      sendSyncSnapshot();
    }
    statsEl.textContent = rc === 0 ? "Estado carregado!" : "Nenhum estado salvo.";
  } catch {
    statsEl.textContent = "Nenhum estado salvo.";
  }
});

// ========================
// NETPLAY (PeerJS WebRTC)
// ========================

function resetNetQueues(startFrame, delay) {
  net.frame = startFrame;
  net.delay = delay;
  net.localInputs.clear();
  net.remoteInputs.clear();
  for (let i = 0; i < delay; i++) {
    net.localInputs.set(startFrame + i, 0);
    net.remoteInputs.set(startFrame + i, 0);
  }
}

function sendSyncSnapshot() {
  if (!Module || !net.conn || !net.conn.open) return;
  const syncPath = "/states/net_sync.fs";
  const rc = Module.ccall("fbw_save_state", "number", ["string"], [syncPath]);
  if (rc !== 0) return;
  const stateBytes = Module.FS.readFile(syncPath);
  const f = net.frame;
  const d = Number(delaySelect.value) || 2;
  resetNetQueues(f, d);
  net.synced = true;
  clearAudioRing();
  net.conn.send({
    t: "sync",
    f,
    delay: d,
    state: stateBytes.slice().buffer,
  });
  appendChat("Sistema", `Sincronizando partida no frame ${f} (delay ${d}f)...`, true);
}

function startPingLoop() {
  stopPingLoop();
  net.pingTimer = setInterval(() => {
    if (net.conn && net.conn.open) {
      net.conn.send({ t: "ping", ts: performance.now() });
    }
  }, 2000);
}

function stopPingLoop() {
  if (net.pingTimer) {
    clearInterval(net.pingTimer);
    net.pingTimer = null;
  }
  net.pingMs = null;
  pingText.textContent = "-- ms";
}

function cleanupNetwork(backToLobby = false) {
  stopPingLoop();
  try { net.mediaCall?.close(); } catch {}
  try { net.conn?.close(); } catch {}
  try { net.peer?.destroy(); } catch {}
  net.mediaCall = null;
  net.conn = null;
  net.peer = null;
  net.connected = false;
  net.synced = false;
  net.remoteMaskStream = 0;
  net.remoteNick = "";
  net.role = "solo";

  remoteVideo.srcObject = null;
  remoteVideo.style.display = "none";
  canvas.style.display = "block";

  roomInfoBar.style.display = "none";
  chatSection.style.display = "none";
  setBadge("Offline / Local");

  if (backToLobby) {
    running = false;
    overlay.classList.remove("hidden");
    lobbyPanel.style.display = "flex";
    loadingPanel.style.display = "none";
    enableGameControls(false);
  } else if (coreReady) {
    enableGameControls(true, false);
  }
}

function wireDataConnection(conn) {
  net.conn = conn;
  conn.on("open", () => {
    net.connected = true;
    startPingLoop();
    conn.send({ t: "hello", nick: net.myNick, mode: net.mode });

    if (net.role === "host") {
      roomStatusText.textContent = "Jogador 2 conectando...";
      setBadge("Online • Host (P1)", "online");
    } else {
      roomStatusText.textContent = "Conectado ao Host!";
      setBadge("Online • Player 2", "online");
    }
  });

  conn.on("data", (msg) => {
    if (!msg || typeof msg !== "object") return;
    switch (msg.t) {
      case "hello": {
        net.remoteNick = msg.nick || (net.role === "host" ? "Jogador 2" : "Host");
        if (net.role === "guest" && msg.mode) {
          net.mode = msg.mode;
          roomModeText.textContent = net.mode === "sync" ? "Sync P2P (Inputs)" : "Stream P2P (Vídeo)";
          delayWrap.style.display = net.mode === "sync" ? "inline-flex" : "none";
        }
        roomStatusText.textContent = `Jogando com ${net.remoteNick}`;
        appendChat("Sistema", `${net.remoteNick} entrou na sala!`, true);
        if (net.role === "guest") {
          onGuestHandshake();
        }
        break;
      }
      case "ready_sync": {
        if (net.role === "host" && net.mode === "sync") {
          sendSyncSnapshot();
        }
        break;
      }
      case "ready_stream": {
        if (net.role === "host" && net.mode === "stream") {
          startHostStream();
        }
        break;
      }
      case "sync": {
        if (net.role !== "guest" || !Module) return;
        const syncPath = "/states/net_sync.fs";
        const bytes = new Uint8Array(msg.state);
        Module.FS.writeFile(syncPath, bytes);
        const rc = Module.ccall("fbw_load_state", "number", ["string"], [syncPath]);
        if (rc === 0) {
          resetNetQueues(msg.f, msg.delay);
          net.synced = true;
          clearAudioRing();
          delaySelect.value = String(msg.delay);
          conn.send({ t: "sync_ack", f: msg.f });
          appendChat("Sistema", `Sincronizado no frame ${msg.f} (delay ${msg.delay}f). Bom jogo!`, true);
        }
        break;
      }
      case "sync_ack": {
        appendChat("Sistema", `${net.remoteNick || "Jogador 2"} sincronizado!`, true);
        break;
      }
      case "i": {
        net.remoteInputs.set(msg.f, msg.m | 0);
        break;
      }
      case "si": {
        if (net.role === "host") {
          net.remoteMaskStream = msg.m | 0;
        }
        break;
      }
      case "h": {
        if (net.role === "guest" && Module && net.synced && msg.f === net.frame) {
          const localH = Module._fbw_ram_hash() >>> 0;
          if (localH !== (msg.h >>> 0)) {
            conn.send({ t: "desync", f: net.frame });
          }
        }
        break;
      }
      case "desync": {
        if (net.role === "host" && net.mode === "sync") {
          appendChat("Sistema", `Dessincronização detectada no frame ${msg.f}; ressincronizando...`, true);
          sendSyncSnapshot();
        }
        break;
      }
      case "chat": {
        appendChat(msg.nick || "Amigo", msg.text);
        break;
      }
      case "ping": {
        conn.send({ t: "pong", ts: msg.ts });
        break;
      }
      case "pong": {
        net.pingMs = Math.max(1, Math.round(performance.now() - msg.ts));
        pingText.textContent = `${net.pingMs} ms`;
        break;
      }
    }
  });

  conn.on("close", () => {
    stopPingLoop();
    net.connected = false;
    net.synced = false;
    net.remoteMaskStream = 0;
    appendChat("Sistema", `${net.remoteNick || "O outro jogador"} saiu da sala.`, true);
    if (net.role === "host") {
      roomStatusText.textContent = "Aguardando outro jogador...";
      setBadge("Online • Aguardando P2", "waiting");
    } else {
      roomStatusText.textContent = "Desconectado do Host.";
      setBadge("Desconectado", "");
    }
  });
}

async function onGuestHandshake() {
  if (net.mode === "sync") {
    try {
      await ensureEmulatorLoaded();
      overlay.classList.add("hidden");
      canvas.style.display = "block";
      remoteVideo.style.display = "none";
      enableGameControls(true, true);
      running = true;
      startMainLoop();
      net.conn?.send({ t: "ready_sync" });
    } catch (err) {
      overlayMsg.textContent = `Erro: ${err.message}`;
      loadingPanel.style.display = "flex";
    }
  } else {
    overlay.classList.add("hidden");
    canvas.style.display = "none";
    remoteVideo.style.display = "block";
    remoteVideo.muted = muted;
    remoteVideo.volume = volume;
    enableGameControls(true, true);
    running = true;
    startMainLoop();
    net.conn?.send({ t: "ready_stream" });
  }
}

function startHostStream() {
  if (!net.peer || !net.conn) return;
  const videoStream = canvas.captureStream ? canvas.captureStream(60) : null;
  if (!videoStream) {
    appendChat("Sistema", "Seu navegador não suporta canvas.captureStream.", true);
    return;
  }
  const tracks = [...videoStream.getVideoTracks()];
  if (streamDest) {
    tracks.push(...streamDest.stream.getAudioTracks());
  }
  const combined = new MediaStream(tracks);
  const call = net.peer.call(net.conn.peer, combined);
  net.mediaCall = call;
  appendChat("Sistema", "Stream P2P de vídeo e áudio iniciado!", true);
}

function showRoomBar(code) {
  roomInfoBar.style.display = "flex";
  chatSection.style.display = "flex";
  roomCodeText.textContent = code;
  roomModeText.textContent = net.mode === "sync" ? "Sync P2P (Inputs)" : "Stream P2P (Vídeo)";
  delayWrap.style.display = net.mode === "sync" ? "inline-flex" : "none";
  btnResync.style.display = net.role === "host" && net.mode === "sync" ? "inline-block" : "none";
  delaySelect.disabled = net.role === "guest";

  const inviteUrl = new URL(window.location.href);
  inviteUrl.searchParams.set("room", code);
  window.history.replaceState({}, "", inviteUrl.toString());
}

async function startSolo() {
  cleanupNetwork(false);
  net.role = "solo";
  try {
    await ensureEmulatorLoaded();
    overlay.classList.add("hidden");
    canvas.style.display = "block";
    remoteVideo.style.display = "none";
    enableGameControls(true, false);
    running = true;
    startMainLoop();
  } catch (err) {
    console.error(err);
    overlayMsg.textContent = `Erro: ${err.message}`;
  }
}

async function createRoom() {
  if (typeof window.Peer !== "function") {
    alert("PeerJS não foi carregado.");
    return;
  }
  cleanupNetwork(false);
  net.role = "host";
  net.mode = modeSelect.value;
  net.delay = Number(delaySelect.value) || 2;
  net.myNick = nickInput.value.trim() || net.myNick;

  try {
    await ensureEmulatorLoaded();
    overlay.classList.add("hidden");
    canvas.style.display = "block";
    remoteVideo.style.display = "none";
    enableGameControls(true, false);
    running = true;
    startMainLoop();
  } catch (err) {
    console.error(err);
    overlayMsg.textContent = `Erro: ${err.message}`;
    return;
  }

  const code = randomRoomCode();
  net.roomCode = code;
  showRoomBar(code);
  chatLog.innerHTML = "";
  roomStatusText.textContent = "Registrando sala online...";
  setBadge("Online • Criando sala...", "waiting");

  const peer = new window.Peer(PEER_PREFIX + code, {
    config: { iceServers: ICE_SERVERS },
  });
  net.peer = peer;

  peer.on("open", () => {
    roomStatusText.textContent = "Aguardando jogador 2 entrar pelo código ou link...";
    setBadge("Online • Aguardando P2", "waiting");
    appendChat("Sistema", `Sala ${code} criada! Envie o link ou código para seu amigo.`, true);
  });

  peer.on("connection", (conn) => {
    if (net.conn && net.conn.open) {
      conn.close();
      return;
    }
    wireDataConnection(conn);
  });

  peer.on("error", (err) => {
    console.error("PeerJS host error:", err);
    roomStatusText.textContent = `Erro de rede: ${err.type || err.message}`;
    appendChat("Sistema", `Erro P2P: ${err.type || err.message}`, true);
  });
}

async function joinRoom() {
  if (typeof window.Peer !== "function") {
    alert("PeerJS não foi carregado.");
    return;
  }
  const code = normalizeRoomCode(roomCodeInput.value);
  if (!code) {
    alert("Digite o código da sala para entrar.");
    roomCodeInput.focus();
    return;
  }

  cleanupNetwork(false);
  net.role = "guest";
  net.roomCode = code;
  net.myNick = nickInput.value.trim() || net.myNick;

  lobbyPanel.style.display = "none";
  loadingPanel.style.display = "flex";
  romPicker.style.display = "none";
  progressBar.style.width = "10%";
  overlayMsg.textContent = `Conectando à sala ${code}...`;

  showRoomBar(code);
  chatLog.innerHTML = "";
  roomStatusText.textContent = `Conectando à sala ${code}...`;
  setBadge("Conectando...", "waiting");

  const peer = new window.Peer({
    config: { iceServers: ICE_SERVERS },
  });
  net.peer = peer;

  peer.on("open", () => {
    const conn = peer.connect(PEER_PREFIX + code, { reliable: true });
    wireDataConnection(conn);
  });

  peer.on("call", (call) => {
    net.mediaCall = call;
    call.answer();
    call.on("stream", (remoteStream) => {
      remoteVideo.srcObject = remoteStream;
      remoteVideo.play().catch(() => {});
      appendChat("Sistema", "Recebendo vídeo e áudio da partida!", true);
    });
  });

  peer.on("error", (err) => {
    console.error("PeerJS guest error:", err);
    const msg = err.type === "peer-unavailable"
      ? `Sala "${code}" não encontrada ou já foi encerrada.`
      : `Erro de conexão: ${err.type || err.message}`;
    cleanupNetwork(true);
    alert(msg);
  });
}

// Room actions
btnCopyCode.addEventListener("click", async () => {
  await navigator.clipboard?.writeText(net.roomCode);
  btnCopyCode.textContent = "Código Copiado!";
  setTimeout(() => (btnCopyCode.textContent = "Copiar Código"), 1500);
});

btnCopyLink.addEventListener("click", async () => {
  const inviteUrl = new URL(window.location.href);
  inviteUrl.searchParams.set("room", net.roomCode);
  await navigator.clipboard?.writeText(inviteUrl.toString());
  btnCopyLink.textContent = "Link Copiado!";
  setTimeout(() => (btnCopyLink.textContent = "Copiar Link"), 1500);
});

btnResync.addEventListener("click", () => {
  if (net.role === "host" && net.connected && net.mode === "sync") {
    sendSyncSnapshot();
  }
});

delaySelect.addEventListener("change", () => {
  if (net.role === "host" && net.connected && net.mode === "sync") {
    sendSyncSnapshot();
  }
});

btnLeaveRoom.addEventListener("click", () => {
  const url = new URL(window.location.href);
  url.searchParams.delete("room");
  window.history.replaceState({}, "", url.toString());
  cleanupNetwork(true);
});

chatForm.addEventListener("submit", (e) => {
  e.preventDefault();
  const text = chatInput.value.trim();
  if (!text) return;
  chatInput.value = "";
  appendChat(net.myNick, text);
  if (net.conn && net.conn.open) {
    net.conn.send({ t: "chat", nick: net.myNick, text });
  }
});

btnPlaySolo.addEventListener("click", startSolo);
btnCreateRoom.addEventListener("click", createRoom);
btnJoinRoom.addEventListener("click", joinRoom);
btnRetryLoad.addEventListener("click", () => {
  if (net.role === "host") createRoom();
  else if (net.role === "guest") onGuestHandshake();
  else startSolo();
});

// ========================
// MAIN SIMULATION LOOP
// ========================

function stepEmulatorFrame(p1Mask, p2Mask, draw) {
  Module._fbw_set_input_mask(0, p1Mask);
  Module._fbw_set_input_mask(1, p2Mask);
  Module._fbw_frame(draw ? 1 : 0);
  const audFrames = Module._fbw_get_audio_frames();
  const audPtr = Module._fbw_get_audio_buffer();
  if (audFrames > 0 && audPtr) {
    const samples = Module.HEAP16.subarray(audPtr >> 1, (audPtr >> 1) + audFrames * 2);
    pushAudio(samples, audFrames);
  }
}

function renderCanvas() {
  Module._fbw_copy_rgba(rgbaPtr);
  imgData.data.set(Module.HEAPU8.subarray(rgbaPtr, rgbaPtr + width * height * 4));
  ctx.putImageData(imgData, 0, 0);
}

function startMainLoop() {
  if (rafStarted) return;
  rafStarted = true;

  let lastTime = performance.now();
  let acc = 0;
  let fpsFrames = 0;
  let fpsTimer = lastTime;

  function tick(now) {
    requestAnimationFrame(tick);
    const frameMs = 1000 / targetFps;

    if (!running || paused) {
      lastTime = now;
      return;
    }

    // Stream Guest: only send P2 input mask to Host
    if (net.role === "guest" && net.mode === "stream") {
      const m = getPrimaryInputMask();
      if (net.conn && net.conn.open && (m !== net.lastSentStreamMask || now - net.lastResendAt > 100)) {
        net.lastSentStreamMask = m;
        net.lastResendAt = now;
        net.conn.send({ t: "si", m });
      }
      statsEl.textContent = net.pingMs ? `Stream P2P | Ping: ${net.pingMs} ms` : "Stream P2P";
      lastTime = now;
      return;
    }

    const dt = Math.min(now - lastTime, 100);
    lastTime = now;
    acc += dt;

    let ran = false;
    let steps = 0;

    // Sync P2P Lockstep mode when connected and synced
    if ((net.role === "host" || net.role === "guest") && net.mode === "sync" && net.connected && net.synced) {
      while (acc >= frameMs && steps < 4) {
        const target = net.frame + net.delay;
        if (!net.localInputs.has(target)) {
          const m = getPrimaryInputMask();
          net.localInputs.set(target, m);
          net.conn?.send({ t: "i", f: target, m });
        }

        if (!net.remoteInputs.has(net.frame)) {
          // Resend recent unacked inputs while waiting so packet loss/jitter recovers
          if (now - net.lastResendAt > 40) {
            net.lastResendAt = now;
            for (let f = net.frame; f <= target; f++) {
              if (net.localInputs.has(f)) {
                net.conn?.send({ t: "i", f, m: net.localInputs.get(f) });
              }
            }
          }
          acc = frameMs;
          break;
        }

        const localM = net.localInputs.get(net.frame) ?? 0;
        const remoteM = net.remoteInputs.get(net.frame) ?? 0;
        const p1M = net.role === "host" ? localM : remoteM;
        const p2M = net.role === "host" ? remoteM : localM;

        const draw = (acc - frameMs < frameMs) ? 1 : 0;
        stepEmulatorFrame(p1M, p2M, draw);

        if (net.role === "host" && net.frame > 0 && net.frame % 120 === 0) {
          net.conn?.send({ t: "h", f: net.frame, h: Module._fbw_ram_hash() >>> 0 });
        }

        const stale = net.frame - 12;
        net.localInputs.delete(stale);
        net.remoteInputs.delete(stale);

        net.frame++;
        if (draw) ran = true;
        acc -= frameMs;
        steps++;
        fpsFrames++;
      }
    } else {
      // Solo or Host waiting in lobby or Host Stream mode
      while (acc >= frameMs && steps < 4) {
        const p1M = getPrimaryInputMask();
        const p2M = (net.role === "host" && net.mode === "stream" && net.connected)
          ? net.remoteMaskStream
          : getLocalP2Mask();
        const draw = (acc - frameMs < frameMs) ? 1 : 0;
        stepEmulatorFrame(p1M, p2M, draw);
        if (draw) ran = true;
        acc -= frameMs;
        steps++;
        fpsFrames++;
      }
    }

    if (acc >= frameMs * 4) acc = 0;
    if (ran) renderCanvas();

    if (now - fpsTimer >= 1000) {
      const fps = (fpsFrames * 1000) / (now - fpsTimer);
      const pingPart = net.pingMs ? ` | Ping: ${net.pingMs} ms` : "";
      statsEl.textContent = `${width}×${height} | ${fps.toFixed(1)} FPS | ${srcSampleRate} Hz${pingPart}`;
      fpsFrames = 0;
      fpsTimer = now;
    }
  }

  requestAnimationFrame(tick);
}

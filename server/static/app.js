'use strict';

// ═══════════════════════════════════════════════════════════════
//  LocalSend Bridge — Web App
//  Works alongside the Rust signaling server (/v1/ws).
//  Does NOT touch LocalSend's WiFi file-transfer protocol.
// ═══════════════════════════════════════════════════════════════

/* ─── Constants ──────────────────────────────────────────────── */
const PROTOCOL_VERSION = '2.3';
const DATACHANNEL_LABEL = 'bridge-control';
const ICE_SERVERS = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
];

/* ─── App State ──────────────────────────────────────────────── */
const state = {
  mode: 'desktop',          // 'desktop' | 'mobile'
  ws: null,
  myId: null,               // assigned by server on HELLO
  alias: '',
  peers: new Map(),         // peerId → { info, pc, dc, streams }
  audioCtx: null,
  audioSource: null,
  audioNodes: {},           // named filter/gain nodes
  audioStream: null,        // MediaStream for streaming
  videoStream: null,
  activeTab: { desktop: 'd-stream', mobile: 'm-bridge' },
  mods: { ctrl: false, alt: false, shift: false, win: false },
  lastTouchPos: null,
};

/* ─── EQ Band Definitions ────────────────────────────────────── */
const EQ_BANDS = [
  { label: 'Sub',    freq: 60,    type: 'lowshelf',   gain: 0 },
  { label: 'Bass',   freq: 150,   type: 'peaking',    gain: 0 },
  { label: 'Low-M',  freq: 400,   type: 'peaking',    gain: 0 },
  { label: 'Mid',    freq: 1000,  type: 'peaking',    gain: 0 },
  { label: 'Hi-M',   freq: 2500,  type: 'peaking',    gain: 0 },
  { label: 'Pres',   freq: 6000,  type: 'peaking',    gain: 0 },
  { label: 'Treble', freq: 16000, type: 'highshelf',  gain: 0 },
];

const EQ_PRESETS = {
  flat:       [  0,  0,  0,  0,  0,  0,  0 ],
  bass:       [  6,  5,  2,  0, -1, -1, -2 ],
  vocal:      [ -3, -2,  3,  4,  3,  0, -1 ],
  treble:     [ -2, -2,  0,  0,  2,  4,  6 ],
  electronic: [  4,  3, -1,  0,  0,  2,  3 ],
  rock:       [  3,  2, -1, -1,  1,  3,  4 ],
  classical:  [  0,  0,  0, -1,  0,  2,  3 ],
};

/* ─── QWERTY Layout ──────────────────────────────────────────── */
const KB_ROWS = [
  ['1','2','3','4','5','6','7','8','9','0','-','='],
  ['q','w','e','r','t','y','u','i','o','p','[',']'],
  ['a','s','d','f','g','h','j','k','l',';',"'"],
  ['z','x','c','v','b','n','m',',','.','/'],
  [' '],
];

// ═══════════════════════════════════════════════════════════════
//  STARTUP
// ═══════════════════════════════════════════════════════════════
document.addEventListener('DOMContentLoaded', () => {
  initConnectScreen();
  buildEqualizer();
  buildKeyboard();
  initFileDrop();
});

/* ─── Connect Screen ─────────────────────────────────────────── */
function initConnectScreen() {
  // Default alias = hostname
  const aliasInput = $('alias-input');
  aliasInput.value = `My ${isMobile() ? 'Phone' : 'PC'}`;

  // Default server = same origin over WS
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  $('server-input').value = `${proto}//${location.host}/v1/ws`;

  // Auto-detect mode
  if (isMobile()) selectMode('mobile');

  on('connect-btn', 'click', () => connect());

  // Mode buttons
  document.querySelectorAll('.mode-btn').forEach(btn => {
    btn.addEventListener('click', () => selectMode(btn.dataset.mode));
  });

  on('d-disconnect-btn', 'click', disconnect);
  on('m-disconnect-btn', 'click', disconnect);
}

function selectMode(mode) {
  state.mode = mode;
  document.querySelectorAll('.mode-btn').forEach(b => b.classList.toggle('active', b.dataset.mode === mode));
}

async function connect() {
  const alias = $('alias-input').value.trim() || 'My Device';
  const serverUrl = $('server-input').value.trim();
  state.alias = alias;

  if (!serverUrl) { showConnectMsg('Enter the server address.', 'error'); return; }

  showConnectMsg('Connecting…');
  $('connect-btn').disabled = true;

  try {
    await openWebSocket(serverUrl);
    showApp();
  } catch (e) {
    showConnectMsg(`Connection failed: ${e.message}`, 'error');
    $('connect-btn').disabled = false;
  }
}

function showApp() {
  hide('connect-screen');
  if (state.mode === 'desktop') {
    show('desktop-app');
    initDesktopTabs();
    initDesktopStreaming();
    initDesktopVideo();
  } else {
    show('mobile-app');
    initMobileTabs();
    initGamepad();
    initTouchpad();
    initKeyboard();
  }
}

function disconnect() {
  if (state.ws) { try { state.ws.close(); } catch (_) {} state.ws = null; }
  state.peers.forEach(p => { try { p.pc.close(); } catch (_) {} });
  state.peers.clear();
  stopAudioCtx();
  hide('desktop-app'); hide('mobile-app');
  show('connect-screen');
  showConnectMsg('Disconnected.', '');
  $('connect-btn').disabled = false;
}

// ═══════════════════════════════════════════════════════════════
//  WEBSOCKET SIGNALING
// ═══════════════════════════════════════════════════════════════
function openWebSocket(serverUrl) {
  return new Promise((resolve, reject) => {
    const info = {
      alias: state.alias,
      version: PROTOCOL_VERSION,
      deviceModel: isMobile() ? 'WebPhone' : 'WebPC',
      deviceType: isMobile() ? 'MOBILE' : 'DESKTOP',
      token: crypto.randomUUID(),
    };
    const d = btoa(JSON.stringify(info));
    const url = `${serverUrl}?d=${encodeURIComponent(d)}`;

    const ws = new WebSocket(url);
    ws.onopen = () => { state.ws = ws; };
    ws.onerror = (e) => { reject(new Error('WebSocket error')); };
    ws.onclose = () => {
      if (!state.myId) reject(new Error('Connection closed before handshake'));
      else handleWsClose();
    };
    ws.onmessage = (ev) => {
      try {
        const msg = JSON.parse(ev.data);
        handleSignal(msg, resolve, reject);
      } catch (e) { console.error('WS parse error', e); }
    };
  });
}

function handleSignal(msg, resolve, reject) {
  switch (msg.type) {
    case 'HELLO':
      state.myId = msg.client.id;
      msg.peers.forEach(p => addPeer(p));
      updatePeerUI();
      if (resolve) resolve();
      break;

    case 'JOIN':
      addPeer(msg.peer);
      updatePeerUI();
      if (state.mode === 'desktop') initiateOffer(msg.peer.id);
      break;

    case 'LEFT':
      removePeer(msg.peerId);
      updatePeerUI();
      break;

    case 'UPDATE':
      if (state.peers.has(msg.peer.id)) {
        state.peers.get(msg.peer.id).info = msg.peer;
        updatePeerUI();
      }
      break;

    case 'OFFER':
      handleOffer(msg);
      break;

    case 'ANSWER':
      handleAnswer(msg);
      break;

    case 'ERROR':
      console.warn('Server error:', msg.code);
      break;
  }
}

function sendSignal(obj) {
  if (state.ws && state.ws.readyState === WebSocket.OPEN)
    state.ws.send(JSON.stringify(obj));
}

function handleWsClose() {
  if (state.mode === 'desktop') setStatus('d-peer-count', 'Disconnected');
  else setMobileStatus('Disconnected', false);
}

// ═══════════════════════════════════════════════════════════════
//  PEER MANAGEMENT
// ═══════════════════════════════════════════════════════════════
function addPeer(info) {
  if (state.peers.has(info.id)) {
    state.peers.get(info.id).info = info;
    return;
  }
  state.peers.set(info.id, { info, pc: null, dc: null, streams: [] });
}

function removePeer(peerId) {
  const peer = state.peers.get(peerId);
  if (peer) {
    try { if (peer.dc) peer.dc.close(); } catch (_) {}
    try { if (peer.pc) peer.pc.close(); } catch (_) {}
    state.peers.delete(peerId);
  }
}

function getPeer(peerId) { return state.peers.get(peerId); }

function updatePeerUI() {
  const count = state.peers.size;
  if (state.mode === 'desktop') {
    setText('d-peer-count', `${count} peer${count !== 1 ? 's' : ''}`);
    $('d-status-dot')?.classList.toggle('online', count > 0);
    renderPeerList('d-peers-list', [...state.peers.values()]);
    renderPeerList('stream-peers-list', [...state.peers.values()]);
    renderPeerList('video-peers-list', [...state.peers.values()]);
  } else {
    setMobileStatus(count > 0 ? `${count} peer${count !== 1 ? 's' : ''} connected` : 'Waiting for desktop…', count > 0);
  }
}

function renderPeerList(containerId, peers) {
  const el = $(containerId);
  if (!el) return;
  if (peers.length === 0) {
    el.innerHTML = '<div class="empty-state">No devices connected yet.<br>Open this page on another device on the same network.</div>';
    return;
  }
  el.innerHTML = peers.map(p => {
    const icon = deviceIcon(p.info.deviceType);
    return `<div class="peer-item" data-peer="${p.info.id}">
      <div class="peer-icon">${icon}</div>
      <div class="peer-info">
        <div class="peer-name">${escHtml(p.info.alias)}</div>
        <div class="peer-meta">${p.info.deviceType || 'Unknown'} · ${p.info.deviceModel || ''}</div>
      </div>
    </div>`;
  }).join('');
}

function deviceIcon(type) {
  switch (type) {
    case 'MOBILE': return '📱';
    case 'DESKTOP': return '🖥️';
    case 'WEB': return '🌐';
    default: return '📡';
  }
}

// ═══════════════════════════════════════════════════════════════
//  WEBRTC — OFFER / ANSWER
// ═══════════════════════════════════════════════════════════════
function createPeerConnection(peerId) {
  const peer = getPeer(peerId);
  if (!peer) return null;
  if (peer.pc) return peer.pc;

  const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
  peer.pc = pc;

  pc.onicecandidate = () => {}; // wait for gathering to complete
  pc.oniceconnectionstatechange = () => {
    console.log(`ICE[${peerId}]: ${pc.iceConnectionState}`);
    if (pc.iceConnectionState === 'failed') pc.restartIce();
  };
  pc.ontrack = (ev) => {
    const stream = ev.streams[0];
    if (!stream) return;
    peer.streams.push(stream);
    if (state.mode === 'mobile') receiveMobileStream(stream, ev.track.kind);
  };
  pc.ondatachannel = (ev) => {
    peer.dc = ev.channel;
    setupDataChannel(peer.dc, peerId, false);
  };
  return pc;
}

async function initiateOffer(peerId) {
  const peer = getPeer(peerId);
  if (!peer) return;

  const pc = createPeerConnection(peerId);

  // Create data channel (desktop creates it)
  const dc = pc.createDataChannel(DATACHANNEL_LABEL, { ordered: true });
  peer.dc = dc;
  setupDataChannel(dc, peerId, true);

  // Add audio/video tracks if streaming
  addTracksToConnection(pc);

  try {
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    await waitGatheringComplete(pc);

    const sessionId = crypto.randomUUID();
    peer._sessionId = sessionId;

    sendSignal({
      type: 'OFFER',
      sessionId,
      target: peerId,
      sdp: compressSdp(pc.localDescription.sdp),
    });
  } catch (e) {
    console.error('Offer error:', e);
  }
}

async function handleOffer(msg) {
  const peerId = msg.peer.id;
  if (!state.peers.has(peerId)) addPeer(msg.peer);
  const peer = getPeer(peerId);
  const pc = createPeerConnection(peerId);

  try {
    const sdp = decompressSdp(msg.sdp);
    await pc.setRemoteDescription({ type: 'offer', sdp });
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    await waitGatheringComplete(pc);

    sendSignal({
      type: 'ANSWER',
      sessionId: msg.sessionId,
      target: peerId,
      sdp: compressSdp(pc.localDescription.sdp),
    });
  } catch (e) {
    console.error('Answer error:', e);
  }
}

async function handleAnswer(msg) {
  const peer = getPeer(msg.peer.id);
  if (!peer || !peer.pc) return;
  try {
    const sdp = decompressSdp(msg.sdp);
    await peer.pc.setRemoteDescription({ type: 'answer', sdp });
  } catch (e) {
    console.error('setRemoteDescription error:', e);
  }
}

function waitGatheringComplete(pc) {
  return new Promise(resolve => {
    if (pc.iceGatheringState === 'complete') { resolve(); return; }
    const check = () => { if (pc.iceGatheringState === 'complete') { pc.removeEventListener('icegatheringstatechange', check); resolve(); } };
    pc.addEventListener('icegatheringstatechange', check);
    setTimeout(resolve, 3000); // fallback
  });
}

function addTracksToConnection(pc) {
  if (state.audioStream) state.audioStream.getTracks().forEach(t => { try { pc.addTrack(t, state.audioStream); } catch(_){} });
  if (state.videoStream) state.videoStream.getTracks().forEach(t => { try { pc.addTrack(t, state.videoStream); } catch(_){} });
}

// ═══════════════════════════════════════════════════════════════
//  DATA CHANNEL — CONTROL EVENTS
// ═══════════════════════════════════════════════════════════════
function setupDataChannel(dc, peerId, isInitiator) {
  dc.onopen = () => {
    console.log(`DataChannel open with ${peerId}`);
    if (state.mode === 'desktop') updateControlStatus(true);
  };
  dc.onclose = () => {
    console.log(`DataChannel closed with ${peerId}`);
    if (state.mode === 'desktop') updateControlStatus(false);
  };
  dc.onmessage = (ev) => {
    try { handleControlEvent(JSON.parse(ev.data), peerId); } catch (e) {}
  };
}

function sendControl(event) {
  const msg = JSON.stringify(event);
  state.peers.forEach(peer => {
    if (peer.dc && peer.dc.readyState === 'open') {
      peer.dc.send(msg);
    }
  });
}

function handleControlEvent(ev, peerId) {
  // Desktop receives events from phone
  switch (ev.type) {
    case 'gamepad': handleGamepadEvent(ev); break;
    case 'mouse':   handleMouseEvent(ev); break;
    case 'keyboard': handleKeyboardEvent(ev); break;
  }
}

/* ── Gamepad receive (desktop) ── */
function handleGamepadEvent(ev) {
  updateControlStatus(true);
  if (ev.button) {
    const id = `gp-${ev.button}`;
    const el = $(id);
    if (el) el.classList.toggle('pressed', ev.state === 'pressed');
  }
  if (ev.axis === 'left' && $('gp-lstick')) {
    const dot = $('gp-lstick').querySelector('.stick-dot');
    if (dot) { dot.style.transform = `translate(calc(-50% + ${ev.x * 14}px), calc(-50% + ${ev.y * 14}px))`; }
  }
  if (ev.axis === 'right' && $('gp-rstick')) {
    const dot = $('gp-rstick').querySelector('.stick-dot');
    if (dot) { dot.style.transform = `translate(calc(-50% + ${ev.x * 14}px), calc(-50% + ${ev.y * 14}px))`; }
  }
}

/* ── Mouse receive (desktop) ── */
function handleMouseEvent(ev) {
  updateControlStatus(true);
  if (ev.action === 'move') setText('mouse-pos', `Position: Δ(${Math.round(ev.dx)}, ${Math.round(ev.dy)})`);
  if (ev.action === 'click') setText('mouse-btn', `Button: ${ev.button}`);
  if (ev.action === 'scroll') setText('mouse-scroll', `Scroll: ${ev.dy > 0 ? '▼' : '▲'} ${Math.abs(ev.dy)}`);
}

/* ── Keyboard receive (desktop) ── */
function handleKeyboardEvent(ev) {
  updateControlStatus(true);
  if (ev.action === 'keydown') {
    setText('kbd-last-key', `Last key: ${ev.key}`);
    const mods = [ev.ctrl && 'Ctrl', ev.shift && 'Shift', ev.alt && 'Alt', ev.win && 'Win'].filter(Boolean);
    setText('kbd-combo', `Combo: ${mods.length ? mods.join('+') + '+' : ''}${ev.key}`);

    // Dispatch real keyboard event within the page
    document.dispatchEvent(new KeyboardEvent('keydown', {
      key: ev.key, code: ev.code, ctrlKey: !!ev.ctrl,
      shiftKey: !!ev.shift, altKey: !!ev.alt, metaKey: !!ev.win,
      bubbles: true, cancelable: true,
    }));
  }
}

function updateControlStatus(connected) {
  const dot = $('ctrl-dot');
  const txt = $('ctrl-status-text');
  if (!dot || !txt) return;
  dot.className = 'dot ' + (connected ? 'active' : '');
  txt.textContent = connected ? 'Phone connected — receiving input' : 'Waiting for phone connection…';
}

// ═══════════════════════════════════════════════════════════════
//  SDP COMPRESSION (zlib via pako)
// ═══════════════════════════════════════════════════════════════
function compressSdp(sdpString) {
  const bytes = new TextEncoder().encode(sdpString);
  const compressed = pako.deflate(bytes);
  return btoa(String.fromCharCode(...compressed)).replace(/=/g, '');
}

function decompressSdp(b64) {
  const pad = b64 + '=='.slice((b64.length + 3) & 3 || 4);
  const bin = atob(pad);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const decompressed = pako.inflate(bytes);
  return new TextDecoder().decode(decompressed);
}

// ═══════════════════════════════════════════════════════════════
//  AUDIO STREAMING (Desktop → Phone)
// ═══════════════════════════════════════════════════════════════
function initDesktopStreaming() {
  const audioFile = $('audio-file');
  const audioEl = $('audio-el');

  audioFile.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;
    loadAudioFile(file);
  });

  on('audio-stream-btn', 'click', () => startAudioStream());
  on('audio-stop-btn', 'click', () => stopAudioStream());

  // Drag and drop
  const drop = $('audio-drop');
  drop.addEventListener('dragover', e => { e.preventDefault(); drop.classList.add('dragging'); });
  drop.addEventListener('dragleave', () => drop.classList.remove('dragging'));
  drop.addEventListener('drop', e => {
    e.preventDefault(); drop.classList.remove('dragging');
    const file = e.dataTransfer.files[0];
    if (file && file.type.startsWith('audio/')) loadAudioFile(file);
  });
}

function loadAudioFile(file) {
  const audioEl = $('audio-el');
  audioEl.src = URL.createObjectURL(file);
  hide('audio-drop');
  show('audio-player-wrap');
  setText('audio-track-name', file.name.replace(/\.[^.]+$/, ''));
  setText('audio-track-meta', `${file.type} · ${formatBytes(file.size)}`);
  // Setup audio context for equalizer
  initAudioContext(audioEl);
}

function startAudioStream() {
  const audioEl = $('audio-el');
  if (!audioEl.src) { alert('Load an audio file first.'); return; }

  // Capture stream from audio element
  let stream;
  try { stream = audioEl.captureStream ? audioEl.captureStream() : audioEl.mozCaptureStream(); }
  catch (e) { alert('Your browser does not support captureStream. Use Chrome.'); return; }

  state.audioStream = stream;

  // Add tracks to all existing peer connections
  state.peers.forEach((peer, peerId) => {
    if (peer.pc) {
      stream.getTracks().forEach(t => { try { peer.pc.addTrack(t, stream); } catch (_) {} });
      // Renegotiate
      renegotiate(peerId);
    }
  });

  audioEl.play();
  hide('audio-stream-btn');
  show('audio-stop-btn');
  show('audio-stream-status');
  setText('audio-stream-status', `🔴 Live — streaming to ${state.peers.size} device(s)`);
}

function stopAudioStream() {
  if (state.audioStream) {
    state.audioStream.getTracks().forEach(t => t.stop());
    state.audioStream = null;
  }
  $('audio-el').pause();
  show('audio-stream-btn');
  hide('audio-stop-btn');
  hide('audio-stream-status');
}

async function renegotiate(peerId) {
  const peer = getPeer(peerId);
  if (!peer || !peer.pc) return;
  try {
    const offer = await peer.pc.createOffer();
    await peer.pc.setLocalDescription(offer);
    await waitGatheringComplete(peer.pc);
    sendSignal({ type: 'OFFER', sessionId: crypto.randomUUID(), target: peerId, sdp: compressSdp(peer.pc.localDescription.sdp) });
  } catch (e) { console.error('Renegotiate error', e); }
}

// ═══════════════════════════════════════════════════════════════
//  VIDEO STREAMING (Desktop → Phone)
// ═══════════════════════════════════════════════════════════════
function initDesktopVideo() {
  const videoFile = $('video-file');
  const videoEl = $('video-el');

  videoFile.addEventListener('change', e => {
    const file = e.target.files[0];
    if (!file) return;
    videoEl.src = URL.createObjectURL(file);
    hide('video-drop');
    show('video-player-wrap');
  });

  on('video-stream-btn', 'click', () => startVideoStream());
  on('video-stop-btn', 'click', () => stopVideoStream());

  const drop = $('video-drop');
  drop.addEventListener('dragover', e => { e.preventDefault(); drop.classList.add('dragging'); });
  drop.addEventListener('dragleave', () => drop.classList.remove('dragging'));
  drop.addEventListener('drop', e => {
    e.preventDefault(); drop.classList.remove('dragging');
    const file = e.dataTransfer.files[0];
    if (file && file.type.startsWith('video/')) {
      videoEl.src = URL.createObjectURL(file);
      hide('video-drop');
      show('video-player-wrap');
    }
  });
}

function startVideoStream() {
  const videoEl = $('video-el');
  if (!videoEl.src) { alert('Load a video file first.'); return; }

  let stream;
  try { stream = videoEl.captureStream ? videoEl.captureStream() : videoEl.mozCaptureStream(); }
  catch (e) { alert('captureStream not supported. Use Chrome.'); return; }

  state.videoStream = stream;
  state.peers.forEach((peer, peerId) => {
    if (peer.pc) { stream.getTracks().forEach(t => { try { peer.pc.addTrack(t, stream); } catch (_) {} }); renegotiate(peerId); }
  });

  videoEl.play();
  hide('video-stream-btn');
  show('video-stop-btn');
}

function stopVideoStream() {
  if (state.videoStream) { state.videoStream.getTracks().forEach(t => t.stop()); state.videoStream = null; }
  $('video-el').pause();
  show('video-stream-btn');
  hide('video-stop-btn');
}

// ═══════════════════════════════════════════════════════════════
//  MOBILE — RECEIVE STREAM (Audio Bridge)
// ═══════════════════════════════════════════════════════════════
function receiveMobileStream(stream, kind) {
  setMobileStatus('Receiving stream from PC…', true);
  show('m-now-playing');

  if (kind === 'audio' || stream.getAudioTracks().length > 0) {
    const audioEl = $('m-audio-el');
    audioEl.srcObject = stream;
    audioEl.volume = $('m-volume').value / 100;
    audioEl.play().catch(e => {
      // Autoplay policy — need user gesture
      const btn = document.createElement('button');
      btn.textContent = '▶ Tap to play audio';
      btn.className = 'btn-primary';
      btn.style.marginTop = '12px';
      btn.onclick = () => { audioEl.play(); btn.remove(); };
      $('m-bridge').appendChild(btn);
    });

    // Set up MediaSession for lock screen controls
    if ('mediaSession' in navigator) {
      navigator.mediaSession.metadata = new MediaMetadata({ title: 'LocalSend Bridge', artist: 'Streaming from PC' });
      navigator.mediaSession.playbackState = 'playing';
    }
    setText('m-track-name', 'Audio from PC');
    setText('m-track-status', 'Streaming via WiFi → Bluetooth');
  }

  if (kind === 'video' || stream.getVideoTracks().length > 0) {
    const videoEl = $('m-video-el');
    videoEl.srcObject = stream;
    show('m-video-el');
    videoEl.play().catch(() => {});
  }

  // Volume control
  $('m-volume').oninput = () => {
    $('m-audio-el').volume = $('m-volume').value / 100;
  };

  // Keep screen awake while streaming (WakeLock API)
  if ('wakeLock' in navigator) {
    navigator.wakeLock.request('screen').catch(() => {});
  }
}

function setMobileStatus(text, active) {
  const dot = $('m-status-dot');
  const txt = $('m-status-text');
  const bdot = $('m-bridge-dot');
  const btxt = $('m-bridge-text');
  if (dot) dot.className = 'dot ' + (active ? 'online' : '');
  if (txt) txt.textContent = text;
  if (bdot) bdot.className = 'dot ' + (active ? 'streaming' : '');
  if (btxt) btxt.textContent = text;
}

// ═══════════════════════════════════════════════════════════════
//  AUDIO EQUALIZER (Web Audio API)
// ═══════════════════════════════════════════════════════════════
function initAudioContext(audioEl) {
  if (state.audioCtx) stopAudioCtx();
  const ctx = new (window.AudioContext || window.webkitAudioContext)();
  state.audioCtx = ctx;

  const source = ctx.createMediaElementSource(audioEl);
  state.audioSource = source;

  // Build filter chain
  let node = source;
  state.audioNodes = {};

  EQ_BANDS.forEach((band, i) => {
    const filter = ctx.createBiquadFilter();
    filter.type = band.type;
    filter.frequency.value = band.freq;
    filter.gain.value = band.gain;
    if (band.type === 'peaking') filter.Q.value = 1.0;
    state.audioNodes[`band_${i}`] = filter;
    node.connect(filter);
    node = filter;
  });

  // Master gain
  const masterGain = ctx.createGain();
  masterGain.gain.value = 1.0;
  state.audioNodes.master = masterGain;
  node.connect(masterGain);

  // Analyser for visualizer
  const analyser = ctx.createAnalyser();
  analyser.fftSize = 256;
  state.audioNodes.analyser = analyser;
  masterGain.connect(analyser);
  analyser.connect(ctx.destination);

  startVisualizer(analyser);
  connectEQSliders();
}

function stopAudioCtx() {
  if (state.audioCtx) { try { state.audioCtx.close(); } catch (_) {} state.audioCtx = null; }
  if (state._vizRaf) { cancelAnimationFrame(state._vizRaf); state._vizRaf = null; }
}

function buildEqualizer() {
  const container = $('eq-bands');
  if (!container) return;
  EQ_BANDS.forEach((band, i) => {
    const div = document.createElement('div');
    div.className = 'eq-band';
    div.innerHTML = `
      <span class="gain-val" id="eq-val-${i}">0 dB</span>
      <input type="range" class="eq-slider" id="eq-slider-${i}" min="-12" max="12" value="0" step="0.5">
      <label>${band.label}<br><small>${band.freq >= 1000 ? (band.freq/1000)+'k' : band.freq} Hz</small></label>
    `;
    container.appendChild(div);
  });

  // Master volume
  $('eq-master-vol').addEventListener('input', function() {
    setText('eq-master-val', `${this.value}%`);
    if (state.audioNodes.master) state.audioNodes.master.gain.value = this.value / 100;
  });

  // Presets
  document.querySelectorAll('.preset-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.preset-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      applyPreset(btn.dataset.preset);
    });
  });
}

function connectEQSliders() {
  EQ_BANDS.forEach((band, i) => {
    const slider = $(`eq-slider-${i}`);
    if (!slider) return;
    slider.addEventListener('input', function() {
      const gain = parseFloat(this.value);
      setText(`eq-val-${i}`, `${gain > 0 ? '+' : ''}${gain} dB`);
      if (state.audioNodes[`band_${i}`]) state.audioNodes[`band_${i}`].gain.value = gain;
    });
  });
}

function applyPreset(preset) {
  const gains = EQ_PRESETS[preset] || EQ_PRESETS.flat;
  gains.forEach((gain, i) => {
    const slider = $(`eq-slider-${i}`);
    if (slider) {
      slider.value = gain;
      setText(`eq-val-${i}`, `${gain > 0 ? '+' : ''}${gain} dB`);
      if (state.audioNodes[`band_${i}`]) state.audioNodes[`band_${i}`].gain.value = gain;
    }
  });
}

function startVisualizer(analyser) {
  const canvas = $('eq-canvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const buf = new Uint8Array(analyser.frequencyBinCount);

  function draw() {
    state._vizRaf = requestAnimationFrame(draw);
    analyser.getByteFrequencyData(buf);
    const W = canvas.clientWidth, H = canvas.clientHeight;
    canvas.width = W; canvas.height = H;
    ctx.clearRect(0, 0, W, H);
    const barW = W / buf.length * 2.5;
    let x = 0;
    for (let i = 0; i < buf.length; i++) {
      const h = (buf[i] / 255) * H;
      const hue = 200 + (buf[i] / 255) * 60;
      ctx.fillStyle = `hsl(${hue}, 80%, 55%)`;
      ctx.fillRect(x, H - h, barW - 1, h);
      x += barW + 1;
    }
  }
  draw();
}

// ═══════════════════════════════════════════════════════════════
//  VIRTUAL GAMEPAD (Mobile → sends to desktop)
// ═══════════════════════════════════════════════════════════════
function initGamepad() {
  // Button press/release
  document.querySelectorAll('[data-btn]').forEach(el => {
    el.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      el.classList.add('pressed');
      sendControl({ type: 'gamepad', button: el.dataset.btn, state: 'pressed' });
    });
    el.addEventListener('pointerup', () => {
      el.classList.remove('pressed');
      sendControl({ type: 'gamepad', button: el.dataset.btn, state: 'released' });
    });
    el.addEventListener('pointercancel', () => {
      el.classList.remove('pressed');
      sendControl({ type: 'gamepad', button: el.dataset.btn, state: 'released' });
    });
  });

  // Analog sticks
  initStick('left-stick', 'left');
  initStick('right-stick', 'right');
}

function initStick(zoneId, axis) {
  const zone = $(zoneId);
  const thumb = zone.querySelector('.stick-thumb');
  if (!zone || !thumb) return;

  const maxR = zone.offsetWidth / 2 - thumb.offsetWidth / 2;
  let active = false;
  let startX, startY;

  zone.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    active = true;
    zone.setPointerCapture(e.pointerId);
    zone.classList.add('active');
    const r = zone.getBoundingClientRect();
    startX = r.left + r.width / 2;
    startY = r.top + r.height / 2;
  });

  zone.addEventListener('pointermove', (e) => {
    if (!active) return;
    e.preventDefault();
    const r = zone.getBoundingClientRect();
    const cx = r.left + r.width / 2;
    const cy = r.top + r.height / 2;
    let dx = e.clientX - cx;
    let dy = e.clientY - cy;
    const dist = Math.sqrt(dx * dx + dy * dy);
    const maxDist = r.width / 2 - 18;
    if (dist > maxDist) { const s = maxDist / dist; dx *= s; dy *= s; }
    thumb.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;
    const nx = dx / maxDist, ny = dy / maxDist;
    sendControl({ type: 'gamepad', axis, x: parseFloat(nx.toFixed(3)), y: parseFloat(ny.toFixed(3)) });
  });

  const release = () => {
    if (!active) return;
    active = false;
    zone.classList.remove('active');
    thumb.style.transform = 'translate(-50%, -50%)';
    sendControl({ type: 'gamepad', axis, x: 0, y: 0 });
  };
  zone.addEventListener('pointerup', release);
  zone.addEventListener('pointercancel', release);
}

// ═══════════════════════════════════════════════════════════════
//  VIRTUAL TOUCHPAD / MOUSE (Mobile → sends to desktop)
// ═══════════════════════════════════════════════════════════════
function initTouchpad() {
  const pad = $('touchpad');
  const cursor = $('tp-cursor');
  if (!pad) return;

  let lastX = null, lastY = null;

  pad.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    pad.setPointerCapture(e.pointerId);
    lastX = e.clientX; lastY = e.clientY;
    cursor.style.opacity = '1';
    cursor.style.left = (e.clientX - pad.getBoundingClientRect().left) + 'px';
    cursor.style.top  = (e.clientY - pad.getBoundingClientRect().top)  + 'px';
  });

  pad.addEventListener('pointermove', (e) => {
    if (lastX === null) return;
    const dx = (e.clientX - lastX) * 1.5;
    const dy = (e.clientY - lastY) * 1.5;
    lastX = e.clientX; lastY = e.clientY;
    cursor.style.left = (e.clientX - pad.getBoundingClientRect().left) + 'px';
    cursor.style.top  = (e.clientY - pad.getBoundingClientRect().top)  + 'px';
    if (Math.abs(dx) > 0.2 || Math.abs(dy) > 0.2)
      sendControl({ type: 'mouse', action: 'move', dx, dy });
  });

  pad.addEventListener('pointerup', () => { lastX = null; cursor.style.opacity = '0'; });
  pad.addEventListener('pointercancel', () => { lastX = null; cursor.style.opacity = '0'; });

  // Buttons
  $('mb-left').addEventListener('pointerdown',  e => { e.preventDefault(); sendControl({ type: 'mouse', action: 'click', button: 'left' }); });
  $('mb-right').addEventListener('pointerdown', e => { e.preventDefault(); sendControl({ type: 'mouse', action: 'click', button: 'right' }); });
  $('mb-middle').addEventListener('pointerdown',e => { e.preventDefault(); sendControl({ type: 'mouse', action: 'click', button: 'middle' }); });
  $('mb-scroll-up').addEventListener('pointerdown', e => { e.preventDefault(); sendControl({ type: 'mouse', action: 'scroll', dy: -3 }); });
  $('mb-scroll-down').addEventListener('pointerdown', e => { e.preventDefault(); sendControl({ type: 'mouse', action: 'scroll', dy: 3 }); });
}

// ═══════════════════════════════════════════════════════════════
//  VIRTUAL KEYBOARD (Mobile → sends to desktop)
// ═══════════════════════════════════════════════════════════════
function buildKeyboard() {
  const vkb = $('vkb');
  if (!vkb) return;

  KB_ROWS.forEach(row => {
    const rowEl = document.createElement('div');
    rowEl.className = 'vkb-row';
    row.forEach(key => {
      const btn = document.createElement('button');
      btn.className = 'vkb-key' + (key === ' ' ? ' space' : key.length > 1 ? ' wide' : '');
      btn.textContent = key === ' ' ? 'SPACE' : key;
      btn.dataset.key = key === ' ' ? ' ' : key;
      btn.dataset.code = key === ' ' ? 'Space' : `Key${key.toUpperCase()}`;
      rowEl.appendChild(btn);
    });
    vkb.appendChild(rowEl);
  });
}

function initKeyboard() {
  // Key events
  document.querySelectorAll('.vkb-key').forEach(btn => {
    btn.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      btn.classList.add('pressed');
      const key = btn.dataset.key;
      const k = state.mods.shift && key.length === 1 ? key.toUpperCase() : key;
      sendControl({
        type: 'keyboard', action: 'keydown',
        key: k, code: btn.dataset.code,
        ctrl: state.mods.ctrl, alt: state.mods.alt,
        shift: state.mods.shift, win: state.mods.win,
      });
    });
    btn.addEventListener('pointerup', (e) => {
      e.preventDefault();
      btn.classList.remove('pressed');
      sendControl({ type: 'keyboard', action: 'keyup', key: btn.dataset.key, code: btn.dataset.code });
    });
  });

  // Special keys
  document.querySelectorAll('.spec-btn').forEach(btn => {
    btn.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      sendControl({
        type: 'keyboard', action: 'keydown',
        key: btn.dataset.key, code: btn.dataset.code,
        ctrl: state.mods.ctrl, alt: state.mods.alt,
        shift: state.mods.shift, win: state.mods.win,
      });
    });
    btn.addEventListener('pointerup', (e) => {
      e.preventDefault();
      sendControl({ type: 'keyboard', action: 'keyup', key: btn.dataset.key, code: btn.dataset.code });
    });
  });

  // Modifier toggles
  document.querySelectorAll('.mod-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const mod = btn.dataset.mod;
      state.mods[mod] = !state.mods[mod];
      btn.classList.toggle('active', state.mods[mod]);
    });
  });
}

// ═══════════════════════════════════════════════════════════════
//  FILE DROP (generic)
// ═══════════════════════════════════════════════════════════════
function initFileDrop() {
  // Prevent default browser file open on drop anywhere
  document.addEventListener('dragover', e => e.preventDefault());
  document.addEventListener('drop', e => e.preventDefault());
}

// ═══════════════════════════════════════════════════════════════
//  TABS
// ═══════════════════════════════════════════════════════════════
function initDesktopTabs() {
  document.querySelectorAll('#d-tabs .tab-btn').forEach(btn => {
    btn.addEventListener('click', () => switchTab(btn, 'd-tabs'));
  });
}
function initMobileTabs() {
  document.querySelectorAll('#m-tabs .tab-btn').forEach(btn => {
    btn.addEventListener('click', () => switchTab(btn, 'm-tabs'));
  });
}
function switchTab(btn, navId) {
  const tabId = btn.dataset.tab;
  document.querySelectorAll(`#${navId} .tab-btn`).forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  const panels = document.querySelectorAll('.tab-panel');
  panels.forEach(p => { p.classList.remove('active'); p.classList.add('hidden'); });
  const panel = $(tabId);
  if (panel) { panel.classList.remove('hidden'); panel.classList.add('active'); }

  // Start audio context on tab visit (requires user gesture)
  if (tabId === 'd-equalizer' && $('audio-el')?.src && !state.audioCtx) {
    initAudioContext($('audio-el'));
  }
}

// ═══════════════════════════════════════════════════════════════
//  HELPERS
// ═══════════════════════════════════════════════════════════════
function $(id) { return document.getElementById(id); }
function show(id) { const el = $(id); if (el) el.classList.remove('hidden'); }
function hide(id) { const el = $(id); if (el) el.classList.add('hidden'); }
function setText(id, txt) { const el = $(id); if (el) el.textContent = txt; }
function on(id, ev, fn) { const el = $(id); if (el) el.addEventListener(ev, fn); }
function escHtml(s) { return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
function isMobile() { return /Mobi|Android|iPhone|iPad/i.test(navigator.userAgent) || window.innerWidth < 600; }
function formatBytes(n) {
  if (n < 1024) return n + ' B';
  if (n < 1048576) return (n / 1024).toFixed(1) + ' KB';
  return (n / 1048576).toFixed(1) + ' MB';
}

function showConnectMsg(msg, type = '') {
  const el = $('connect-status');
  if (!el) return;
  el.textContent = msg;
  el.className = 'status-msg ' + type;
}

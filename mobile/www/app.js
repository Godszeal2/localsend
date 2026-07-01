'use strict';
// BridgeCast Mobile — Native App (Capacitor)
// Runs bundled inside the APK/IPA. Phone-bridge mode only.

const PROTOCOL_VERSION = '2.3';
const DATACHANNEL_LABEL = 'bridge-control';
const ICE_SERVERS = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
];
const KB_ROWS = [
  ['1','2','3','4','5','6','7','8','9','0'],
  ['q','w','e','r','t','y','u','i','o','p'],
  ['a','s','d','f','g','h','j','k','l'],
  ['z','x','c','v','b','n','m'],
];

const st = {
  ws: null, myId: null, alias: '',
  peers: new Map(),
  mods: { ctrl: false, alt: false, shift: false, win: false },
  screenStream: null,
  audioEl: null,
  wakeLock: null,
};

// ── Capacitor plugin helpers (graceful degradation) ──────────
const Cap = window.Capacitor || null;
const Plugins = Cap ? Cap.Plugins : {};

async function enableBackground() {
  if (Plugins.BackgroundMode) {
    try { await Plugins.BackgroundMode.enable(); } catch (_) {}
    try { await Plugins.BackgroundMode.setSettings({
      title: 'BridgeCast', text: 'Audio streaming in background', hidden: false,
    }); } catch (_) {}
  }
}
async function keepAwake() {
  if (Plugins.KeepAwake) {
    try { await Plugins.KeepAwake.keepAwake(); } catch (_) {}
  } else if ('wakeLock' in navigator) {
    try { st.wakeLock = await navigator.wakeLock.request('screen'); } catch (_) {}
  }
}
async function allowSleep() {
  if (Plugins.KeepAwake) { try { await Plugins.KeepAwake.allowSleep(); } catch (_) {} }
  if (st.wakeLock) { try { st.wakeLock.release(); st.wakeLock = null; } catch (_) {} }
}

// ── Startup ──────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  loadSaved();
  buildKeyboard();
  on('connect-btn', 'click', connect);
  on('disconnect-btn', 'click', disconnect);
  on('m-volume', 'input', () => {
    const v = $('m-volume').value / 100;
    setText('vol-pct', Math.round(v * 100) + '%');
    if (st.audioEl) st.audioEl.volume = v;
  });
  on('screen-fullscreen-btn', 'click', () => {
    const v = $('m-screen-video');
    if (v) v.requestFullscreen ? v.requestFullscreen() : v.webkitRequestFullscreen?.();
  });
  initTabs();
  initGamepad();
  initTouchpad();
  initKeyboard();
});

function loadSaved() {
  $('alias-input').value = localStorage.getItem('bc_alias') || 'My Phone';
  $('server-input').value = localStorage.getItem('bc_server') || '';
  $('room-input').value  = localStorage.getItem('bc_room')   || '';
}
function savePref() {
  localStorage.setItem('bc_alias',  $('alias-input').value);
  localStorage.setItem('bc_server', $('server-input').value);
  localStorage.setItem('bc_room',   $('room-input').value);
}

// ── Connect ──────────────────────────────────────────────────
async function connect() {
  const alias  = $('alias-input').value.trim() || 'My Phone';
  const server = $('server-input').value.trim();
  const room   = $('room-input').value.trim().toUpperCase();
  st.alias = alias;
  if (!server) { showMsg('Enter the server address.', 'error'); return; }
  showMsg('Connecting…');
  $('connect-btn').disabled = true;
  try {
    await openWS(server, room);
    savePref();
    hide('connect-screen');
    show('main-app');
    await enableBackground();
    await keepAwake();
  } catch (e) {
    showMsg('Connection failed: ' + e.message, 'error');
    $('connect-btn').disabled = false;
  }
}

function disconnect() {
  if (st.ws) { try { st.ws.close(); } catch (_) {} st.ws = null; }
  st.peers.forEach(p => { try { p.pc && p.pc.close(); } catch (_) {} });
  st.peers.clear();
  allowSleep();
  hide('main-app');
  show('connect-screen');
  showMsg('Disconnected.');
  $('connect-btn').disabled = false;
}

// ── WebSocket ────────────────────────────────────────────────
function openWS(serverUrl, room) {
  return new Promise((resolve, reject) => {
    const info = {
      alias: st.alias, version: PROTOCOL_VERSION,
      deviceModel: 'WebPhone', deviceType: 'MOBILE',
      token: crypto.randomUUID(),
    };
    const d = btoa(JSON.stringify(info));
    const roomParam = room ? `&room=${encodeURIComponent(room)}` : '';
    const url = `${serverUrl}?d=${encodeURIComponent(d)}${roomParam}`;
    const ws = new WebSocket(url);
    ws.onopen = () => { st.ws = ws; };
    ws.onerror = () => reject(new Error('WebSocket error'));
    ws.onclose = () => {
      if (!st.myId) reject(new Error('Closed before handshake'));
      else setStatus('Disconnected', false);
    };
    ws.onmessage = ev => {
      try { handleSignal(JSON.parse(ev.data), resolve, reject); } catch (_) {}
    };
  });
}

function handleSignal(msg, resolve, reject) {
  switch (msg.type) {
    case 'HELLO':
      st.myId = msg.client.id;
      msg.peers.forEach(p => addPeer(p));
      setStatus(st.peers.size + ' device(s) found', st.peers.size > 0);
      if (resolve) resolve();
      break;
    case 'JOIN':
      addPeer(msg.peer);
      setStatus(st.peers.size + ' device(s) connected', true);
      break;
    case 'LEFT':
      removePeer(msg.peerId);
      setStatus(st.peers.size ? st.peers.size + ' device(s)' : 'Waiting for desktop…', st.peers.size > 0);
      break;
    case 'OFFER':  handleOffer(msg); break;
    case 'ANSWER': handleAnswer(msg); break;
  }
}
function sendSignal(o) {
  if (st.ws && st.ws.readyState === 1) st.ws.send(JSON.stringify(o));
}

// ── Peer management ──────────────────────────────────────────
function addPeer(info) {
  if (!st.peers.has(info.id)) st.peers.set(info.id, { info, pc: null, dc: null });
}
function removePeer(id) {
  const p = st.peers.get(id);
  if (p) { try { p.dc && p.dc.close(); p.pc && p.pc.close(); } catch (_) {} st.peers.delete(id); }
}
function getPeer(id) { return st.peers.get(id); }

// ── WebRTC ───────────────────────────────────────────────────
function createPC(peerId) {
  const peer = getPeer(peerId);
  if (!peer || peer.pc) return peer?.pc;
  const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
  peer.pc = pc;
  pc.oniceconnectionstatechange = () => { if (pc.iceConnectionState === 'failed') pc.restartIce(); };
  pc.ontrack = ev => {
    const stream = ev.streams[0];
    if (!stream) return;
    if (ev.track.kind === 'audio' || stream.getAudioTracks().length > 0) receiveAudio(stream);
    if (ev.track.kind === 'video' || stream.getVideoTracks().length > 0) receiveVideo(stream, ev.track.kind);
  };
  pc.ondatachannel = ev => { peer.dc = ev.channel; setupDC(peer.dc); };
  return pc;
}

async function handleOffer(msg) {
  const peerId = msg.peer.id;
  if (!st.peers.has(peerId)) addPeer(msg.peer);
  const pc = createPC(peerId);
  try {
    await pc.setRemoteDescription({ type: 'offer', sdp: decompress(msg.sdp) });
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    await waitGather(pc);
    sendSignal({ type: 'ANSWER', sessionId: msg.sessionId, target: peerId, sdp: compress(pc.localDescription.sdp) });
  } catch (e) { console.error('handleOffer', e); }
}
async function handleAnswer(msg) {
  const peer = getPeer(msg.peer.id);
  if (!peer || !peer.pc) return;
  try { await peer.pc.setRemoteDescription({ type: 'answer', sdp: decompress(msg.sdp) }); } catch (_) {}
}
function waitGather(pc) {
  return new Promise(r => {
    if (pc.iceGatheringState === 'complete') return r();
    const fn = () => { if (pc.iceGatheringState === 'complete') { pc.removeEventListener('icegatheringstatechange', fn); r(); } };
    pc.addEventListener('icegatheringstatechange', fn);
    setTimeout(r, 3000);
  });
}

// ── SDP Compression ──────────────────────────────────────────
function compress(sdp) {
  const b = pako.deflate(new TextEncoder().encode(sdp));
  return btoa(String.fromCharCode(...b)).replace(/=/g, '');
}
function decompress(b64) {
  const pad = b64 + '=='.slice((b64.length + 3) & 3 || 4);
  const bin = atob(pad);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder().decode(pako.inflate(bytes));
}

// ── Receive Audio ────────────────────────────────────────────
function receiveAudio(stream) {
  const audio = $('m-audio');
  audio.srcObject = stream;
  audio.volume = $('m-volume').value / 100;
  st.audioEl = audio;

  audio.play().catch(() => {
    // Autoplay blocked — show tap-to-play button
    const btn = document.createElement('button');
    btn.className = 'btn-primary';
    btn.textContent = '▶ Tap to play audio';
    btn.style.marginTop = '12px';
    btn.onclick = () => { audio.play(); btn.remove(); };
    $('t-audio').appendChild(btn);
  });

  // Show now-playing UI
  show('now-playing');
  setText('np-title', 'Audio from PC');
  $('audio-anim').classList.add('playing');
  $('bridge-dot').className = 'dot streaming';
  setText('bridge-text', 'Streaming from PC — audio is live');

  // MediaSession API — lock screen controls
  if ('mediaSession' in navigator) {
    navigator.mediaSession.metadata = new MediaMetadata({
      title: 'BridgeCast', artist: 'Streaming from PC', album: 'via WiFi → Bluetooth',
    });
    navigator.mediaSession.playbackState = 'playing';
    navigator.mediaSession.setActionHandler('play',  () => audio.play());
    navigator.mediaSession.setActionHandler('pause', () => audio.pause());
  }
}

// ── Receive Video / Screen Share ──────────────────────────────
function receiveVideo(stream, kind) {
  // Route audio from video to audio element too (so it plays in background)
  if (stream.getAudioTracks().length > 0) {
    receiveAudio(stream);
  }
  // Show screen/video in the screen tab
  const videoEl = $('m-screen-video');
  videoEl.srcObject = stream;
  videoEl.play().catch(() => {});
  hide('screen-waiting');
  show('screen-active');
  // Show resolution info
  videoEl.onloadedmetadata = () => {
    setText('screen-res', `${videoEl.videoWidth}×${videoEl.videoHeight}`);
  };
  // Switch to screen tab if it's a screen share
  if (kind === 'video') {
    const screenTab = document.querySelector('[data-tab="t-screen"]');
    if (screenTab) screenTab.classList.add('has-content');
  }
}

// ── Data Channel ─────────────────────────────────────────────
function setupDC(dc) {
  dc.onopen  = () => console.log('DataChannel open');
  dc.onclose = () => console.log('DataChannel closed');
}
function sendCtrl(ev) {
  const msg = JSON.stringify(ev);
  st.peers.forEach(p => { if (p.dc && p.dc.readyState === 'open') p.dc.send(msg); });
}

// ── Tabs ─────────────────────────────────────────────────────
function initTabs() {
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      document.querySelectorAll('.tab-panel').forEach(p => { p.classList.remove('active'); p.classList.add('hidden'); });
      const p = $(btn.dataset.tab);
      if (p) { p.classList.remove('hidden'); p.classList.add('active'); }
    });
  });
}

// ── Gamepad ───────────────────────────────────────────────────
function initGamepad() {
  document.querySelectorAll('[data-btn]').forEach(el => {
    el.addEventListener('pointerdown', e => {
      e.preventDefault(); el.classList.add('pressed');
      sendCtrl({ type: 'gamepad', button: el.dataset.btn, state: 'pressed' });
    });
    const up = () => { el.classList.remove('pressed'); sendCtrl({ type: 'gamepad', button: el.dataset.btn, state: 'released' }); };
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
  });
  initStick('left-stick', 'left');
  initStick('right-stick', 'right');
}

function initStick(id, axis) {
  const zone = $(id);
  const thumb = zone.querySelector('.stick-thumb');
  let active = false;
  zone.addEventListener('pointerdown', e => {
    e.preventDefault(); active = true; zone.setPointerCapture(e.pointerId); zone.classList.add('active');
  });
  zone.addEventListener('pointermove', e => {
    if (!active) return; e.preventDefault();
    const r = zone.getBoundingClientRect();
    const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    let dx = e.clientX - cx, dy = e.clientY - cy;
    const maxD = r.width / 2 - 17;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist > maxD) { dx *= maxD / dist; dy *= maxD / dist; }
    thumb.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;
    sendCtrl({ type: 'gamepad', axis, x: +(dx / maxD).toFixed(3), y: +(dy / maxD).toFixed(3) });
  });
  const rel = () => {
    if (!active) return; active = false; zone.classList.remove('active');
    thumb.style.transform = 'translate(-50%, -50%)';
    sendCtrl({ type: 'gamepad', axis, x: 0, y: 0 });
  };
  zone.addEventListener('pointerup', rel);
  zone.addEventListener('pointercancel', rel);
}

// ── Touchpad / Mouse ──────────────────────────────────────────
function initTouchpad() {
  const pad = $('touchpad'), cursor = $('tp-cursor');
  if (!pad) return;
  let lx = null, ly = null;
  pad.addEventListener('pointerdown', e => {
    e.preventDefault(); pad.setPointerCapture(e.pointerId);
    lx = e.clientX; ly = e.clientY;
    cursor.style.opacity = '1';
    positionCursor(e);
  });
  pad.addEventListener('pointermove', e => {
    if (lx === null) return;
    const dx = (e.clientX - lx) * 1.6, dy = (e.clientY - ly) * 1.6;
    lx = e.clientX; ly = e.clientY;
    positionCursor(e);
    if (Math.abs(dx) > 0.2 || Math.abs(dy) > 0.2)
      sendCtrl({ type: 'mouse', action: 'move', dx, dy });
  });
  const rel = () => { lx = null; cursor.style.opacity = '0'; };
  pad.addEventListener('pointerup', rel);
  pad.addEventListener('pointercancel', rel);
  function positionCursor(e) {
    const r = pad.getBoundingClientRect();
    cursor.style.left = (e.clientX - r.left) + 'px';
    cursor.style.top  = (e.clientY - r.top)  + 'px';
  }
  const clicks = [
    ['mb-left','left'],['mb-middle','middle'],['mb-right','right'],
  ];
  clicks.forEach(([id, btn]) => {
    $(id).addEventListener('pointerdown', e => { e.preventDefault(); sendCtrl({ type:'mouse', action:'click', button:btn }); });
  });
  $('mb-su').addEventListener('pointerdown', e => { e.preventDefault(); sendCtrl({ type:'mouse', action:'scroll', dy:-3 }); });
  $('mb-sd').addEventListener('pointerdown', e => { e.preventDefault(); sendCtrl({ type:'mouse', action:'scroll', dy:3 }); });
}

// ── Virtual Keyboard ──────────────────────────────────────────
function buildKeyboard() {
  const vkb = $('vkb');
  if (!vkb) return;
  KB_ROWS.forEach(row => {
    const div = document.createElement('div');
    div.className = 'vkb-row';
    row.forEach(k => {
      const btn = document.createElement('button');
      btn.className = 'vkb-key';
      btn.textContent = k;
      btn.dataset.key = k;
      btn.dataset.code = `Key${k.toUpperCase()}`;
      div.appendChild(btn);
    });
    vkb.appendChild(div);
  });
}

function initKeyboard() {
  document.querySelectorAll('.vkb-key').forEach(btn => {
    btn.addEventListener('pointerdown', e => {
      e.preventDefault(); btn.classList.add('pressed');
      const k = st.mods.shift ? btn.dataset.key.toUpperCase() : btn.dataset.key;
      sendCtrl({ type:'keyboard', action:'keydown', key:k, code:btn.dataset.code, ...st.mods });
    });
    btn.addEventListener('pointerup', e => {
      e.preventDefault(); btn.classList.remove('pressed');
      sendCtrl({ type:'keyboard', action:'keyup', key:btn.dataset.key, code:btn.dataset.code });
    });
  });
  document.querySelectorAll('.spec-btn').forEach(btn => {
    btn.addEventListener('pointerdown', e => {
      e.preventDefault();
      sendCtrl({ type:'keyboard', action:'keydown', key:btn.dataset.key, code:btn.dataset.code, ...st.mods });
    });
    btn.addEventListener('pointerup', e => {
      e.preventDefault();
      sendCtrl({ type:'keyboard', action:'keyup', key:btn.dataset.key, code:btn.dataset.code });
    });
  });
  document.querySelectorAll('.mod-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const m = btn.dataset.mod;
      st.mods[m] = !st.mods[m];
      btn.classList.toggle('active', st.mods[m]);
    });
  });
}

// ── Helpers ───────────────────────────────────────────────────
function $(id) { return document.getElementById(id); }
function show(id) { const e = $(id); if (e) e.classList.remove('hidden'); }
function hide(id) { const e = $(id); if (e) e.classList.add('hidden'); }
function setText(id, t) { const e = $(id); if (e) e.textContent = t; }
function on(id, ev, fn) { const e = $(id); if (e) e.addEventListener(ev, fn); }
function setStatus(text, ok) {
  $('status-dot').className = 'dot ' + (ok ? 'ok' : '');
  setText('status-text', text);
}
function showMsg(msg, type) {
  const e = $('connect-status');
  e.textContent = msg;
  e.className = 'status-msg ' + (type || '');
}

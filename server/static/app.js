'use strict';
// BridgeCast — Desktop + Mobile Web App
// Signaling: /v1/ws?d=<base64(info)>&room=<CODE>
// The existing LocalSend WiFi file-transfer protocol is untouched.

/* ── Constants ─────────────────────────────────────────────── */
const PROTOCOL_VERSION = '2.3';
const DATACHANNEL_LABEL = 'bridge-control';
// Default ICE servers (STUN only). Overwritten by /v1/ice-servers after connect.
let ICE_SERVERS = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
];
const KB_ROWS = [
  ['1','2','3','4','5','6','7','8','9','0','-','='],
  ['q','w','e','r','t','y','u','i','o','p','[',']'],
  ['a','s','d','f','g','h','j','k','l',';',"'"],
  ['z','x','c','v','b','n','m',',','.','/'],
  [' '],
];
const EQ_BANDS = [
  { label:'Sub',   freq:60,    type:'lowshelf',  gain:0 },
  { label:'Bass',  freq:150,   type:'peaking',   gain:0 },
  { label:'Low-M', freq:400,   type:'peaking',   gain:0 },
  { label:'Mid',   freq:1000,  type:'peaking',   gain:0 },
  { label:'Hi-M',  freq:2500,  type:'peaking',   gain:0 },
  { label:'Pres',  freq:6000,  type:'peaking',   gain:0 },
  { label:'Treble',freq:16000, type:'highshelf', gain:0 },
];
const EQ_PRESETS = {
  flat:       [ 0, 0, 0, 0, 0, 0, 0],
  bass:       [ 6, 5, 2, 0,-1,-1,-2],
  vocal:      [-3,-2, 3, 4, 3, 0,-1],
  treble:     [-2,-2, 0, 0, 2, 4, 6],
  electronic: [ 4, 3,-1, 0, 0, 2, 3],
  rock:       [ 3, 2,-1,-1, 1, 3, 4],
  classical:  [ 0, 0, 0,-1, 0, 2, 3],
};

/* ── App State ─────────────────────────────────────────────── */
const state = {
  mode: 'desktop',
  ws: null, myId: null, alias: '', roomCode: '',
  peers: new Map(),
  audioCtx: null, audioNodes: {}, audioStream: null,
  videoStream: null, screenStream: null,
  mods: { ctrl:false, alt:false, shift:false, win:false },
};

/* ── Boot ──────────────────────────────────────────────────── */
document.addEventListener('DOMContentLoaded', () => {
  registerServiceWorker();
  initConnectScreen();
  buildEqualizer();
  buildKeyboard();

  // Pre-fill from URL params (phone scans QR → web opens with params)
  const params = new URLSearchParams(location.search);
  if (params.get('room'))   $('room-input').value   = params.get('room').toUpperCase();
  if (params.get('server')) $('server-input').value = params.get('server');
  if (params.get('mode'))   selectMode(params.get('mode'));
});

function registerServiceWorker() {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  }
}

/* ── Connect Screen ────────────────────────────────────────── */
function initConnectScreen() {
  $('alias-input').value = `My ${isMobile() ? 'Phone' : 'PC'}`;
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  $('server-input').value = `${proto}//${location.host}/v1/ws`;

  // Auto-generate room code or restore saved
  const saved = sessionStorage.getItem('bc_room');
  $('room-input').value = saved || generateRoomCode();

  if (isMobile()) selectMode('mobile');

  on('connect-btn', 'click', connect);
  on('room-gen-btn', 'click', () => { $('room-input').value = generateRoomCode(); });
  document.querySelectorAll('.mode-btn').forEach(b => b.addEventListener('click', () => selectMode(b.dataset.mode)));
  on('d-disconnect-btn', 'click', disconnect);
  on('m-disconnect-btn', 'click', disconnect);
  on('d-qr-btn', 'click', showQrModal);
  on('qr-close-btn', 'click', () => hide('qr-modal'));
  on('m-fullscreen-btn', 'click', () => {
    const v = $('m-screen-video');
    if (v) (v.requestFullscreen || v.webkitRequestFullscreen || (() => {})).call(v);
  });
}

function generateRoomCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  return Array.from(crypto.getRandomValues(new Uint8Array(6))).map(b => chars[b % chars.length]).join('');
}

function selectMode(mode) {
  state.mode = mode;
  document.querySelectorAll('.mode-btn').forEach(b => b.classList.toggle('active', b.dataset.mode === mode));
}

/* ── Connect / Disconnect ──────────────────────────────────── */
async function connect() {
  const alias  = $('alias-input').value.trim() || 'My Device';
  const server = $('server-input').value.trim();
  const room   = ($('room-input').value.trim() || generateRoomCode()).toUpperCase();
  state.alias = alias;
  state.roomCode = room;
  $('room-input').value = room;
  sessionStorage.setItem('bc_room', room);

  if (!server) { showConnectMsg('Enter the server address.', 'error'); return; }
  showConnectMsg('Connecting…');
  $('connect-btn').disabled = true;

  try {
    await openWebSocket(server, room);
    showApp();
  } catch (e) {
    showConnectMsg('Connection failed: ' + e.message, 'error');
    $('connect-btn').disabled = false;
  }
}

function disconnect() {
  if (state.ws) { try { state.ws.close(); } catch (_) {} state.ws = null; }
  state.peers.forEach(p => { try { p.pc && p.pc.close(); } catch (_) {} });
  state.peers.clear();
  stopAudioCtx();
  if (state.screenStream) { state.screenStream.getTracks().forEach(t => t.stop()); state.screenStream = null; }
  hide('desktop-app'); hide('mobile-app');
  show('connect-screen');
  showConnectMsg('Disconnected.');
  $('connect-btn').disabled = false;
}

function showApp() {
  hide('connect-screen');
  if (state.mode === 'desktop') {
    show('desktop-app');
    setText('d-room-code', state.roomCode);
    initDesktopTabs();
    initDesktopStreaming();
    initDesktopVideo();
    initScreenShare();
  } else {
    show('mobile-app');
    initMobileTabs();
    initGamepad();
    initTouchpad();
    initKeyboard();
  }
}

/* ── QR Code Modal ─────────────────────────────────────────── */
function showQrModal() {
  const area = $('qr-code-area');
  area.innerHTML = '';
  const wsUrl  = $('server-input').value.trim();
  const httpBase = wsUrl.replace(/^ws(s?):\/\//, (_, s) => `http${s}://`).replace(/\/v1\/ws$/, '');
  const webUrl = `${httpBase}/?room=${state.roomCode}&server=${encodeURIComponent(wsUrl)}&mode=mobile`;

  if (window.QRCode) {
    new QRCode(area, { text: webUrl, width: 200, height: 200, colorDark:'#111827', colorLight:'#ffffff' });
  } else {
    area.textContent = webUrl;
    area.style.wordBreak = 'break-all';
    area.style.padding = '10px';
    area.style.fontSize = '11px';
  }
  setText('qr-ws-url', wsUrl);
  setText('qr-room-text', state.roomCode);
  show('qr-modal');
}

/* ── WebSocket Signaling ────────────────────────────────────── */
function openWebSocket(serverUrl, room) {
  return new Promise((resolve, reject) => {
    const info = {
      alias: state.alias, version: PROTOCOL_VERSION,
      deviceModel: isMobile() ? 'WebPhone' : 'WebPC',
      deviceType:  isMobile() ? 'MOBILE'   : 'DESKTOP',
      token: crypto.randomUUID(),
    };
    const d = btoa(JSON.stringify(info));
    const url = `${serverUrl}?d=${encodeURIComponent(d)}&room=${encodeURIComponent(room)}`;
    const ws = new WebSocket(url);
    ws.onopen  = () => { state.ws = ws; };
    ws.onerror = () => reject(new Error('WebSocket error'));
    ws.onclose = () => {
      if (!state.myId) reject(new Error('Closed before HELLO'));
      else { if (state.mode === 'desktop') setText('d-peer-count','Disconnected'); else setMobileStatus('Disconnected', false); }
    };
    ws.onmessage = ev => {
      try { handleSignal(JSON.parse(ev.data), resolve, reject); } catch(_) {}
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
      addPeer(msg.peer); updatePeerUI();
      if (state.mode === 'desktop') initiateOffer(msg.peer.id);
      break;
    case 'LEFT':  removePeer(msg.peerId); updatePeerUI(); break;
    case 'UPDATE':
      if (state.peers.has(msg.peer.id)) { state.peers.get(msg.peer.id).info = msg.peer; updatePeerUI(); }
      break;
    case 'OFFER':  handleOffer(msg);  break;
    case 'ANSWER': handleAnswer(msg); break;
  }
}
function sendSignal(o) {
  if (state.ws && state.ws.readyState === 1) state.ws.send(JSON.stringify(o));
}

/* ── Peer Management ────────────────────────────────────────── */
function addPeer(info) {
  if (!state.peers.has(info.id)) state.peers.set(info.id, { info, pc:null, dc:null, streams:[] });
}
function removePeer(id) {
  const p = state.peers.get(id);
  if (p) { try{p.dc&&p.dc.close()}catch(_){} try{p.pc&&p.pc.close()}catch(_){} state.peers.delete(id); }
}
function getPeer(id) { return state.peers.get(id); }

function updatePeerUI() {
  const count = state.peers.size;
  if (state.mode === 'desktop') {
    setText('d-peer-count', `${count} peer${count!==1?'s':''}`);
    const dot = $('d-status-dot');
    if (dot) dot.className = 'dot ' + (count > 0 ? 'online' : '');
    const peersList = [...state.peers.values()];
    renderPeerList('d-peers-list', peersList);
    renderPeerList('stream-peers-list', peersList);
    renderPeerList('video-peers-list', peersList);
    renderPeerList('screen-peers-list', peersList);
  } else {
    setMobileStatus(count > 0 ? `${count} connected` : 'Waiting for desktop…', count > 0);
  }
}

function renderPeerList(id, peers) {
  const el = $(id); if (!el) return;
  if (!peers.length) { el.innerHTML = '<div class="empty-state">No devices connected yet.</div>'; return; }
  el.innerHTML = peers.map(p => `
    <div class="peer-item">
      <div class="peer-icon">${deviceIcon(p.info.deviceType)}</div>
      <div class="peer-info">
        <div class="peer-name">${escHtml(p.info.alias)}</div>
        <div class="peer-meta">${p.info.deviceType||'Unknown'} · ${p.info.deviceModel||''}</div>
      </div>
    </div>`).join('');
}
function deviceIcon(t) { return {MOBILE:'📱',DESKTOP:'🖥️',WEB:'🌐'}[t]||'📡'; }

/* ── WebRTC ─────────────────────────────────────────────────── */
function createPC(peerId) {
  const peer = getPeer(peerId); if (!peer) return null;
  if (peer.pc) return peer.pc;
  const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
  peer.pc = pc;
  pc.oniceconnectionstatechange = () => { if (pc.iceConnectionState==='failed') pc.restartIce(); };
  pc.ontrack = ev => {
    const stream = ev.streams[0]; if (!stream) return;
    peer.streams.push(stream);
    if (state.mode === 'mobile') receiveMobileStream(stream, ev.track.kind);
  };
  pc.ondatachannel = ev => { peer.dc = ev.channel; setupDC(peer.dc, peerId, false); };
  return pc;
}

async function initiateOffer(peerId) {
  const peer = getPeer(peerId); if (!peer) return;
  const pc = createPC(peerId);
  peer.dc = pc.createDataChannel(DATACHANNEL_LABEL, { ordered:true });
  setupDC(peer.dc, peerId, true);
  addTracksToPC(pc);
  try {
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    await waitGather(pc);
    peer._sessionId = crypto.randomUUID();
    sendSignal({ type:'OFFER', sessionId:peer._sessionId, target:peerId, sdp:compressSdp(pc.localDescription.sdp) });
  } catch(e) { console.error('offer', e); }
}

async function handleOffer(msg) {
  const peerId = msg.peer.id;
  if (!state.peers.has(peerId)) addPeer(msg.peer);
  const peer = getPeer(peerId);
  const pc = createPC(peerId);
  try {
    await pc.setRemoteDescription({ type:'offer', sdp: decompressSdp(msg.sdp) });
    const ans = await pc.createAnswer();
    await pc.setLocalDescription(ans);
    await waitGather(pc);
    sendSignal({ type:'ANSWER', sessionId:msg.sessionId, target:peerId, sdp:compressSdp(pc.localDescription.sdp) });
  } catch(e) { console.error('answer', e); }
}

async function handleAnswer(msg) {
  const peer = getPeer(msg.peer.id);
  if (!peer || !peer.pc) return;
  try { await peer.pc.setRemoteDescription({ type:'answer', sdp: decompressSdp(msg.sdp) }); } catch(_){}
}

function waitGather(pc) {
  return new Promise(r => {
    if (pc.iceGatheringState === 'complete') return r();
    const fn = () => { if (pc.iceGatheringState==='complete') { pc.removeEventListener('icegatheringstatechange',fn); r(); }};
    pc.addEventListener('icegatheringstatechange', fn);
    setTimeout(r, 3000);
  });
}

function addTracksToPC(pc) {
  [state.audioStream, state.videoStream, state.screenStream].forEach(s => {
    if (s) s.getTracks().forEach(t => { try { pc.addTrack(t, s); } catch(_){} });
  });
}

async function renegotiate(peerId) {
  const peer = getPeer(peerId); if (!peer || !peer.pc) return;
  try {
    const offer = await peer.pc.createOffer();
    await peer.pc.setLocalDescription(offer);
    await waitGather(peer.pc);
    sendSignal({ type:'OFFER', sessionId:crypto.randomUUID(), target:peerId, sdp:compressSdp(peer.pc.localDescription.sdp) });
  } catch(e) { console.error('renegotiate', e); }
}

/* ── SDP Compression ────────────────────────────────────────── */
function compressSdp(sdp) {
  const b = pako.deflate(new TextEncoder().encode(sdp));
  return btoa(String.fromCharCode(...b)).replace(/=/g,'');
}
function decompressSdp(b64) {
  const pad = b64 + '=='.slice((b64.length+3)&3||4);
  const bin = atob(pad);
  const bytes = new Uint8Array(bin.length);
  for (let i=0;i<bin.length;i++) bytes[i]=bin.charCodeAt(i);
  return new TextDecoder().decode(pako.inflate(bytes));
}

/* ── Data Channel ───────────────────────────────────────────── */
function setupDC(dc, peerId, isInitiator) {
  dc.onopen  = () => { if (state.mode==='desktop') updateControlStatus(true); };
  dc.onclose = () => { if (state.mode==='desktop') updateControlStatus(false); };
  dc.onmessage = ev => { try { handleControlEvent(JSON.parse(ev.data)); } catch(_){} };
}
function sendControl(ev) {
  const msg = JSON.stringify(ev);
  state.peers.forEach(p => { if (p.dc && p.dc.readyState==='open') p.dc.send(msg); });
}
function handleControlEvent(ev) {
  switch (ev.type) {
    case 'gamepad':   handleGpEvent(ev);  break;
    case 'mouse':     handleMouseEvent(ev); break;
    case 'keyboard':  handleKbEvent(ev);  break;
  }
}
function handleGpEvent(ev) {
  updateControlStatus(true);
  if (ev.button) { const el=$(('gp-'+ev.button)); if(el) el.classList.toggle('pressed', ev.state==='pressed'); }
  if (ev.axis) {
    const id = ev.axis==='left' ? 'gp-lstick' : 'gp-rstick';
    const dot = $(id)?.querySelector('.stick-dot');
    if (dot) dot.style.transform = `translate(calc(-50% + ${ev.x*14}px), calc(-50% + ${ev.y*14}px))`;
  }
}
function handleMouseEvent(ev) {
  updateControlStatus(true);
  if (ev.action==='move')   setText('mouse-pos',    `Position: Δ(${Math.round(ev.dx)}, ${Math.round(ev.dy)})`);
  if (ev.action==='click')  setText('mouse-btn',    `Button: ${ev.button}`);
  if (ev.action==='scroll') setText('mouse-scroll', `Scroll: ${ev.dy>0?'▼':'▲'} ${Math.abs(ev.dy)}`);
}
function handleKbEvent(ev) {
  updateControlStatus(true);
  if (ev.action==='keydown') {
    setText('kbd-last-key', `Last key: ${ev.key}`);
    const mods=[ev.ctrl&&'Ctrl',ev.shift&&'Shift',ev.alt&&'Alt',ev.win&&'Win'].filter(Boolean);
    setText('kbd-combo', `Combo: ${mods.length?mods.join('+')+'+':''}${ev.key}`);
    document.dispatchEvent(new KeyboardEvent('keydown',{
      key:ev.key, code:ev.code, ctrlKey:!!ev.ctrl, shiftKey:!!ev.shift, altKey:!!ev.alt, metaKey:!!ev.win,
      bubbles:true, cancelable:true,
    }));
  }
}
function updateControlStatus(on) {
  const dot=$('ctrl-dot'), txt=$('ctrl-status-text');
  if (dot) dot.className = 'dot ' + (on ? 'active' : '');
  if (txt) txt.textContent = on ? 'Phone connected — receiving input' : 'Waiting for phone…';
}

/* ── Audio Streaming ────────────────────────────────────────── */
function initDesktopStreaming() {
  const af = $('audio-file');
  if (af) af.addEventListener('change', e => { if(e.target.files[0]) loadAudioFile(e.target.files[0]); });
  on('audio-stream-btn', 'click', startAudioStream);
  on('audio-stop-btn',   'click', stopAudioStream);
  const drop = $('audio-drop');
  if (drop) {
    drop.addEventListener('dragover', e => { e.preventDefault(); drop.classList.add('dragging'); });
    drop.addEventListener('dragleave', () => drop.classList.remove('dragging'));
    drop.addEventListener('drop', e => { e.preventDefault(); drop.classList.remove('dragging'); const f=e.dataTransfer.files[0]; if(f&&f.type.startsWith('audio/')) loadAudioFile(f); });
  }
}

function loadAudioFile(file) {
  const el = $('audio-el');
  el.src = URL.createObjectURL(file);
  hide('audio-drop'); show('audio-player-wrap');
  setText('audio-track-name', file.name.replace(/\.[^.]+$/,''));
  setText('audio-track-meta', `${file.type} · ${formatBytes(file.size)}`);
  initAudioContext(el);
}

function startAudioStream() {
  const el = $('audio-el');
  if (!el.src) { alert('Load an audio file first.'); return; }
  let stream;
  try { stream = el.captureStream ? el.captureStream() : el.mozCaptureStream(); }
  catch(_) { alert('captureStream not supported. Use Chrome or Edge.'); return; }
  state.audioStream = stream;
  state.peers.forEach((_, pid) => {
    const p = getPeer(pid);
    if (p?.pc) { stream.getTracks().forEach(t => { try{p.pc.addTrack(t,stream);}catch(_){} }); renegotiate(pid); }
  });
  el.play();
  hide('audio-stream-btn'); show('audio-stop-btn'); show('audio-stream-status');
  setText('audio-stream-status', `🔴 Live — ${state.peers.size} device(s)`);
}

function stopAudioStream() {
  if (state.audioStream) { state.audioStream.getTracks().forEach(t=>t.stop()); state.audioStream=null; }
  $('audio-el').pause();
  show('audio-stream-btn'); hide('audio-stop-btn'); hide('audio-stream-status');
}

/* ── Video Streaming ────────────────────────────────────────── */
function initDesktopVideo() {
  const vf = $('video-file');
  if (vf) vf.addEventListener('change', e => {
    const f = e.target.files[0]; if (!f) return;
    $('video-el').src = URL.createObjectURL(f);
    hide('video-drop'); show('video-player-wrap');
  });
  on('video-stream-btn', 'click', startVideoStream);
  on('video-stop-btn',   'click', stopVideoStream);
  const drop = $('video-drop');
  if (drop) {
    drop.addEventListener('dragover', e => { e.preventDefault(); drop.classList.add('dragging'); });
    drop.addEventListener('dragleave', () => drop.classList.remove('dragging'));
    drop.addEventListener('drop', e => {
      e.preventDefault(); drop.classList.remove('dragging');
      const f = e.dataTransfer.files[0];
      if (f && f.type.startsWith('video/')) { $('video-el').src=URL.createObjectURL(f); hide('video-drop'); show('video-player-wrap'); }
    });
  }
}

function startVideoStream() {
  const el = $('video-el'); if (!el.src) { alert('Load a video file first.'); return; }
  let stream;
  try { stream = el.captureStream ? el.captureStream() : el.mozCaptureStream(); }
  catch(_) { alert('captureStream not supported. Use Chrome or Edge.'); return; }
  state.videoStream = stream;
  state.peers.forEach((_, pid) => {
    const p = getPeer(pid);
    if (p?.pc) { stream.getTracks().forEach(t => { try{p.pc.addTrack(t,stream);}catch(_){} }); renegotiate(pid); }
  });
  el.play();
  hide('video-stream-btn'); show('video-stop-btn');
}

function stopVideoStream() {
  if (state.videoStream) { state.videoStream.getTracks().forEach(t=>t.stop()); state.videoStream=null; }
  $('video-el').pause();
  show('video-stream-btn'); hide('video-stop-btn');
}

/* ── Screen Share ───────────────────────────────────────────── */
function initScreenShare() {
  on('screen-share-btn', 'click', startScreenShare);
  on('screen-stop-btn',  'click', stopScreenShare);
}

async function startScreenShare() {
  try {
    const stream = await navigator.mediaDevices.getDisplayMedia({
      video: { cursor: 'always', frameRate: { ideal:30, max:60 } },
      audio: { echoCancellation:false, noiseSuppression:false, suppressLocalAudioPlayback:false },
    });
    state.screenStream = stream;

    // Preview locally
    const preview = $('screen-preview-video');
    if (preview) { preview.srcObject = stream; preview.play().catch(()=>{}); }

    // Stream to all phones
    state.peers.forEach((_, pid) => {
      const p = getPeer(pid);
      if (p?.pc) { stream.getTracks().forEach(t => { try{p.pc.addTrack(t,stream);}catch(_){} }); renegotiate(pid); }
    });

    // Stop when user clicks browser's built-in "Stop sharing"
    stream.getVideoTracks()[0].onended = () => stopScreenShare();

    hide('screen-idle'); show('screen-active');
    setText('screen-share-status', `🔴 Sharing to ${state.peers.size} phone(s)`);
  } catch(e) {
    if (e.name !== 'NotAllowedError') alert('Screen share failed: ' + e.message);
  }
}

function stopScreenShare() {
  if (state.screenStream) { state.screenStream.getTracks().forEach(t=>t.stop()); state.screenStream=null; }
  const preview = $('screen-preview-video');
  if (preview) preview.srcObject = null;
  show('screen-idle'); hide('screen-active');
}

/* ── Mobile: Receive Streams ────────────────────────────────── */
function receiveMobileStream(stream, kind) {
  setMobileStatus('Receiving stream', true);

  // Route audio (from both audio files and video/screen streams)
  if (stream.getAudioTracks().length > 0) {
    const audio = $('m-audio-el');
    if (audio) {
      audio.srcObject = stream;
      audio.volume = ($('m-volume')?.value || 100) / 100;
      audio.play().catch(() => {
        const btn = document.createElement('button');
        btn.textContent = '▶ Tap to play'; btn.className = 'btn-primary';
        btn.style.cssText = 'margin:12px auto;display:block';
        btn.onclick = () => { audio.play(); btn.remove(); };
        $('m-bridge')?.appendChild(btn);
      });
      show('m-now-playing');
      setText('m-track-name', kind==='audio' ? 'Audio from PC' : 'Video audio from PC');
      // MediaSession for lock screen
      if ('mediaSession' in navigator) {
        navigator.mediaSession.metadata = new MediaMetadata({ title:'BridgeCast', artist:'Streaming from PC' });
        navigator.mediaSession.playbackState = 'playing';
        navigator.mediaSession.setActionHandler('play',  () => audio.play());
        navigator.mediaSession.setActionHandler('pause', () => audio.pause());
      }
      // WakeLock
      if ('wakeLock' in navigator) navigator.wakeLock.request('screen').catch(()=>{});
    }
  }

  // Route video (screen share or video file)
  if (stream.getVideoTracks().length > 0) {
    const vid = $('m-screen-video');
    if (vid) {
      vid.srcObject = stream;
      vid.play().catch(()=>{});
      hide('m-screen-wait');
      show('m-screen-active');
    }
  }

  // Volume slider
  const vol = $('m-volume');
  if (vol) vol.oninput = () => {
    const audio = $('m-audio-el');
    if (audio) audio.volume = vol.value / 100;
  };
}

function setMobileStatus(text, active) {
  const dot = $('m-status-dot'), txt = $('m-status-text');
  const bdot = $('m-bridge-dot'), btxt = $('m-bridge-text');
  if (dot) dot.className = 'dot ' + (active ? 'online' : '');
  if (txt) txt.textContent = text;
  if (bdot) bdot.className = 'dot ' + (active ? 'streaming' : '');
  if (btxt) btxt.textContent = text;
}

/* ── Equalizer ──────────────────────────────────────────────── */
function initAudioContext(audioEl) {
  if (state.audioCtx) stopAudioCtx();
  const ctx = new (window.AudioContext || window.webkitAudioContext)();
  state.audioCtx = ctx;
  const source = ctx.createMediaElementSource(audioEl);
  state.audioNodes = {};
  let node = source;
  EQ_BANDS.forEach((band, i) => {
    const f = ctx.createBiquadFilter();
    f.type = band.type; f.frequency.value = band.freq; f.gain.value = 0;
    if (band.type==='peaking') f.Q.value = 1.0;
    state.audioNodes[`band_${i}`] = f;
    node.connect(f); node = f;
  });
  const master = ctx.createGain(); master.gain.value = 1;
  state.audioNodes.master = master;
  node.connect(master);
  const analyser = ctx.createAnalyser(); analyser.fftSize = 256;
  state.audioNodes.analyser = analyser;
  master.connect(analyser); analyser.connect(ctx.destination);
  startVisualizer(analyser);
  connectEQSliders();
}

function stopAudioCtx() {
  if (state.audioCtx) { try{state.audioCtx.close();}catch(_){} state.audioCtx=null; }
  if (state._vizRaf) { cancelAnimationFrame(state._vizRaf); state._vizRaf=null; }
}

function buildEqualizer() {
  const container = $('eq-bands'); if (!container) return;
  EQ_BANDS.forEach((band, i) => {
    const div = document.createElement('div');
    div.className = 'eq-band';
    div.innerHTML = `<span class="gain-val" id="eq-val-${i}">0 dB</span>
      <input type="range" class="eq-slider" id="eq-slider-${i}" min="-12" max="12" value="0" step="0.5">
      <label>${band.label}<br><small>${band.freq>=1000?(band.freq/1000)+'k':band.freq} Hz</small></label>`;
    container.appendChild(div);
  });
  on('eq-master-vol', 'input', function() {
    setText('eq-master-val', this.value+'%');
    if (state.audioNodes.master) state.audioNodes.master.gain.value = this.value/100;
  });
  document.querySelectorAll('.preset-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.preset-btn').forEach(b=>b.classList.remove('active'));
      btn.classList.add('active');
      applyPreset(btn.dataset.preset);
    });
  });
}

function connectEQSliders() {
  EQ_BANDS.forEach((_, i) => {
    const slider = $(`eq-slider-${i}`); if (!slider) return;
    slider.addEventListener('input', function() {
      const g = parseFloat(this.value);
      setText(`eq-val-${i}`, (g>0?'+':'')+g+' dB');
      if (state.audioNodes[`band_${i}`]) state.audioNodes[`band_${i}`].gain.value = g;
    });
  });
}

function applyPreset(preset) {
  const gains = EQ_PRESETS[preset] || EQ_PRESETS.flat;
  gains.forEach((g, i) => {
    const s = $(`eq-slider-${i}`); if (!s) return;
    s.value = g;
    setText(`eq-val-${i}`, (g>0?'+':'')+g+' dB');
    if (state.audioNodes[`band_${i}`]) state.audioNodes[`band_${i}`].gain.value = g;
  });
}

function startVisualizer(analyser) {
  const canvas = $('eq-canvas'); if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const buf = new Uint8Array(analyser.frequencyBinCount);
  function draw() {
    state._vizRaf = requestAnimationFrame(draw);
    analyser.getByteFrequencyData(buf);
    const W=canvas.clientWidth, H=canvas.clientHeight;
    canvas.width=W; canvas.height=H;
    ctx.clearRect(0,0,W,H);
    const bw = W/buf.length*2.5;
    let x=0;
    for (let i=0;i<buf.length;i++) {
      const h=(buf[i]/255)*H;
      ctx.fillStyle=`hsl(${200+(buf[i]/255)*60},80%,55%)`;
      ctx.fillRect(x, H-h, bw-1, h);
      x+=bw+1;
    }
  }
  draw();
}

/* ── Gamepad (mobile → sends to desktop) ───────────────────── */
function initGamepad() {
  document.querySelectorAll('[data-btn]').forEach(el => {
    el.addEventListener('pointerdown', e => {
      e.preventDefault(); el.classList.add('pressed');
      sendControl({ type:'gamepad', button:el.dataset.btn, state:'pressed' });
    });
    const up = () => { el.classList.remove('pressed'); sendControl({ type:'gamepad', button:el.dataset.btn, state:'released' }); };
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
  });
  initStick('left-stick', 'left');
  initStick('right-stick', 'right');
}

function initStick(zoneId, axis) {
  const zone=$(zoneId), thumb=zone?.querySelector('.stick-thumb');
  if (!zone||!thumb) return;
  let active=false;
  zone.addEventListener('pointerdown', e => { e.preventDefault(); active=true; zone.setPointerCapture(e.pointerId); zone.classList.add('active'); });
  zone.addEventListener('pointermove', e => {
    if (!active) return; e.preventDefault();
    const r=zone.getBoundingClientRect(), cx=r.left+r.width/2, cy=r.top+r.height/2;
    let dx=e.clientX-cx, dy=e.clientY-cy;
    const maxD=r.width/2-18, dist=Math.sqrt(dx*dx+dy*dy);
    if (dist>maxD) { dx*=maxD/dist; dy*=maxD/dist; }
    thumb.style.transform=`translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;
    sendControl({ type:'gamepad', axis, x:+(dx/maxD).toFixed(3), y:+(dy/maxD).toFixed(3) });
  });
  const rel = () => { if(!active) return; active=false; zone.classList.remove('active'); thumb.style.transform='translate(-50%,-50%)'; sendControl({type:'gamepad',axis,x:0,y:0}); };
  zone.addEventListener('pointerup', rel);
  zone.addEventListener('pointercancel', rel);
}

/* ── Touchpad / Mouse ───────────────────────────────────────── */
function initTouchpad() {
  const pad=$('touchpad'), cursor=$('tp-cursor'); if (!pad) return;
  let lx=null, ly=null;
  pad.addEventListener('pointerdown', e => {
    e.preventDefault(); pad.setPointerCapture(e.pointerId);
    lx=e.clientX; ly=e.clientY; cursor.style.opacity='1'; moveCursor(e,pad,cursor);
  });
  pad.addEventListener('pointermove', e => {
    if (lx===null) return;
    const dx=(e.clientX-lx)*1.5, dy=(e.clientY-ly)*1.5;
    lx=e.clientX; ly=e.clientY; moveCursor(e,pad,cursor);
    if (Math.abs(dx)>0.2||Math.abs(dy)>0.2) sendControl({type:'mouse',action:'move',dx,dy});
  });
  const rel=()=>{lx=null; cursor.style.opacity='0';};
  pad.addEventListener('pointerup',rel); pad.addEventListener('pointercancel',rel);
  [['mb-left','left'],['mb-right','right'],['mb-middle','middle']].forEach(([id,btn])=>{
    $(id)?.addEventListener('pointerdown', e=>{e.preventDefault(); sendControl({type:'mouse',action:'click',button:btn});});
  });
  $('mb-scroll-up')?.addEventListener('pointerdown',  e=>{e.preventDefault(); sendControl({type:'mouse',action:'scroll',dy:-3});});
  $('mb-scroll-down')?.addEventListener('pointerdown', e=>{e.preventDefault(); sendControl({type:'mouse',action:'scroll',dy:3});});
}
function moveCursor(e, pad, cursor) {
  const r=pad.getBoundingClientRect();
  cursor.style.left=(e.clientX-r.left)+'px';
  cursor.style.top=(e.clientY-r.top)+'px';
}

/* ── Virtual Keyboard ───────────────────────────────────────── */
function buildKeyboard() {
  const vkb=$('vkb'); if (!vkb) return;
  KB_ROWS.forEach(row => {
    const div=document.createElement('div'); div.className='vkb-row';
    row.forEach(k => {
      const btn=document.createElement('button');
      btn.className='vkb-key'+(k===' '?' space':k.length>1?' wide':'');
      btn.textContent=k===' '?'SPACE':k;
      btn.dataset.key=k; btn.dataset.code=k===' '?'Space':`Key${k.toUpperCase()}`;
      div.appendChild(btn);
    });
    vkb.appendChild(div);
  });
}

function initKeyboard() {
  document.querySelectorAll('.vkb-key').forEach(btn => {
    btn.addEventListener('pointerdown', e => {
      e.preventDefault(); btn.classList.add('pressed');
      const k=state.mods.shift&&btn.dataset.key.length===1?btn.dataset.key.toUpperCase():btn.dataset.key;
      sendControl({type:'keyboard',action:'keydown',key:k,code:btn.dataset.code,...state.mods});
    });
    btn.addEventListener('pointerup', e => {
      e.preventDefault(); btn.classList.remove('pressed');
      sendControl({type:'keyboard',action:'keyup',key:btn.dataset.key,code:btn.dataset.code});
    });
  });
  document.querySelectorAll('.spec-btn').forEach(btn => {
    btn.addEventListener('pointerdown', e => { e.preventDefault(); sendControl({type:'keyboard',action:'keydown',key:btn.dataset.key,code:btn.dataset.code,...state.mods}); });
    btn.addEventListener('pointerup',   e => { e.preventDefault(); sendControl({type:'keyboard',action:'keyup',key:btn.dataset.key,code:btn.dataset.code}); });
  });
  document.querySelectorAll('.mod-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const m=btn.dataset.mod; state.mods[m]=!state.mods[m]; btn.classList.toggle('active',state.mods[m]);
    });
  });
}

/* ── Tabs ───────────────────────────────────────────────────── */
function initDesktopTabs() {
  document.querySelectorAll('#d-tabs .tab-btn').forEach(btn => btn.addEventListener('click', () => switchTab(btn,'d-tabs')));
}
function initMobileTabs() {
  document.querySelectorAll('#m-tabs .tab-btn').forEach(btn => btn.addEventListener('click', () => switchTab(btn,'m-tabs')));
}
function switchTab(btn, navId) {
  document.querySelectorAll(`#${navId} .tab-btn`).forEach(b=>b.classList.remove('active'));
  btn.classList.add('active');
  document.querySelectorAll('.tab-panel').forEach(p=>{p.classList.remove('active');p.classList.add('hidden');});
  const panel=$(btn.dataset.tab);
  if (panel) { panel.classList.remove('hidden'); panel.classList.add('active'); }
  if (btn.dataset.tab==='d-equalizer' && $('audio-el')?.src && !state.audioCtx) initAudioContext($('audio-el'));
}

/* ── Helpers ────────────────────────────────────────────────── */
function $(id) { return document.getElementById(id); }
function show(id) { const e=$(id); if(e) e.classList.remove('hidden'); }
function hide(id) { const e=$(id); if(e) e.classList.add('hidden'); }
function setText(id,t) { const e=$(id); if(e) e.textContent=t; }
function on(id,ev,fn) { const e=$(id); if(e) e.addEventListener(ev,fn); }
function escHtml(s) { return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
function isMobile() { return /Mobi|Android|iPhone|iPad/i.test(navigator.userAgent)||window.innerWidth<600; }
function formatBytes(n) { return n<1048576?(n/1024).toFixed(1)+' KB':(n/1048576).toFixed(1)+' MB'; }
function showConnectMsg(msg,type) { const e=$('connect-status'); if(!e) return; e.textContent=msg; e.className='status-msg '+(type||''); }

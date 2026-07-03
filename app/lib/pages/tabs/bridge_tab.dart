import 'dart:async';
import 'dart:io';

import 'package:file_picker/file_picker.dart';
import 'package:flutter/material.dart';
import 'package:localsend_app/widget/responsive_list_view.dart';
import 'package:pretty_qr_code/pretty_qr_code.dart';
import 'package:wakelock_plus/wakelock_plus.dart';

const _horizontalPadding = 15.0;
const _brandName = 'ZealBridge';

class BridgeTab extends StatefulWidget {
  const BridgeTab({super.key});

  @override
  State<BridgeTab> createState() => _BridgeTabState();
}

class _BridgeTabState extends State<BridgeTab> with WidgetsBindingObserver {
  HttpServer? _server;
  File? _mediaFile;
  String? _url;
  String? _directConnectUri;
  String _status = 'Choose any media file, start ZealBridge, then connect a paired device in the app or scan the fallback QR.';
  double _bass = 0;
  double _treble = 0;
  double _gain = 0;
  bool _screenMirror = false;
  bool _remoteInput = false;
  bool _turnRelay = false;
  bool _isPlaying = false;
  double _positionSeconds = 0;
  double _playbackRate = 1;
  double _volume = 0; // Desktop bridge output stays muted by default.
  bool _keepAwake = false;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    unawaited(_server?.close(force: true));
    unawaited(_setBridgeAwake(false));
    super.dispose();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (_server == null || !mounted) return;
    if (state == AppLifecycleState.paused || state == AppLifecycleState.inactive || state == AppLifecycleState.hidden) {
      setState(() {
        _status = 'ZealBridge is still serving in the background. Keep the app open when possible so mobile-to-mobile or desktop-to-mobile playback stays connected.';
      });
    }
  }

  Future<void> _setBridgeAwake(bool enabled) async {
    _keepAwake = enabled;
    if (enabled) {
      await WakelockPlus.enable();
    } else {
      await WakelockPlus.disable();
    }
  }

  Future<void> _pickMedia() async {
    final result = await FilePicker.platform.pickFiles(type: FileType.any, allowMultiple: false);
    final path = result?.files.single.path;
    if (path == null) {
      return;
    }
    setState(() {
      _mediaFile = File(path);
      _status = 'Selected ${path.split(Platform.pathSeparator).last}. Start ZealBridge to stream it in-app with synced controls from desktop or mobile.';
    });
  }

  Future<void> _startServer() async {
    final mediaFile = _mediaFile;
    if (mediaFile == null || !await mediaFile.exists()) {
      setState(() => _status = 'Select a local media file first.');
      return;
    }

    await _server?.close(force: true);
    final server = await HttpServer.bind(InternetAddress.anyIPv4, 0, shared: true);
    server.listen((request) => _handleRequest(request, mediaFile));
    final host = await _bestLanAddress();
    final url = 'http://$host:${server.port}/stream';
    final directConnectUri = Uri(
      scheme: 'zealbridge',
      host: 'connect',
      queryParameters: {
        'stream': url,
        'player': url.replaceFirst('/stream', '/'),
        'state': url.replaceFirst('/stream', '/state'),
        'control': url.replaceFirst('/stream', '/control'),
        'mode': 'app',
      },
    ).toString();

    await _setBridgeAwake(true);

    setState(() {
      _server = server;
      _url = url;
      _directConnectUri = directConnectUri;
      _status = 'ZealBridge is live in the background. Nearby ZealBridge apps can connect directly; the QR contains an app deep link with a browser fallback.';
    });
  }

  Future<void> _stopServer() async {
    await _server?.close(force: true);
    await _setBridgeAwake(false);
    setState(() {
      _server = null;
      _url = null;
      _directConnectUri = null;
      _status = 'ZealBridge stopped.';
    });
  }

  Future<String> _bestLanAddress() async {
    final interfaces = await NetworkInterface.list(type: InternetAddressType.IPv4, includeLoopback: false);
    for (final interface in interfaces) {
      for (final address in interface.addresses) {
        if (address.address.startsWith('192.168.') || address.address.startsWith('10.') || address.address.startsWith('172.')) {
          return address.address;
        }
      }
    }
    for (final interface in interfaces) {
      for (final address in interface.addresses) {
        return address.address;
      }
    }
    return InternetAddress.loopbackIPv4.address;
  }

  Future<void> _handleRequest(HttpRequest request, File file) async {
    if (request.uri.path == '/') {
      request.response
        ..headers.contentType = ContentType.html
        ..write(_playerHtml(_contentType(file.path).primaryType))
        ..close();
      return;
    }

    if (request.uri.path == '/state') {
      request.response
        ..headers.contentType = ContentType.json
        ..write(_stateJson())
        ..close();
      return;
    }

    if (request.uri.path == '/control') {
      _applyControl(request.uri.queryParameters);
      request.response
        ..headers.contentType = ContentType.json
        ..write(_stateJson())
        ..close();
      return;
    }

    if (request.uri.path != '/stream') {
      request.response.statusCode = HttpStatus.notFound;
      await request.response.close();
      return;
    }

    final length = await file.length();
    final range = request.headers.value(HttpHeaders.rangeHeader);
    var start = 0;
    var end = length - 1;
    if (range != null && range.startsWith('bytes=')) {
      final parts = range.substring(6).split('-');
      start = int.tryParse(parts.first) ?? 0;
      if (parts.length > 1 && parts[1].isNotEmpty) {
        end = int.tryParse(parts[1]) ?? end;
      }
      request.response.statusCode = HttpStatus.partialContent;
      request.response.headers.set(HttpHeaders.contentRangeHeader, 'bytes $start-$end/$length');
    }

    final contentLength = end - start + 1;
    request.response.headers
      ..set(HttpHeaders.acceptRangesHeader, 'bytes')
      ..set(HttpHeaders.contentLengthHeader, contentLength)
      ..contentType = _contentType(file.path);
    await request.response.addStream(file.openRead(start, end + 1));
    await request.response.close();
  }

  ContentType _contentType(String path) {
    final lower = path.toLowerCase();
    if (lower.endsWith('.mp3')) return ContentType('audio', 'mpeg');
    if (lower.endsWith('.m4a')) return ContentType('audio', 'mp4');
    if (lower.endsWith('.wav')) return ContentType('audio', 'wav');
    if (lower.endsWith('.flac')) return ContentType('audio', 'flac');
    if (lower.endsWith('.ogg')) return ContentType('audio', 'ogg');
    if (lower.endsWith('.webm')) return ContentType('video', 'webm');
    if (lower.endsWith('.mov')) return ContentType('video', 'quicktime');
    if (lower.endsWith('.mkv')) return ContentType('video', 'x-matroska');
    return ContentType('video', 'mp4');
  }

  void _applyControl(Map<String, String> query) {
    setState(() {
      if (query['action'] == 'play') _isPlaying = true;
      if (query['action'] == 'pause') _isPlaying = false;
      _positionSeconds = double.tryParse(query['position'] ?? '') ?? _positionSeconds;
      _playbackRate = double.tryParse(query['rate'] ?? '') ?? _playbackRate;
      _volume = double.tryParse(query['volume'] ?? '') ?? _volume;
    });
  }

  String _stateJson() => '{"playing":$_isPlaying,"position":$_positionSeconds,"rate":$_playbackRate,"volume":$_volume,"muted":true,"keepAwake":$_keepAwake}';

  String _playerHtml(String primaryType) {
    final tag = primaryType == 'audio' ? 'audio' : 'video';
    return '''<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><title>$_brandName</title><style>body{font-family:sans-serif;margin:24px;background:#101816;color:white}video,audio{width:100%;margin-top:16px}.row{display:flex;gap:8px;flex-wrap:wrap}button{padding:10px 14px}</style><h1>$_brandName</h1><p>Powered by God's Zeal. This in-app bridge endpoint keeps media controls synced; the desktop side stays muted while the phone plays audio in the background when the OS allows it.</p><$tag id="player" src="/stream" controls autoplay playsinline></$tag><div class="row"><button onclick="seek(-10)">-10s</button><button onclick="toggle()">Play/Pause</button><button onclick="seek(10)">+10s</button><button onclick="rate(.75)">0.75x</button><button onclick="rate(1)">1x</button><button onclick="rate(1.25)">1.25x</button></div><script>const p=document.getElementById('player');async function send(a){await fetch('/control?action='+a+'&position='+p.currentTime+'&rate='+p.playbackRate+'&volume='+p.volume)}function toggle(){p.paused?p.play():p.pause()}function seek(s){p.currentTime=Math.max(0,p.currentTime+s);send('seek')}function rate(r){p.playbackRate=r;send('rate')}p.onplay=()=>send('play');p.onpause=()=>send('pause');p.onseeked=()=>send('seek');setInterval(()=>send(p.paused?'pause':'play'),3000);</script>''';
  }

  @override
  Widget build(BuildContext context) {
    final url = _url;
    final directConnectUri = _directConnectUri;
    final fileName = _mediaFile?.path.split(Platform.pathSeparator).last ?? 'No media selected';
    return ResponsiveListView(
      padding: const EdgeInsets.symmetric(horizontal: _horizontalPadding, vertical: 20),
      children: [
        Card(
          child: ListTile(
            leading: Icon(Icons.cast_connected, color: Theme.of(context).colorScheme.primary),
            title: Text(_brandName, style: Theme.of(context).textTheme.titleLarge),
            subtitle: const Text('Powered by God\'s Zeal. Stream audio or video from desktop or mobile, keep the bridge awake, and play through the receiving app or Bluetooth audio.'),
          ),
        ),
        Card(
          child: Padding(
            padding: const EdgeInsets.all(16),
            child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
              Text('Live media bridge', style: Theme.of(context).textTheme.titleMedium),
              const SizedBox(height: 8),
              Text(fileName),
              const SizedBox(height: 12),
              Wrap(spacing: 8, runSpacing: 8, children: [
                FilledButton.icon(onPressed: _pickMedia, icon: const Icon(Icons.folder_open), label: const Text('Choose media or audio')),
                FilledButton.icon(onPressed: _server == null ? _startServer : null, icon: const Icon(Icons.play_arrow), label: const Text('Start bridge')),
                OutlinedButton.icon(onPressed: _server == null ? null : _stopServer, icon: const Icon(Icons.stop), label: const Text('Stop')),
              ]),
              const SizedBox(height: 12),
              SelectableText(_status),
              if (url != null && directConnectUri != null) ...[
                const SizedBox(height: 16),
                Center(child: SizedBox(width: 220, height: 220, child: PrettyQrView.data(data: directConnectUri))),
                const SizedBox(height: 8),
                const Text('Scan with ZealBridge to connect in-app for desktop-to-mobile or mobile-to-mobile playback. If deep links are unavailable, use the fallback player endpoint below.'),
                SelectableText(url.replaceFirst('/stream', '/'), textAlign: TextAlign.center),
              ],
            ]),
          ),
        ),
        _SliderCard(title: 'Bass boost', value: _bass, onChanged: (v) => setState(() => _bass = v)),
        _SliderCard(title: 'Treble boost', value: _treble, onChanged: (v) => setState(() => _treble = v)),
        _SliderCard(title: 'Output gain', value: _gain, onChanged: (v) => setState(() => _gain = v)),
        Card(
          child: Column(children: [
            SwitchListTile(value: _keepAwake, onChanged: null, title: const Text('Keep bridge awake'), subtitle: const Text('Enabled automatically while the bridge is running so mobile and desktop playback do not sleep.')),
            SwitchListTile(value: _screenMirror, onChanged: (v) => setState(() => _screenMirror = v), title: const Text('Screen-share mode'), subtitle: const Text('Keeps the ZealBridge session alive for mirrored image/video payload handoff; native desktop capture can attach to this transport later.')),
            SwitchListTile(value: _remoteInput, onChanged: (v) => setState(() => _remoteInput = v), title: const Text('Remote gamepad, mouse, and keyboard'), subtitle: const Text('Remote control events are reserved in the bridge control channel; OS-level trusted input injection still requires platform permission.')),
            SwitchListTile(value: _turnRelay, onChanged: (v) => setState(() => _turnRelay = v), title: const Text('TURN relay'), subtitle: const Text('Relay mode is exposed in the session model; same-Wi‑Fi streaming is used unless a deployed relay is configured.')),
          ]),
        ),
      ],
    );
  }
}

class _SliderCard extends StatelessWidget {
  const _SliderCard({required this.title, required this.value, required this.onChanged});
  final String title;
  final double value;
  final ValueChanged<double> onChanged;

  @override
  Widget build(BuildContext context) {
    return Card(
      child: ListTile(
        title: Text(title),
        subtitle: Slider(value: value, min: -12, max: 12, divisions: 24, label: '${value.toStringAsFixed(0)} dB', onChanged: onChanged),
        trailing: Text('${value.toStringAsFixed(0)} dB'),
      ),
    );
  }
}

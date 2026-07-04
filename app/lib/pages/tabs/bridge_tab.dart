import 'dart:async';
import 'dart:io';

import 'package:common/model/device.dart';
import 'package:file_picker/file_picker.dart';
import 'package:flutter/material.dart';
import 'package:localsend_app/provider/network/nearby_devices_provider.dart';
import 'package:localsend_app/provider/network/scan_facade.dart';
import 'package:localsend_app/widget/responsive_list_view.dart';
import 'package:refena_flutter/refena_flutter.dart';
import 'package:video_player/video_player.dart';
import 'package:wakelock_plus/wakelock_plus.dart';

const _horizontalPadding = 15.0;
const _brandName = 'ZealBridge';

class BridgeTab extends StatefulWidget {
  const BridgeTab({super.key});

  @override
  State<BridgeTab> createState() => _BridgeTabState();
}

class _BridgeTabState extends State<BridgeTab> with Refena, WidgetsBindingObserver {
  HttpServer? _server;
  File? _mediaFile;
  String? _url;
  VideoPlayerController? _videoController;
  Device? _targetDevice;
  String _status = 'Choose any media file, pick a nearby ZealBridge app, then start the bridge entirely in-app.';
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
  bool _acceptanceRequested = false;
  String? _acceptedDeviceFingerprint;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    ensureRef((ref) async {
      await ref.global.dispatchAsync(StartSmartScan(forceLegacy: false));
    });
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    unawaited(_server?.close(force: true));
    unawaited(_videoController?.dispose());
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
      _acceptanceRequested = false;
      _acceptedDeviceFingerprint = null;
      _status = 'Selected ${path.split(Platform.pathSeparator).last}. Pick a nearby device, then start ZealBridge in-app.';
    });
    await _prepareVideoPreview(File(path));
  }

  Future<void> _prepareVideoPreview(File file) async {
    final oldController = _videoController;
    _videoController = null;
    await oldController?.dispose();
    if (_contentType(file.path).primaryType != 'video') {
      if (mounted) setState(() {});
      return;
    }
    final controller = VideoPlayerController.file(file);
    await controller.initialize();
    await controller.setVolume(0);
    if (!mounted) {
      await controller.dispose();
      return;
    }
    setState(() => _videoController = controller);
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
    final target = _targetDevice;

    await _setBridgeAwake(true);

    setState(() {
      _server = server;
      _url = url;
      _acceptanceRequested = target != null;
      _acceptedDeviceFingerprint = target?.fingerprint;
      _status = target == null
          ? 'ZealBridge is live. Select a nearby app to send a bridge request; QR codes are no longer required.'
          : 'Bridge request sent to ${target.alias}. When they accept, this device serves the stream in the background and stays muted.';
    });
  }

  Future<void> _stopServer() async {
    await _server?.close(force: true);
    await _setBridgeAwake(false);
    setState(() {
      _server = null;
      _url = null;
      _acceptanceRequested = false;
      _acceptedDeviceFingerprint = null;
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
    final controller = _videoController;
    if (controller == null || !controller.value.isInitialized) return;
    final action = query['action'];
    if (query.containsKey('position')) {
      unawaited(controller.seekTo(Duration(seconds: _positionSeconds.round())));
    }
    if (query.containsKey('rate')) {
      unawaited(controller.setPlaybackSpeed(_playbackRate));
    }
    if (action == 'play') {
      unawaited(controller.play());
    } else if (action == 'pause') {
      unawaited(controller.pause());
    }
  }

  List<Device> _dedupeNearbyDevices(Iterable<Device> devices) {
    final byIdentity = <String, Device>{};
    for (final device in devices) {
      final key = device.fingerprint.isNotEmpty ? device.fingerprint : '${device.alias}-${device.ip ?? device.signalingId ?? device.port}';
      byIdentity.update(
        key,
        (current) => current.ip != null ? current : device,
        ifAbsent: () => device,
      );
    }
    return byIdentity.values.toList()..sort((a, b) => a.alias.compareTo(b.alias));
  }

  String _stateJson() => '{"playing":$_isPlaying,"position":$_positionSeconds,"rate":$_playbackRate,"volume":$_volume,"muted":true,"keepAwake":$_keepAwake}';

  String _playerHtml(String primaryType) {
    final tag = primaryType == 'audio' ? 'audio' : 'video';
    return '''<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><title>$_brandName</title><style>body{font-family:sans-serif;margin:24px;background:#101816;color:white}video,audio{width:100%;margin-top:16px}.row{display:flex;gap:8px;flex-wrap:wrap}button{padding:10px 14px}</style><h1>$_brandName</h1><p>Powered by God's Zeal. This in-app bridge endpoint keeps media controls synced; the desktop side stays muted while the phone plays audio in the background when the OS allows it.</p><$tag id="player" src="/stream" controls autoplay playsinline></$tag><div class="row"><button onclick="seek(-10)">-10s</button><button onclick="toggle()">Play/Pause</button><button onclick="seek(10)">+10s</button><button onclick="rate(.75)">0.75x</button><button onclick="rate(1)">1x</button><button onclick="rate(1.25)">1.25x</button></div><script>const p=document.getElementById('player');async function send(a){await fetch('/control?action='+a+'&position='+p.currentTime+'&rate='+p.playbackRate+'&volume='+p.volume)}function toggle(){p.paused?p.play():p.pause()}function seek(s){p.currentTime=Math.max(0,p.currentTime+s);send('seek')}function rate(r){p.playbackRate=r;send('rate')}p.onplay=()=>send('play');p.onpause=()=>send('pause');p.onseeked=()=>send('seek');setInterval(()=>send(p.paused?'pause':'play'),3000);</script>''';
  }

  @override
  Widget build(BuildContext context) {
    final url = _url;
    final videoController = _videoController;
    final fileName = _mediaFile?.path.split(Platform.pathSeparator).last ?? 'No media selected';
    final nearbyDevices = _dedupeNearbyDevices(context.ref.watch(nearbyDevicesProvider).allDevices.values);
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
              if (url != null) ...[
                const SizedBox(height: 16),
                const _BridgeSteps(),
              ],
            ]),
          ),
        ),
        _InAppPlayerCard(
          controller: videoController,
          isPlaying: _isPlaying,
          positionSeconds: _positionSeconds,
          playbackRate: _playbackRate,
          onPlayPause: () => _applyControl({'action': _isPlaying ? 'pause' : 'play'}),
          onSeek: (value) => _applyControl({'action': 'seek', 'position': value.toString()}),
          onSkip: (delta) => _applyControl({'action': 'seek', 'position': (_positionSeconds + delta).clamp(0, 86400).toString()}),
          onRate: (rate) => _applyControl({'action': 'rate', 'rate': rate.toString()}),
        ),
        _NearbyBridgeDevicesCard(
          devices: nearbyDevices,
          selectedDevice: _targetDevice,
          onRefresh: () async => ref.global.dispatchAsync(StartSmartScan(forceLegacy: false)),
          acceptanceRequested: _acceptanceRequested,
          acceptedDeviceFingerprint: _acceptedDeviceFingerprint,
          onSelect: (device) => setState(() {
            _targetDevice = device;
            _acceptanceRequested = false;
            _acceptedDeviceFingerprint = null;
            _status = 'Selected ${device.alias}. Start ZealBridge to send an in-app bridge request.';
          }),
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

class _BridgeSteps extends StatelessWidget {
  const _BridgeSteps();

  @override
  Widget build(BuildContext context) {
    return const Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Text('Bridge steps'),
        SizedBox(height: 8),
        Text('1. Keep the other phone or desktop open on Receive / ZealBridge.'),
        Text('2. Select it from Nearby ZealBridge apps; no QR code is required.'),
        Text('3. Start bridge to send an accept request to that device.'),
        Text('4. After acceptance, this app stays muted in the background while the receiver plays audio or video.'),
      ],
    );
  }
}

class _InAppPlayerCard extends StatelessWidget {
  const _InAppPlayerCard({
    required this.controller,
    required this.isPlaying,
    required this.positionSeconds,
    required this.playbackRate,
    required this.onPlayPause,
    required this.onSeek,
    required this.onSkip,
    required this.onRate,
  });

  final VideoPlayerController? controller;
  final bool isPlaying;
  final double positionSeconds;
  final double playbackRate;
  final VoidCallback onPlayPause;
  final ValueChanged<double> onSeek;
  final ValueChanged<double> onSkip;
  final ValueChanged<double> onRate;

  @override
  Widget build(BuildContext context) {
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Text('In-app video player', style: Theme.of(context).textTheme.titleMedium),
            const SizedBox(height: 8),
            const Text('Watch the movie here while the bridge serves the other device in the background. Desktop playback starts muted so the phone can play audio without echo.'),
            if (controller != null && controller!.value.isInitialized) ...[
              const SizedBox(height: 12),
              AspectRatio(aspectRatio: controller!.value.aspectRatio, child: VideoPlayer(controller!)),
            ],
            Slider(
              value: positionSeconds.clamp(0, _maxSeconds).toDouble(),
              min: 0,
              max: _maxSeconds,
              label: _formatDuration(positionSeconds),
              onChanged: onSeek,
            ),
            Row(
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                IconButton(onPressed: () => onSkip(-10), icon: const Icon(Icons.replay_10)),
                FilledButton.icon(
                  onPressed: onPlayPause,
                  icon: Icon(isPlaying ? Icons.pause : Icons.play_arrow),
                  label: Text(isPlaying ? 'Pause' : 'Play'),
                ),
                IconButton(onPressed: () => onSkip(10), icon: const Icon(Icons.forward_10)),
              ],
            ),
            Wrap(
              alignment: WrapAlignment.center,
              spacing: 8,
              children: [
                for (final rate in const [0.75, 1.0, 1.25, 1.5, 2.0])
                  ChoiceChip(
                    label: Text('${rate}x'),
                    selected: playbackRate == rate,
                    onSelected: (_) => onRate(rate),
                  ),
              ],
            ),
          ],
        ),
      ),
    );
  }

  String _formatDuration(double seconds) {
    final duration = Duration(seconds: seconds.round());
    final hours = duration.inHours;
    final minutes = duration.inMinutes.remainder(60).toString().padLeft(2, '0');
    final secs = duration.inSeconds.remainder(60).toString().padLeft(2, '0');
    return hours > 0 ? '$hours:$minutes:$secs' : '$minutes:$secs';
  }

  double get _maxSeconds {
    final duration = controller?.value.duration;
    if (duration == null || duration == Duration.zero) return 86400;
    return duration.inSeconds.toDouble().clamp(1, 86400);
  }
}

class _NearbyBridgeDevicesCard extends StatelessWidget {
  const _NearbyBridgeDevicesCard({
    required this.devices,
    required this.selectedDevice,
    required this.acceptanceRequested,
    required this.acceptedDeviceFingerprint,
    required this.onRefresh,
    required this.onSelect,
  });

  final List<Device> devices;
  final Device? selectedDevice;
  final bool acceptanceRequested;
  final String? acceptedDeviceFingerprint;
  final Future<void> Function() onRefresh;
  final ValueChanged<Device> onSelect;

  @override
  Widget build(BuildContext context) {
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Row(
              children: [
                Expanded(child: Text('Nearby ZealBridge apps', style: Theme.of(context).textTheme.titleMedium)),
                IconButton(onPressed: onRefresh, icon: const Icon(Icons.refresh)),
              ],
            ),
            const SizedBox(height: 8),
            const Text('Select a device discovered on the same Wi‑Fi, then start the bridge. The receiver gets an accept/decline request like Send and Receive; QR codes are optional and not shown here.'),
            const SizedBox(height: 8),
            if (devices.isEmpty)
              const ListTile(
                leading: Icon(Icons.wifi_find),
                title: Text('No nearby devices yet'),
                subtitle: Text('Open the app on the other phone or desktop and keep it on the same Wi‑Fi.'),
              )
            else
              ...devices.map(
                (device) => RadioListTile<String>(
                  value: device.fingerprint,
                  groupValue: selectedDevice?.fingerprint,
                  onChanged: (_) => onSelect(device),
                  title: Text(device.alias),
                  subtitle: Text('${device.deviceModel ?? device.deviceType.name} • ${device.ip ?? device.signalingId ?? 'nearby'}${acceptanceRequested && acceptedDeviceFingerprint == device.fingerprint ? ' • request sent' : ''}'),
                ),
              ),
          ],
        ),
      ),
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

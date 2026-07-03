import 'dart:async';
import 'dart:io';

import 'package:file_picker/file_picker.dart';
import 'package:flutter/material.dart';
import 'package:localsend_app/widget/responsive_list_view.dart';
import 'package:pretty_qr_code/pretty_qr_code.dart';

const _horizontalPadding = 15.0;
const _brandName = 'ZealBridge';

class BridgeTab extends StatefulWidget {
  const BridgeTab({super.key});

  @override
  State<BridgeTab> createState() => _BridgeTabState();
}

class _BridgeTabState extends State<BridgeTab> {
  HttpServer? _server;
  File? _mediaFile;
  String? _url;
  String _status = 'Choose an audio or video file, start the bridge, then open the URL on your phone.';
  double _bass = 0;
  double _treble = 0;
  double _gain = 0;
  bool _screenMirror = false;
  bool _remoteInput = false;
  bool _turnRelay = false;

  @override
  void dispose() {
    unawaited(_server?.close(force: true));
    super.dispose();
  }

  Future<void> _pickMedia() async {
    final result = await FilePicker.platform.pickFiles(type: FileType.media, allowMultiple: false);
    final path = result?.files.single.path;
    if (path == null) {
      return;
    }
    setState(() {
      _mediaFile = File(path);
      _status = 'Selected ${path.split(Platform.pathSeparator).last}. Start the bridge to stream it.';
    });
  }

  Future<void> _startServer() async {
    final mediaFile = _mediaFile;
    if (mediaFile == null || !await mediaFile.exists()) {
      setState(() => _status = 'Select a local audio or video file first.');
      return;
    }

    await _server?.close(force: true);
    final server = await HttpServer.bind(InternetAddress.anyIPv4, 0, shared: true);
    server.listen((request) => _handleRequest(request, mediaFile));
    final host = await _bestLanAddress();
    final url = 'http://$host:${server.port}/stream';

    setState(() {
      _server = server;
      _url = url;
      _status = 'Bridge is live. Open $url on the phone and connect the phone to AirPods/Bluetooth.';
    });
  }

  Future<void> _stopServer() async {
    await _server?.close(force: true);
    setState(() {
      _server = null;
      _url = null;
      _status = 'Bridge stopped.';
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
        ..write(_playerHtml())
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
    if (lower.endsWith('.webm')) return ContentType('video', 'webm');
    if (lower.endsWith('.mov')) return ContentType('video', 'quicktime');
    return ContentType('video', 'mp4');
  }

  String _playerHtml() => '''<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><title>$_brandName Bridge</title><style>body{font-family:sans-serif;margin:24px;background:#101816;color:white}video,audio{width:100%;margin-top:16px}</style><h1>$_brandName</h1><p>Powered by God's Zeal. Keep this page open to play the desktop stream through this phone.</p><video src="/stream" controls autoplay playsinline></video><audio src="/stream" controls autoplay></audio>''';

  @override
  Widget build(BuildContext context) {
    final url = _url;
    final fileName = _mediaFile?.path.split(Platform.pathSeparator).last ?? 'No media selected';
    return ResponsiveListView(
      padding: const EdgeInsets.symmetric(horizontal: _horizontalPadding, vertical: 20),
      children: [
        Card(
          child: ListTile(
            leading: Icon(Icons.cast_connected, color: Theme.of(context).colorScheme.primary),
            title: Text(_brandName, style: Theme.of(context).textTheme.titleLarge),
            subtitle: const Text('Powered by God\'s Zeal. Stream a desktop media file over Wi‑Fi to your phone, then play it through Bluetooth audio.'),
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
                FilledButton.icon(onPressed: _pickMedia, icon: const Icon(Icons.folder_open), label: const Text('Choose media')),
                FilledButton.icon(onPressed: _server == null ? _startServer : null, icon: const Icon(Icons.play_arrow), label: const Text('Start bridge')),
                OutlinedButton.icon(onPressed: _server == null ? null : _stopServer, icon: const Icon(Icons.stop), label: const Text('Stop')),
              ]),
              const SizedBox(height: 12),
              SelectableText(_status),
              if (url != null) ...[
                const SizedBox(height: 16),
                Center(child: SizedBox(width: 220, height: 220, child: PrettyQrView.data(data: url))),
                const SizedBox(height: 8),
                SelectableText(url, textAlign: TextAlign.center),
              ],
            ]),
          ),
        ),
        _SliderCard(title: 'Bass boost', value: _bass, onChanged: (v) => setState(() => _bass = v)),
        _SliderCard(title: 'Treble boost', value: _treble, onChanged: (v) => setState(() => _treble = v)),
        _SliderCard(title: 'Output gain', value: _gain, onChanged: (v) => setState(() => _gain = v)),
        Card(
          child: Column(children: [
            SwitchListTile(value: _screenMirror, onChanged: (v) => setState(() => _screenMirror = v), title: const Text('Screen-share mode'), subtitle: const Text('UI toggle is ready; native capture/encode transport is not bundled in this lightweight patch.')),
            SwitchListTile(value: _remoteInput, onChanged: (v) => setState(() => _remoteInput = v), title: const Text('Remote gamepad, mouse, and keyboard'), subtitle: const Text('UI toggle is ready; OS-level trusted input injection still requires native platform code.')),
            SwitchListTile(value: _turnRelay, onChanged: (v) => setState(() => _turnRelay = v), title: const Text('TURN relay'), subtitle: const Text('Use same Wi‑Fi for this local bridge. Internet relay requires deploying a real TURN service.')),
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

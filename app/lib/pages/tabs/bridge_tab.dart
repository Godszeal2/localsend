import 'package:flutter/material.dart';
import 'package:localsend_app/widget/responsive_list_view.dart';

const _horizontalPadding = 15.0;

class BridgeTab extends StatelessWidget {
  const BridgeTab({super.key});

  @override
  Widget build(BuildContext context) {
    return DefaultTabController(
      length: 3,
      child: Column(
        children: const [
          _BridgeTabs(),
          Expanded(
            child: TabBarView(
              children: [
                _BridgeOverview(),
                _BridgeGuides(),
                _BridgeRoadmap(),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class _BridgeTabs extends StatelessWidget {
  const _BridgeTabs();

  @override
  Widget build(BuildContext context) {
    return Material(
      color: Theme.of(context).scaffoldBackgroundColor,
      child: const SafeArea(
        bottom: false,
        child: TabBar(
          tabs: [
            Tab(icon: Icon(Icons.cast_connected), text: 'Overview'),
            Tab(icon: Icon(Icons.menu_book), text: 'Guides'),
            Tab(icon: Icon(Icons.route), text: 'Roadmap'),
          ],
        ),
      ),
    );
  }
}

class _BridgeOverview extends StatelessWidget {
  const _BridgeOverview();

  @override
  Widget build(BuildContext context) {
    return ResponsiveListView(
      padding: const EdgeInsets.symmetric(
        horizontal: _horizontalPadding,
        vertical: 20,
      ),
      children: const [
        _BridgeHeader(),
        SizedBox(height: 12),
        _BridgeInfoCard(
          icon: Icons.swap_horiz,
          title: 'File transfer works now',
          status: 'Available',
          body: 'Use the Send and Receive tabs for normal PC ↔ phone transfers. The bridge page does not replace LocalSend file sharing.',
        ),
        _BridgeInfoCard(
          icon: Icons.surround_sound,
          title: 'Audio bridge',
          status: 'Next phase',
          body: 'Goal: stream PC audio to the phone over Wi‑Fi, then play it through Bluetooth earbuds or speakers.',
        ),
        _BridgeInfoCard(
          icon: Icons.desktop_windows,
          title: 'Screen share',
          status: 'Next phase',
          body: 'Goal: mirror the desktop display to the phone without interrupting normal file transfer.',
        ),
        _BridgeInfoCard(
          icon: Icons.sports_esports,
          title: 'Remote input',
          status: 'Next phase',
          body: 'Goal: use the phone as a trusted gamepad, mouse, keyboard, and cursor controller for the desktop.',
        ),
      ],
    );
  }
}

class _BridgeGuides extends StatelessWidget {
  const _BridgeGuides();

  @override
  Widget build(BuildContext context) {
    return ResponsiveListView(
      padding: const EdgeInsets.symmetric(
        horizontal: _horizontalPadding,
        vertical: 20,
      ),
      children: const [
        _GuideCard(
          title: '1. Keep file transfer on Send / Receive',
          body: 'For now, use Send to choose files and Receive to accept them. '
              'Bridge features are being separated so they do not break normal sharing.',
        ),
        _GuideCard(
          title: '2. Put both devices on the same network',
          body: 'PC and phone should be on the same Wi‑Fi/LAN. If Windows asks for firewall access, allow LocalSend Bridge on private networks.',
        ),
        _GuideCard(
          title: '3. Audio bridge plan',
          body: 'The desktop app will capture system audio, send it through a low-latency stream, '
              'and the phone will play it to the selected speaker or Bluetooth device.',
        ),
        _GuideCard(
          title: '4. Screen-share plan',
          body: 'The desktop app will capture the screen, encode frames, and stream them to the phone. '
              'This needs a dedicated live-stream path, not the file-transfer API.',
        ),
        _GuideCard(
          title: '5. Game cursor / remote input plan',
          body: 'The phone will send touch, joystick, mouse, keyboard, and cursor events back to the desktop after an explicit trusted-pairing step.',
        ),
      ],
    );
  }
}

class _BridgeRoadmap extends StatelessWidget {
  const _BridgeRoadmap();

  @override
  Widget build(BuildContext context) {
    return ResponsiveListView(
      padding: const EdgeInsets.symmetric(
        horizontal: _horizontalPadding,
        vertical: 20,
      ),
      children: const [
        _RoadmapStep(
          step: 'Phase 1',
          title: 'Stable branded builds',
          body: 'Ship LocalSend Bridge APK and Windows ZIP while preserving normal file transfer.',
          complete: true,
        ),
        _RoadmapStep(
          step: 'Phase 2',
          title: 'Pairing and permissions',
          body: 'Add explicit bridge pairing, device trust, Windows firewall guidance, '
              'microphone/audio permissions, and input-control permission prompts.',
        ),
        _RoadmapStep(
          step: 'Phase 3',
          title: 'Live media transport',
          body: 'Add a WebRTC-style low-latency channel for audio and screen frames so bridge sessions are streams, not files.',
        ),
        _RoadmapStep(
          step: 'Phase 4',
          title: 'Remote input and game controls',
          body: 'Add cursor, keyboard, touchpad, and gamepad layouts with safety controls and reconnect handling.',
        ),
      ],
    );
  }
}

class _BridgeHeader extends StatelessWidget {
  const _BridgeHeader();

  @override
  Widget build(BuildContext context) {
    return Card(
      child: ListTile(
        leading: Icon(
          Icons.cast_connected,
          color: Theme.of(context).colorScheme.primary,
        ),
        title: Text(
          'LocalSend Bridge',
          style: Theme.of(context).textTheme.titleLarge,
        ),
        subtitle: const Text(
          'A bridge-focused build for future audio streaming, screen sharing, and remote input. File transfer stays in Send and Receive.',
        ),
      ),
    );
  }
}

class _BridgeInfoCard extends StatelessWidget {
  const _BridgeInfoCard({
    required this.icon,
    required this.title,
    required this.status,
    required this.body,
  });

  final IconData icon;
  final String title;
  final String status;
  final String body;

  @override
  Widget build(BuildContext context) {
    return Card(
      child: ListTile(
        leading: Icon(
          icon,
          color: Theme.of(context).colorScheme.primary,
        ),
        title: Text(title),
        subtitle: Text(body),
        trailing: Chip(label: Text(status)),
      ),
    );
  }
}

class _GuideCard extends StatelessWidget {
  const _GuideCard({
    required this.title,
    required this.body,
  });

  final String title;
  final String body;

  @override
  Widget build(BuildContext context) {
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              title,
              style: Theme.of(context).textTheme.titleMedium,
            ),
            const SizedBox(height: 8),
            Text(body),
          ],
        ),
      ),
    );
  }
}

class _RoadmapStep extends StatelessWidget {
  const _RoadmapStep({
    required this.step,
    required this.title,
    required this.body,
    this.complete = false,
  });

  final String step;
  final String title;
  final String body;
  final bool complete;

  @override
  Widget build(BuildContext context) {
    return Card(
      child: ListTile(
        leading: CircleAvatar(
          child: Icon(complete ? Icons.check : Icons.pending_actions),
        ),
        title: Text('$step · $title'),
        subtitle: Text(body),
      ),
    );
  }
}

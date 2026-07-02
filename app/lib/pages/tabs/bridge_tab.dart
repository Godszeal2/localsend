import 'package:flutter/material.dart';
import 'package:localsend_app/widget/responsive_list_view.dart';

const _horizontalPadding = 15.0;

class BridgeTab extends StatelessWidget {
  const BridgeTab({super.key});

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
        _BridgeFeatureCard(
          icon: Icons.surround_sound,
          title: 'Audio bridge',
          status: 'Planned',
          body: 'Stream PC audio to the phone over Wi-Fi, then play it through Bluetooth earbuds or speakers.',
        ),
        _BridgeFeatureCard(
          icon: Icons.desktop_windows,
          title: 'Screen share',
          status: 'Planned',
          body: 'Mirror the desktop display to the phone without changing normal LocalSend file transfer.',
        ),
        _BridgeFeatureCard(
          icon: Icons.sports_esports,
          title: 'Remote input',
          status: 'Planned',
          body: 'Use the phone as a trusted gamepad, mouse, and keyboard controller for the desktop.',
        ),
        _BridgeFeatureCard(
          icon: Icons.public,
          title: 'Relay / TURN support',
          status: 'Planned',
          body: 'Add an optional relay path for bridge sessions when devices are on different networks.',
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
          'Bridge features',
          style: Theme.of(context).textTheme.titleLarge,
        ),
        subtitle: const Text(
          'Audio, video, screen-share, and remote-control features will live here. Use Send for regular files.',
        ),
      ),
    );
  }
}

class _BridgeFeatureCard extends StatelessWidget {
  const _BridgeFeatureCard({
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
        trailing: Chip(
          label: Text(status),
        ),
      ),
    );
  }
}

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
        _HeaderCard(),
        SizedBox(height: 12),
        _FeatureCard(
          icon: Icons.surround_sound,
          title: 'Audio bridge',
          status: 'Planned',
          body:
              'Route PC audio over Wi-Fi to the phone, then let the phone play it through Bluetooth earbuds or speakers. Bass, treble, and gain controls belong here when the streaming engine is added.',
        ),
        _FeatureCard(
          icon: Icons.desktop_windows,
          title: 'Screen share',
          status: 'Planned',
          body:
              'Mirror the desktop display to the phone over Wi-Fi. This will be separate from normal file transfer so sending files continues to work like LocalSend normally does.',
        ),
        _FeatureCard(
          icon: Icons.sports_esports,
          title: 'Remote input',
          status: 'Planned',
          body:
              'Use the phone as a gamepad, mouse, and keyboard controller for the desktop app after a trusted bridge session is connected.',
        ),
        _FeatureCard(
          icon: Icons.public,
          title: 'Relay / TURN support',
          status: 'Planned',
          body:
              'Add an optional relay path for devices on different networks. Until then, keep both devices on the same Wi-Fi for LocalSend transfers.',
        ),
      ],
    );
  }
}

class _HeaderCard extends StatelessWidget {
  const _HeaderCard();

  @override
  Widget build(BuildContext context) {
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Icon(
                  Icons.cast_connected,
                  color: Theme.of(context).colorScheme.primary,
                  size: 32,
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: Text(
                    'Bridge features',
                    style: Theme.of(context).textTheme.titleLarge?.copyWith(
                      fontWeight: FontWeight.w700,
                    ),
                  ),
                ),
              ],
            ),
            const SizedBox(height: 10),
            const Text(
              'This tab is the dedicated place for the audio, video, screen-share, and remote-control features. Normal file sending remains in the Send tab.',
            ),
          ],
        ),
      ),
    );
  }
}

class _FeatureCard extends StatelessWidget {
  const _FeatureCard({
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
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Icon(
              icon,
              color: Theme.of(context).colorScheme.primary,
              size: 28,
            ),
            const SizedBox(width: 12),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(
                    children: [
                      Expanded(
                        child: Text(
                          title,
                          style: Theme.of(context)
                              .textTheme
                              .titleMedium
                              ?.copyWith(fontWeight: FontWeight.w700),
                        ),
                      ),
                      Chip(label: Text(status)),
                    ],
                  ),
                  const SizedBox(height: 8),
                  Text(body),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}

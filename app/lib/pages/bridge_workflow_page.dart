import 'package:flutter/material.dart';
import 'package:localsend_app/util/transfer_intent.dart';

class BridgeWorkflowPage extends StatelessWidget {
  const BridgeWorkflowPage({
    super.key,
    required this.transferIntent,
    this.targetName,
    this.sessionId,
  });

  final TransferIntent transferIntent;
  final String? targetName;
  final String? sessionId;

  @override
  Widget build(BuildContext context) {
    final title = transferIntent == TransferIntent.bridge ? 'Bridge workflow' : 'Screen-share workflow';
    final subtitle = transferIntent == TransferIntent.bridge
        ? 'Keep the connection alive in the background for playback, audio handoff, or a bridge-style relay.'
        : 'Keep the session ready for mirrored desktop content, slide handoff, or screen-share style presentation.';

    return Scaffold(
      appBar: AppBar(title: Text(title)),
      body: Padding(
        padding: const EdgeInsets.all(20),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Card(
              child: Padding(
                padding: const EdgeInsets.all(16),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Row(
                      children: [
                        Icon(
                          transferIntentIcon(transferIntent),
                          color: Theme.of(context).colorScheme.primary,
                          size: 28,
                        ),
                        const SizedBox(width: 12),
                        Expanded(
                          child: Text(
                            transferIntentLabel(transferIntent),
                            style: Theme.of(context).textTheme.titleLarge?.copyWith(fontWeight: FontWeight.w700),
                          ),
                        ),
                      ],
                    ),
                    const SizedBox(height: 12),
                    Text(subtitle),
                    if (targetName != null || sessionId != null) ...[
                      const SizedBox(height: 12),
                      Text(
                        [if (targetName != null) 'Target: $targetName', if (sessionId != null) 'Session: $sessionId'].join(' • '),
                        style: Theme.of(context).textTheme.bodySmall,
                      ),
                    ],
                  ],
                ),
              ),
            ),
            const SizedBox(height: 16),
            Text('Recommended workflow', style: Theme.of(context).textTheme.titleMedium?.copyWith(fontWeight: FontWeight.w700)),
            const SizedBox(height: 8),
            _WorkflowStep(
              title: '1. Start the transfer',
              body: 'Select the audio, video, or image payload and send it to the target device.',
            ),
            _WorkflowStep(
              title: '2. Keep the session alive',
              body: 'The app now keeps bridge and screen-share sessions active so they can continue in the background.',
            ),
            _WorkflowStep(
              title: '3. Resume or monitor',
              body: 'Use the progress page to resume, inspect, or continue the transfer once the target device is ready.',
            ),
          ],
        ),
      ),
    );
  }
}

class _WorkflowStep extends StatelessWidget {
  const _WorkflowStep({required this.title, required this.body});

  final String title;
  final String body;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 10),
      child: ListTile(
        leading: CircleAvatar(child: Text(title.split('.').first)),
        title: Text(title, style: Theme.of(context).textTheme.titleSmall?.copyWith(fontWeight: FontWeight.w700)),
        subtitle: Text(body),
        tileColor: Theme.of(context).colorScheme.surfaceContainerHighest.withValues(alpha: 0.35),
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
      ),
    );
  }
}

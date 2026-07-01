import 'package:common/model/file_type.dart';
import 'package:flutter/material.dart';
import 'package:localsend_app/model/cross_file.dart';

enum TransferIntent { regular, bridge, screenShare }

TransferIntent inferTransferIntent(List<CrossFile> files) {
  if (files.any((file) => file.fileType == FileType.audio || file.fileType == FileType.video)) {
    return TransferIntent.bridge;
  }

  if (files.any((file) => file.fileType == FileType.image)) {
    return TransferIntent.screenShare;
  }

  return TransferIntent.regular;
}

bool shouldKeepTransferInBackground(TransferIntent intent) {
  return intent == TransferIntent.bridge || intent == TransferIntent.screenShare;
}

String transferIntentLabel(TransferIntent intent) {
  switch (intent) {
    case TransferIntent.bridge:
      return 'Bridge mode';
    case TransferIntent.screenShare:
      return 'Screen-share mode';
    case TransferIntent.regular:
      return 'Regular transfer';
  }
}

String transferIntentDescription(TransferIntent intent) {
  switch (intent) {
    case TransferIntent.bridge:
      return 'Keep the session active in the background for audio or video bridge-style handoff.';
    case TransferIntent.screenShare:
      return 'Use this flow for desktop screen-share or mirror-style image handoff.';
    case TransferIntent.regular:
      return 'Send files normally without background streaming or mirror workflow.';
  }
}

IconData transferIntentIcon(TransferIntent intent) {
  switch (intent) {
    case TransferIntent.bridge:
      return Icons.cast;
    case TransferIntent.screenShare:
      return Icons.desktop_windows;
    case TransferIntent.regular:
      return Icons.send;
  }
}

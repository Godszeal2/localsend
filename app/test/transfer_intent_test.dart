import 'package:common/model/file_type.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:localsend_app/model/cross_file.dart';
import 'package:localsend_app/util/transfer_intent.dart';

void main() {
  group('Transfer intent detection', () {
    test('treats audio and video transfers as bridge mode', () {
      final files = [
        const CrossFile(
          name: 'song.mp3',
          fileType: FileType.audio,
          size: 1024,
          thumbnail: null,
          asset: null,
          path: null,
          bytes: null,
          lastModified: null,
          lastAccessed: null,
        ),
      ];

      expect(inferTransferIntent(files), TransferIntent.bridge);
    });

    test('treats image transfers as screen share mode', () {
      final files = [
        const CrossFile(
          name: 'snapshot.png',
          fileType: FileType.image,
          size: 2048,
          thumbnail: null,
          asset: null,
          path: null,
          bytes: null,
          lastModified: null,
          lastAccessed: null,
        ),
      ];

      expect(inferTransferIntent(files), TransferIntent.screenShare);
    });

    test('keeps documents in regular mode', () {
      final files = [
        const CrossFile(
          name: 'notes.txt',
          fileType: FileType.text,
          size: 100,
          thumbnail: null,
          asset: null,
          path: null,
          bytes: null,
          lastModified: null,
          lastAccessed: null,
        ),
      ];

      expect(inferTransferIntent(files), TransferIntent.regular);
    });

    test('keeps bridge and screen-share transfers in background workflow', () {
      expect(shouldKeepTransferInBackground(TransferIntent.bridge), isTrue);
      expect(shouldKeepTransferInBackground(TransferIntent.screenShare), isTrue);
      expect(shouldKeepTransferInBackground(TransferIntent.regular), isFalse);
    });
  });
}

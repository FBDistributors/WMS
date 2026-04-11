import 'package:audioplayers/audioplayers.dart';

/// Skaner marshruti darhol almashganda [ScannerScreen] `dispose` [AudioPlayer]ni yopmasligi
/// uchun ovoz bu yerda (ilova hayoti bo‘yicha) saqlanadi.
abstract final class ScanBeep {
  static AudioPlayer? _player;
  static bool _configured = false;

  static Future<void> _ensureReady() async {
    _player ??= AudioPlayer();
    if (!_configured) {
      await _player!.setReleaseMode(ReleaseMode.release);
      await _player!.setAudioContext(
        AudioContext(
          android: const AudioContextAndroid(
            isSpeakerphoneOn: true,
            stayAwake: true,
            contentType: AndroidContentType.sonification,
            usageType: AndroidUsageType.assistanceSonification,
            audioFocus: AndroidAudioFocus.gainTransientMayDuck,
          ),
        ),
      );
      _configured = true;
    }
  }

  /// Birinchi skanda kechikishni kamaytirish uchun ixtiyoriy.
  static Future<void> prewarm() => _ensureReady();

  static Future<void> play() async {
    try {
      await _ensureReady();
      await _player!.stop();
      await _player!.play(AssetSource('sounds/scan_beep.wav'));
    } on Object {
      // Ovoz yo‘q bo‘lsa ham skaner ishlasin.
    }
  }
}

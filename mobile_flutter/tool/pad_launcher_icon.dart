// ignore_for_file: avoid_print

import 'dart:io';

import 'package:image/image.dart';

/// Centers [logo.png] on a 1024² white canvas at ~72% scale (more padding vs RN icon).
void main() {
  final File srcFile = File('../mobile/src/assets/logo.png');
  if (!srcFile.existsSync()) {
    stderr.writeln('Missing ${srcFile.path}');
    exit(1);
  }
  final Image? src = decodePng(srcFile.readAsBytesSync());
  if (src == null) {
    stderr.writeln('Could not decode PNG');
    exit(1);
  }
  const int side = 1024;
  const double scale = 0.72;
  final int logoSide = (side * scale).round();
  final Image resized = copyResize(
    src,
    width: logoSide,
    height: logoSide,
    interpolation: Interpolation.average,
  );
  final Image canvas = Image(width: side, height: side);
  fill(canvas, color: ColorRgb8(255, 255, 255));
  compositeImage(
    canvas,
    resized,
    dstX: (side - resized.width) ~/ 2,
    dstY: (side - resized.height) ~/ 2,
  );
  final File out = File('assets/branding/app_icon.png');
  out.parent.createSync(recursive: true);
  out.writeAsBytesSync(encodePng(canvas));
  print('Wrote ${out.path}');
}

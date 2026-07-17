import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile_flutter/core/theme/app_colors.dart';

void main() {
  testWidgets('context.colors resolves to dark tokens under a dark theme',
      (WidgetTester tester) async {
    late AppColors resolved;
    await tester.pumpWidget(
      MaterialApp(
        theme: ThemeData.light().copyWith(
          extensions: const <ThemeExtension<dynamic>>[AppColors.light],
        ),
        darkTheme: ThemeData.dark().copyWith(
          extensions: const <ThemeExtension<dynamic>>[AppColors.dark],
        ),
        themeMode: ThemeMode.dark,
        home: Builder(
          builder: (BuildContext context) {
            resolved = context.colors;
            return const SizedBox();
          },
        ),
      ),
    );

    // Dark rejimda asosiy matn ochiq (surface bilan yaxshi kontrast) bo'lishi shart.
    expect(resolved.textMain, AppColors.dark.textMain);
    expect(resolved.surface, AppColors.dark.surface);
    // Matn va yuza ranglari bir xil bo'lib qolmasligi (ko'rinmay qolish) kerak.
    expect(resolved.textMain, isNot(resolved.surface));
    expect(resolved.textSecondary, isNot(resolved.pageBg));
  });

  testWidgets('context.colors resolves to light tokens under a light theme',
      (WidgetTester tester) async {
    late AppColors resolved;
    await tester.pumpWidget(
      MaterialApp(
        theme: ThemeData.light().copyWith(
          extensions: const <ThemeExtension<dynamic>>[AppColors.light],
        ),
        home: Builder(
          builder: (BuildContext context) {
            resolved = context.colors;
            return const SizedBox();
          },
        ),
      ),
    );
    expect(resolved.textMain, AppColors.light.textMain);
    expect(resolved.surface, AppColors.light.surface);
  });
}

import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';

/// RN `ReturnsRedirectScreen` / oddiy qaytarish yo‘li — forma orqali.
class ReturnsScreen extends StatelessWidget {
  const ReturnsScreen({super.key});

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Qaytarishlar'),
        leading: IconButton(icon: const Icon(Icons.arrow_back), onPressed: () => context.pop()),
      ),
      body: Center(
        child: Padding(
          padding: const EdgeInsets.all(24),
          child: Column(
            mainAxisAlignment: MainAxisAlignment.center,
            children: <Widget>[
              const Text('Mijoz qaytarishlari uchun Kirim → Mijozdan qaytgan.'),
              const SizedBox(height: 16),
              FilledButton(
                onPressed: () => context.pushNamed(
                  'kirimForm',
                  queryParameters: <String, String>{'flow': 'return'},
                ),
                child: const Text('Formaga o‘tish'),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';

/// RN `KirimNewScreen` — asosiy yoki showroom.
class KirimNewScreen extends StatelessWidget {
  const KirimNewScreen({super.key});

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Yangi mahsulotlar')),
      body: ListView(
        padding: const EdgeInsets.all(16),
        children: <Widget>[
          Card(
            child: ListTile(
              leading: const Icon(Icons.warehouse, color: Color(0xFF1A237E)),
              title: const Text('Asosiy ombor'),
              subtitle: const Text('Yangi mahsulotlar qabuli'),
              trailing: const Icon(Icons.chevron_right),
              onTap: () => context.pushNamed(
                'kirimForm',
                queryParameters: <String, String>{
                  'flow': 'new',
                  'warehouse': 'main',
                },
              ),
            ),
          ),
          Card(
            child: ListTile(
              leading: const Icon(Icons.storefront, color: Color(0xFF1A237E)),
              title: const Text('Showroom'),
              subtitle: const Text('Showroom qabuli'),
              trailing: const Icon(Icons.chevron_right),
              onTap: () => context.pushNamed(
                'kirimForm',
                queryParameters: <String, String>{
                  'flow': 'new',
                  'warehouse': 'showroom',
                },
              ),
            ),
          ),
        ],
      ),
    );
  }
}

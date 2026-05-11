import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../core/app_state/app_locale.dart';
import '../../../core/app_state/locale_controller.dart';
import '../../../l10n/string_lookup.dart';

/// RN `KirimNewScreen` — asosiy yoki showroom (dropdown: lokatsiya / mahsulot bo‘yicha).
class KirimNewScreen extends ConsumerStatefulWidget {
  const KirimNewScreen({super.key});

  @override
  ConsumerState<KirimNewScreen> createState() => _KirimNewScreenState();
}

class _KirimNewScreenState extends ConsumerState<KirimNewScreen> {
  String _mainMode = 'byLocation';
  String _showroomMode = 'byLocation';

  void _onBack() {
    context.goNamed('kirim');
  }

  String _hintForMode(AppLocale loc, String mode) {
    return mode == 'byLocation'
        ? StringLookup.t(loc, 'kirimNewMainTabByLocationHint')
        : StringLookup.t(loc, 'kirimNewMainTabByProductHint');
  }

  Widget _warehouseCard({
    required BuildContext context,
    required AppLocale loc,
    required IconData leadingIcon,
    required String title,
    required String subtitle,
    required String warehouse,
    required String mode,
    required ValueChanged<String> onModeChanged,
  }) {
    return Card(
      clipBehavior: Clip.antiAlias,
      child: Padding(
        padding: const EdgeInsets.fromLTRB(16, 16, 16, 16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: <Widget>[
            Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: <Widget>[
                Icon(leadingIcon, color: const Color(0xFF1A237E)),
                const SizedBox(width: 12),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: <Widget>[
                      Text(
                        title,
                        style: Theme.of(context).textTheme.titleMedium?.copyWith(
                              fontWeight: FontWeight.w600,
                            ),
                      ),
                      const SizedBox(height: 4),
                      Text(
                        subtitle,
                        style: Theme.of(context).textTheme.bodySmall?.copyWith(
                              color: Theme.of(context).colorScheme.onSurfaceVariant,
                            ),
                      ),
                    ],
                  ),
                ),
              ],
            ),
            const SizedBox(height: 12),
            InputDecorator(
              decoration: InputDecoration(
                labelText: StringLookup.t(loc, 'kirimNewReceiveModeLabel'),
                border: const OutlineInputBorder(),
                contentPadding: const EdgeInsets.symmetric(horizontal: 12, vertical: 4),
              ),
              child: DropdownButtonHideUnderline(
                child: DropdownButton<String>(
                  value: mode,
                  isExpanded: true,
                  borderRadius: BorderRadius.circular(8),
                  items: <DropdownMenuItem<String>>[
                    DropdownMenuItem<String>(
                      value: 'byLocation',
                      child: Text(StringLookup.t(loc, 'kirimNewMainTabByLocation')),
                    ),
                    DropdownMenuItem<String>(
                      value: 'byProduct',
                      child: Text(StringLookup.t(loc, 'kirimNewMainTabByProduct')),
                    ),
                  ],
                  onChanged: (String? v) {
                    if (v != null) {
                      onModeChanged(v);
                    }
                  },
                ),
              ),
            ),
            const SizedBox(height: 8),
            Text(
              _hintForMode(loc, mode),
              style: Theme.of(context).textTheme.bodySmall,
            ),
            const SizedBox(height: 12),
            FilledButton(
              onPressed: () => context.pushNamed(
                'kirimForm',
                queryParameters: <String, String>{
                  'flow': 'new',
                  'warehouse': warehouse,
                  'newMode': mode,
                },
              ),
              child: Text(StringLookup.t(loc, 'kirimNewMainContinue')),
            ),
          ],
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final AppLocale loc = ref.watch(appLocaleProvider);

    return PopScope(
      canPop: false,
      onPopInvokedWithResult: (bool didPop, Object? result) {
        if (!didPop) {
          _onBack();
        }
      },
      child: Scaffold(
        appBar: AppBar(
          title: Text(StringLookup.t(loc, 'kirimNewProducts')),
          leading: IconButton(
            icon: const Icon(Icons.arrow_back),
            onPressed: _onBack,
          ),
        ),
        body: ListView(
          padding: const EdgeInsets.all(16),
          children: <Widget>[
            _warehouseCard(
              context: context,
              loc: loc,
              leadingIcon: Icons.warehouse,
              title: StringLookup.t(loc, 'kirimWarehouseMainCardTitle'),
              subtitle: StringLookup.t(loc, 'kirimWarehouseMainCardSubtitle'),
              warehouse: 'main',
              mode: _mainMode,
              onModeChanged: (String v) => setState(() => _mainMode = v),
            ),
            const SizedBox(height: 12),
            _warehouseCard(
              context: context,
              loc: loc,
              leadingIcon: Icons.storefront,
              title: StringLookup.t(loc, 'kirimWarehouseShowroomCardTitle'),
              subtitle: StringLookup.t(loc, 'kirimWarehouseShowroomCardSubtitle'),
              warehouse: 'showroom',
              mode: _showroomMode,
              onModeChanged: (String v) => setState(() => _showroomMode = v),
            ),
          ],
        ),
      ),
    );
  }
}

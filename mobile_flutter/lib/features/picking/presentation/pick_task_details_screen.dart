import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../core/app_state/app_locale.dart';
import '../../../core/app_state/locale_controller.dart';
import '../../../core/app_state/network_status_provider.dart';
import '../../../core/app_state/theme_controller.dart';
import '../../../core/offline/offline_database.dart';
import '../../../core/offline/offline_providers.dart';
import '../../../l10n/string_lookup.dart';
import '../domain/profile_type_param.dart';
import '../picking_providers.dart';
import '../data/picking_models.dart';

class PickTaskDetailsScreen extends ConsumerStatefulWidget {
  const PickTaskDetailsScreen({super.key, required this.taskId});

  final String taskId;

  @override
  ConsumerState<PickTaskDetailsScreen> createState() => _PickTaskDetailsScreenState();
}

class _PickTaskDetailsScreenState extends ConsumerState<PickTaskDetailsScreen> {
  final TextEditingController _scan = TextEditingController();
  bool _busy = false;
  String? _appliedRouteScan;

  @override
  void dispose() {
    _scan.dispose();
    super.dispose();
  }

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    final String? sb = GoRouterState.of(context).uri.queryParameters['scannedBarcode'];
    if (sb == null || sb.isEmpty || _appliedRouteScan == sb) {
      return;
    }
    _appliedRouteScan = sb;
    WidgetsBinding.instance.addPostFrameCallback((_) async {
      if (!mounted) {
        return;
      }
      _scan.text = sb;
      await _submitScan();
      if (!mounted) {
        return;
      }
      final String? profileQ = GoRouterState.of(context).uri.queryParameters['profile'];
      final PickerProfileParam profile = pickerProfileFromQuery(profileQ);
      context.goNamed(
        'pickTaskDetail',
        pathParameters: <String, String>{'taskId': widget.taskId},
        queryParameters: <String, String>{'profile': profileToQuery(profile)},
      );
    });
  }

  Future<void> _submitScan() async {
    final String code = _scan.text.trim();
    if (code.isEmpty) {
      return;
    }
    final bool online = ref.read(networkOnlineProvider).valueOrNull ?? true;
    final OfflineDatabase? db = await ref.read(offlineDatabaseProvider.future);
    setState(() => _busy = true);
    try {
      if (online) {
        await ref.read(pickingRepositoryProvider).submitScan(
              widget.taskId,
              barcode: code,
            );
        _scan.clear();
        ref.invalidate(pickTaskDetailProvider(widget.taskId));
      } else if (db != null) {
        final String id = 'q_${DateTime.now().millisecondsSinceEpoch}';
        await db.queueAdd(
          id,
          'PICK_SCAN',
          <String, Object?>{
            'taskId': widget.taskId,
            'barcode': code,
            'ts': DateTime.now().millisecondsSinceEpoch,
          },
          'pending',
        );
        _scan.clear();
      }
    } on Exception catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('$e')));
      }
    } finally {
      if (mounted) {
        setState(() => _busy = false);
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final AppLocale loc = ref.watch(appLocaleProvider);
    final bool isDark = ref.watch(appThemeModeProvider) == ThemeMode.dark;
    final String? profileQ = GoRouterState.of(context).uri.queryParameters['profile'];
    final PickerProfileParam profile = pickerProfileFromQuery(profileQ);
    final AsyncValue<PickingDocument> doc = ref.watch(pickTaskDetailProvider(widget.taskId));

    return Scaffold(
      backgroundColor: isDark ? const Color(0xFF0F172A) : const Color(0xFFF5F5F5),
      appBar: AppBar(
        title: Text(StringLookup.t(loc, 'openTasks')),
        leading: IconButton(
          icon: const Icon(Icons.arrow_back),
          onPressed: () => context.goNamed(
            'pickTasks',
            queryParameters: <String, String>{'profile': profileToQuery(profile)},
          ),
        ),
        actions: <Widget>[
          IconButton(
            tooltip: 'Picker',
            icon: const Icon(Icons.playlist_add_check),
            onPressed: () => context.pushNamed(
              'picker',
              queryParameters: <String, String>{'taskId': widget.taskId},
            ),
          ),
        ],
      ),
      body: doc.when(
        data: (PickingDocument d) {
          return Column(
            children: <Widget>[
              Padding(
                padding: const EdgeInsets.all(12),
                child: Row(
                  children: <Widget>[
                    Expanded(
                      child: TextField(
                        controller: _scan,
                        decoration: InputDecoration(
                          labelText: StringLookup.t(loc, 'barcodeOrSku'),
                          border: const OutlineInputBorder(),
                        ),
                        onSubmitted: (_) => _submitScan(),
                      ),
                    ),
                    const SizedBox(width: 8),
                    FilledButton(
                      onPressed: _busy ? null : _submitScan,
                      child: Text(StringLookup.t(loc, 'submit')),
                    ),
                  ],
                ),
              ),
              Expanded(
                child: ListView.builder(
                  itemCount: d.lines.length,
                  itemBuilder: (BuildContext context, int i) {
                    final PickingLine line = d.lines[i];
                    return ListTile(
                      title: Text(line.productName),
                      subtitle: Text(
                        '${line.locationCode} · ${line.qtyPicked}/${line.qtyRequired}',
                      ),
                    );
                  },
                ),
              ),
            ],
          );
        },
        loading: () => const Center(child: CircularProgressIndicator()),
        error: (_, __) => Center(child: Text(StringLookup.t(loc, 'notFound'))),
      ),
    );
  }
}

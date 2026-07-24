import 'dart:async' show unawaited;

import 'package:flutter/material.dart';
import '../../../core/errors/api_error_localization.dart';
import '../../../core/theme/app_colors.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../core/app_state/locale_controller.dart';
import '../../../core/app_state/network_status_provider.dart';
import '../../../core/router/scanner_args.dart';
import '../../../core/storage/shared_preferences_provider.dart';
import '../../../l10n/string_lookup.dart';
import '../../../shared/feedback/app_top_snackbar.dart';
import '../../../shared/widgets/scan_action_button.dart';
import '../data/picking_models.dart';
import '../data/return_session_storage.dart';
import '../picking_providers.dart';

/// Xavfsiz bekor: terilganlarni asl joyga qaytarish.
/// Manzil avtomatik tasdiqlanadi (qayerdan olingan bo'lsa o'sha joy ko'rsatiladi),
/// terimchi faqat mahsulotni skanerlaydi yoki shtrix kodini qo'lda kiritadi.
class ReturnItemsScreen extends ConsumerStatefulWidget {
  const ReturnItemsScreen({super.key, required this.sessionId});

  final String sessionId;

  @override
  ConsumerState<ReturnItemsScreen> createState() => _ReturnItemsScreenState();
}

class _ReturnItemsScreenState extends ConsumerState<ReturnItemsScreen> {
  final TextEditingController _scan = TextEditingController();
  bool _loading = true;
  bool _busy = false;
  SafeCancelReturnSession? _session;
  String? _loadError;
  String _tr(String key) => StringLookup.t(ref.read(appLocaleProvider), key);

  @override
  void initState() {
    super.initState();
    unawaited(_bootstrap());
  }

  @override
  void dispose() {
    _scan.dispose();
    super.dispose();
  }

  Future<void> _bootstrap() async {
    setState(() {
      _loading = true;
      _loadError = null;
    });
    try {
      final SafeCancelReturnSession s =
          await ref.read(pickingRepositoryProvider).getReturnSession(widget.sessionId);
      if (s.status == 'completed') {
        await ReturnSessionStorage.clear(ref.read(sharedPreferencesProvider));
        if (!mounted) return;
        context.goNamed('pickerHome', queryParameters: const <String, String>{'profile': 'picker'});
        return;
      }
      await ReturnSessionStorage.save(ref.read(sharedPreferencesProvider), s.id);
      if (!mounted) {
        return;
      }
      setState(() {
        _session = s;
        _loading = false;
      });
    } on Exception catch (e) {
      await ReturnSessionStorage.clear(ref.read(sharedPreferencesProvider));
      if (!mounted) {
        return;
      }
      setState(() {
        _loadError = localizeApiErrorMessage(ref.read(appLocaleProvider), e);
        _loading = false;
      });
    }
  }

  Future<void> _submitScan([String? scanned]) async {
    final SafeCancelReturnSession? s = _session;
    if (s == null || _busy) {
      return;
    }
    final String raw = (scanned ?? _scan.text).trim();
    if (raw.isEmpty) {
      showAppSnackBar(context, SnackBar(content: Text(_tr('returnsScanOrCodeRequired'))));
      return;
    }
    final bool online = ref.read(networkOnlineProvider).valueOrNull ?? true;
    if (!online) {
      showAppSnackBar(
        context,
        SnackBar(
          content: Text(_tr('returnsNeedInternetRetry')),
          backgroundColor: Colors.red,
        ),
      );
      return;
    }
    SafeCancelReturnLine? next;
    for (final SafeCancelReturnLine l in s.lines) {
      if (!l.productConfirmed) {
        next = l;
        break;
      }
    }
    if (next == null) {
      return;
    }
    setState(() => _busy = true);
    try {
      // Manzil skanerlanmaydi (omborda lokatsiya QR kodlari yo'q) — mahsulot
      // baribir qayerdan olingan bo'lsa o'sha joyga qaytadi. Faqat tovar skani.
      final SafeCancelReturnSession updated =
          await ref.read(pickingRepositoryProvider).scanReturnProduct(s.id, raw);
      if (!mounted) {
        return;
      }
      setState(() {
        _session = updated;
        _scan.clear();
      });
    } on Exception catch (e) {
      if (mounted) {
        showAppLocalizedError(context, ref.read(appLocaleProvider), e);
      }
    } finally {
      if (mounted) {
        setState(() => _busy = false);
      }
    }
  }

  Future<void> _openCameraScan() async {
    if (_busy) {
      return;
    }
    final String? barcode = await context.pushNamed<String>(
      'scanner',
      extra: const ScannerArgs(returnRawBarcode: true),
    );
    if (!mounted || barcode == null || barcode.trim().isEmpty) {
      return;
    }
    await _submitScan(barcode.trim());
  }

  Future<void> _finish() async {
    final SafeCancelReturnSession? s = _session;
    if (s == null || !s.allLinesComplete || _busy) {
      return;
    }
    final bool online = ref.read(networkOnlineProvider).valueOrNull ?? true;
    if (!online) {
      showAppSnackBar(
        context,
        SnackBar(
          content: Text(_tr('returnsNeedInternetToFinish')),
          backgroundColor: Colors.red,
        ),
      );
      return;
    }
    setState(() => _busy = true);
    try {
      await ref.read(pickingRepositoryProvider).finishReturnSession(s.id);
      await ReturnSessionStorage.clear(ref.read(sharedPreferencesProvider));
      if (!mounted) {
        return;
      }
      showAppSnackBar(context, SnackBar(content: Text(_tr('returnsFinished'))));
      context.goNamed('pickerHome', queryParameters: const <String, String>{'profile': 'picker'});
    } on Exception catch (e) {
      if (mounted) {
        final String msg = '$e';
        final bool alreadyDone = msg.contains('yopilgan') || msg.contains('409');
        if (alreadyDone) {
          await ReturnSessionStorage.clear(ref.read(sharedPreferencesProvider));
          if (!mounted) return;
          showAppSnackBar(context, SnackBar(content: Text(_tr('returnsFinished'))));
          context.goNamed('pickerHome', queryParameters: const <String, String>{'profile': 'picker'});
          return;
        }
        showAppLocalizedError(context, ref.read(appLocaleProvider), e);
      }
    } finally {
      if (mounted) {
        setState(() => _busy = false);
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    if (_loading) {
      return const Scaffold(body: Center(child: CircularProgressIndicator()));
    }
    if (_loadError != null) {
      return Scaffold(
        appBar: AppBar(title: const Text('Qaytarish')),
        body: Center(
          child: Padding(
            padding: const EdgeInsets.all(24),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: <Widget>[
                Text(_loadError!, textAlign: TextAlign.center),
                const SizedBox(height: 16),
                FilledButton(
                  onPressed: () => context.goNamed(
                    'pickerHome',
                    queryParameters: const <String, String>{'profile': 'picker'},
                  ),
                  child: const Text('Bosh sahifa'),
                ),
              ],
            ),
          ),
        ),
      );
    }
    final SafeCancelReturnSession s = _session!;
    final SafeCancelReturnLine? nextLine = () {
      for (final SafeCancelReturnLine l in s.lines) {
        if (!l.productConfirmed) {
          return l;
        }
      }
      return null;
    }();
    final String hint = nextLine == null
        ? 'Barcha qatorlar tasdiqlandi.'
        : 'Navbat: MAHSULOT — ${nextLine.barcode ?? nextLine.sku ?? nextLine.productName}';

    return PopScope(
      canPop: false,
      child: Scaffold(
        appBar: AppBar(
          automaticallyImplyLeading: false,
          title: const Text('Tovar qaytarish'),
        ),
        body: ListView(
          padding: const EdgeInsets.all(16),
          children: <Widget>[
            Text(
              'Buyurtma: ${s.referenceNumber}',
              style: const TextStyle(fontSize: 18, fontWeight: FontWeight.w700),
            ),
            if (s.orderNumber != null && s.orderNumber!.isNotEmpty)
              Text('№ ${s.orderNumber}', style: TextStyle(color: Theme.of(context).colorScheme.onSurfaceVariant)),
            const SizedBox(height: 12),
            Card(
              color: Colors.orange.shade50,
              child: Padding(
                padding: const EdgeInsets.all(12),
                child: Text(
                  'DIQQAT: buyurtma bekor qilindi. Boshqa vazifa ololmaysiz — qaytarish tugaguncha faqat bu ekran.',
                  style: TextStyle(color: Colors.orange.shade900, fontWeight: FontWeight.w600),
                ),
              ),
            ),
            const SizedBox(height: 12),
            if (nextLine != null) ...<Widget>[
              Card(
                child: Padding(
                  padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: <Widget>[
                      Text(
                        'Qaytarish joyi',
                        style: TextStyle(
                          fontSize: 13,
                          fontWeight: FontWeight.w600,
                          color: context.colors.textSecondary,
                        ),
                      ),
                      const SizedBox(height: 4),
                      Text(
                        nextLine.expectedLocationCode,
                        style: TextStyle(
                          fontSize: 24,
                          fontWeight: FontWeight.w700,
                          color: context.colors.accentFg,
                        ),
                      ),
                      const SizedBox(height: 4),
                      Text(
                        nextLine.productName,
                        style: const TextStyle(fontWeight: FontWeight.w600),
                      ),
                    ],
                  ),
                ),
              ),
              const SizedBox(height: 12),
            ],
            Text(hint, style: const TextStyle(fontWeight: FontWeight.w600)),
            const SizedBox(height: 8),
            IntrinsicHeight(
              child: Row(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: <Widget>[
                  Expanded(
                    child: TextField(
                      controller: _scan,
                      decoration: const InputDecoration(
                        labelText: 'Mahsulot shtrix kodi / SKU',
                        border: OutlineInputBorder(),
                      ),
                      textInputAction: TextInputAction.done,
                      onSubmitted: (_) => unawaited(_submitScan()),
                    ),
                  ),
                  const SizedBox(width: 8),
                  ScanActionButton(
                    compact: true,
                    onPressed: _busy ? null : () => unawaited(_openCameraScan()),
                  ),
                ],
              ),
            ),
            const SizedBox(height: 8),
            FilledButton(
              onPressed: _busy ? null : () => unawaited(_submitScan()),
              child: Text(_busy ? 'Kutilmoqda…' : 'Tasdiqlash'),
            ),
            const SizedBox(height: 20),
            const Text('Qatorlar', style: TextStyle(fontWeight: FontWeight.w700)),
            const SizedBox(height: 8),
            ...s.lines.map(
              (SafeCancelReturnLine l) => ListTile(
                dense: true,
                title: Text(l.productName),
                subtitle: Text(
                  '${l.expectedLocationCode} · ${l.qtyToReturn} · '
                  '${l.productConfirmed ? "✓ mahsulot" : "… mahsulot"}',
                ),
              ),
            ),
            const SizedBox(height: 24),
            FilledButton(
              onPressed: (!s.allLinesComplete || _busy) ? null : () => unawaited(_finish()),
              style: FilledButton.styleFrom(
                backgroundColor: Colors.green.shade700,
                disabledBackgroundColor: Colors.grey.shade400,
              ),
              child: const Text('Finish Return — yakunlash'),
            ),
          ],
        ),
      ),
    );
  }
}

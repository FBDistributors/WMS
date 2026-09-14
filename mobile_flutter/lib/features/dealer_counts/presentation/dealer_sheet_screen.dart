import 'dart:async' show unawaited;

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:uuid/uuid.dart';

import '../../../core/app_state/app_locale.dart';
import '../../../core/app_state/locale_controller.dart';
import '../../../core/errors/api_error_localization.dart';
import '../../../core/formatting/expiry_display_format.dart';
import '../../../core/offline/offline_database.dart';
import '../../../core/offline/offline_providers.dart';
import '../../../core/router/scanner_args.dart';
import '../../../l10n/string_lookup.dart';
import '../../../shared/feedback/app_top_snackbar.dart';
import '../../picking/data/picking_models.dart' show formatPickQty;
import '../../scanner/data/scanner_repository.dart';
import '../../scanner/scanner_providers.dart';
import '../data/dealer_counts_models.dart';
import '../data/dealer_counts_repository.dart' show DealerSheetGoneException;
import '../dealer_counts_providers.dart';
import 'dealer_qty_sheet.dart';

/// Tayyor ro'yxat bilan sanash: ro'yxat telefonga yuklanadi, skan qilinsa
/// ro'yxat shu tovarga filtrlanadi, fakt qoldiq kiritiladi. Sanalmaganlar
/// alohida ko'rinadi — sanov oxirida ular haqiqiy topilma.
class DealerSheetScreen extends ConsumerStatefulWidget {
  const DealerSheetScreen({super.key, required this.countId});

  final String countId;

  @override
  ConsumerState<DealerSheetScreen> createState() => _DealerSheetScreenState();
}

class _DealerSheetScreenState extends ConsumerState<DealerSheetScreen> {
  DealerSheetDraft? _sheet;
  bool _loading = true;
  bool _busy = false;
  String? _loadError;
  SheetFilter _filter = SheetFilter.uncounted;
  final TextEditingController _search = TextEditingController();
  String _query = '';

  @override
  void initState() {
    super.initState();
    _search.addListener(() {
      if (_search.text != _query) {
        setState(() => _query = _search.text);
      }
    });
    unawaited(_load());
  }

  @override
  void dispose() {
    _search.dispose();
    super.dispose();
  }

  AppLocale get _loc => ref.read(appLocaleProvider);

  /// Telefonda nusxa bo'lsa — o'sha; bo'lmasa serverdan olish (claim) va saqlash.
  Future<void> _load() async {
    final DealerSheetDraft? local = await ref.read(dealerSheetDraftProvider(widget.countId).future);
    if (local != null) {
      if (mounted) {
        setState(() {
          _sheet = local;
          _loading = false;
        });
      }
      // Internet bo'lsa — ro'yxat web'dan o'chirilmaganini tekshirish (oflaynda jim).
      unawaited(_checkStillOnServer());
      return;
    }
    try {
      final DealerCount c = await ref.read(dealerCountsRepositoryProvider).claim(widget.countId);
      final DealerSheetDraft sheet = DealerSheetDraft.fromCount(c);
      final OfflineDatabase? db = await ref.read(offlineDatabaseProvider.future);
      await db?.dealerDraftSave(DealerSheetDraft.storageKey(sheet.countId), sheet.toJson());
      ref.invalidate(dealerSheetDraftsProvider);
      ref.invalidate(dealerSheetsProvider);
      if (mounted) {
        setState(() {
          _sheet = sheet;
          _loading = false;
        });
      }
    } on Exception catch (e) {
      if (mounted) {
        setState(() {
          _loadError = localizeApiErrorMessage(_loc, e);
          _loading = false;
        });
      }
    }
  }

  Future<void> _checkStillOnServer() async {
    try {
      await ref.read(dealerCountsRepositoryProvider).get(widget.countId);
    } on DealerSheetGoneException {
      await _handleGone();
    } on Exception {
      // internet yo'q / boshqa xato — nusxa bilan ishlashda davom etiladi
    }
  }

  /// Admin ro'yxatni web'dan o'chirgan: telefondagi nusxani yuborib bo'lmaydi —
  /// o'chiriladi, aks holda "Tayyor ro'yxatlar"da abadiy osilib qoladi.
  Future<void> _handleGone() async {
    final OfflineDatabase? db = await ref.read(offlineDatabaseProvider.future);
    await db?.dealerDraftDelete(DealerSheetDraft.storageKey(widget.countId));
    ref.invalidate(dealerSheetDraftsProvider);
    ref.invalidate(dealerSheetsProvider);
    if (!mounted) {
      return;
    }
    showAppSnackBar(
      context,
      SnackBar(content: Text(StringLookup.t(_loc, 'dealerSheetDeletedOnServer'))),
      type: AppToastType.warning,
    );
    context.pop();
  }

  Future<void> _persist() async {
    final DealerSheetDraft? s = _sheet;
    if (s == null) {
      return;
    }
    final OfflineDatabase? db = await ref.read(offlineDatabaseProvider.future);
    await db?.dealerDraftSave(DealerSheetDraft.storageKey(s.countId), s.toJson());
    ref.invalidate(dealerSheetDraftsProvider);
  }

  // --- skan / sanash ---------------------------------------------------------

  Future<void> _scan() async {
    final String? raw = await context.pushNamed<String>(
      'scanner',
      extra: const ScannerArgs(returnRawBarcode: true),
    );
    if (raw == null || raw.trim().isEmpty || !mounted) {
      return;
    }
    await _handleCode(raw.trim());
  }

  Future<void> _handleCode(String code) async {
    final DealerSheetDraft? s = _sheet;
    if (s == null || _busy) {
      return;
    }
    // Avval lokal ro'yxat: shtrix-kod yoki SKU aynan mos kelsa internet shart emas.
    DealerSheetLine? line = s.lines.cast<DealerSheetLine?>().firstWhere(
          (DealerSheetLine? l) => l != null && (l.barcode == code || (l.sku ?? '').toLowerCase() == code.toLowerCase()),
          orElse: () => null,
        );
    int? boxUnits;
    String? productId;
    String? productName;
    if (line == null) {
      setState(() => _busy = true);
      try {
        final ScannerResolveOut r = await ref.read(scannerRepositoryProvider).resolveBarcode(code);
        if (r.type == ScannerResolveType.product && r.productId != null) {
          productId = r.productId;
          productName = r.productName;
          if ((r.scanKind ?? '').toLowerCase() == 'box' && (r.unitsPerScan ?? 0) > 0) {
            boxUnits = r.unitsPerScan;
          }
          line = s.findByProduct(r.productId!);
        }
      } on Exception {
        // internet yo'q — pastda "ro'yxatda yo'q" oqimi
      }
      if (!mounted) {
        return;
      }
      setState(() => _busy = false);
    }
    if (line == null) {
      // Ro'yxatda yo'q tovar: katalogdan (productId bor) yoki xom kod bilan qo'shish.
      final bool? ok = await showDialog<bool>(
        context: context,
        builder: (BuildContext ctx) => AlertDialog(
          title: Text(StringLookup.t(_loc, 'dealerSheetNotInList')),
          content: Text('${productName ?? StringLookup.t(_loc, 'dealerCountUnknownBarcode')}\n$code'),
          actions: <Widget>[
            TextButton(onPressed: () => Navigator.of(ctx).pop(false), child: Text(StringLookup.t(_loc, 'cancel'))),
            FilledButton(onPressed: () => Navigator.of(ctx).pop(true), child: Text(StringLookup.t(_loc, 'dealerSheetAddToList'))),
          ],
        ),
      );
      if (ok != true || !mounted) {
        return;
      }
      line = DealerSheetLine(
        key: const Uuid().v4(),
        lineId: null,
        productId: productId,
        sku: null,
        productName: productName,
        barcode: code,
        snapshotQty: null,
        qty: null,
        expiryDate: null,
        countedAt: null,
        added: true,
      );
      s.lines.add(line);
    }
    await _countLine(line, boxUnits: boxUnits);
  }

  Future<void> _countLine(DealerSheetLine line, {int? boxUnits}) async {
    final DealerQtyResult? q = await showModalBottomSheet<DealerQtyResult>(
      context: context,
      isScrollControlled: true,
      builder: (BuildContext ctx) => DealerQtySheet(
        loc: _loc,
        title: line.productName ?? StringLookup.t(_loc, 'dealerCountUnknownBarcode'),
        subtitle: line.snapshotQty != null
            ? '${line.sku ?? line.barcode} · ${StringLookup.tParams(_loc, 'dealerSheetSnapshot', <String, String>{'n': formatPickQty(line.snapshotQty!)})}'
            : (line.sku ?? line.barcode),
        initialQty: line.qty,
        initialExpiry: line.expiryDate,
        boxUnits: boxUnits,
        allowDelete: line.added,
        allowZero: true,
      ),
    );
    if (q == null || !mounted) {
      return;
    }
    setState(() {
      if (q.delete) {
        _sheet!.lines.remove(line);
      } else {
        line.qty = q.qty;
        line.expiryDate = q.expiryIso;
        line.countedAt = DateTime.now().toUtc().toIso8601String();
      }
    });
    _search.clear();
    await _persist();
  }

  // --- yuborish ----------------------------------------------------------------

  Future<void> _submit() async {
    final DealerSheetDraft? s = _sheet;
    if (s == null || _busy) {
      return;
    }
    if (s.countedCount == 0) {
      showAppSnackBar(context, SnackBar(content: Text(StringLookup.t(_loc, 'dealerCountSubmitEmpty'))), type: AppToastType.error);
      return;
    }
    String policy = 'zero';
    final bool? ok = await showDialog<bool>(
      context: context,
      builder: (BuildContext ctx) => StatefulBuilder(
        builder: (BuildContext ctx2, void Function(void Function()) setD) => AlertDialog(
          title: Text(StringLookup.t(_loc, 'dealerCountSubmit')),
          content: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: <Widget>[
              Text(
                StringLookup.tParams(_loc, 'dealerSheetSubmitConfirm', <String, String>{
                  'dealer': s.dealerName,
                  'done': '${s.countedCount}',
                  'total': '${s.lines.length}',
                  'units': formatPickQty(s.countedUnits),
                }),
              ),
              if (s.uncountedCount > 0) ...<Widget>[
                const SizedBox(height: 12),
                Text(
                  StringLookup.tParams(_loc, 'dealerSheetUncountedQuestion', <String, String>{'n': '${s.uncountedCount}'}),
                  style: const TextStyle(fontWeight: FontWeight.w600),
                ),
                RadioListTile<String>(
                  value: 'zero',
                  groupValue: policy,
                  dense: true,
                  contentPadding: EdgeInsets.zero,
                  title: Text(StringLookup.t(_loc, 'dealerSheetUncountedZero')),
                  onChanged: (String? v) => setD(() => policy = v ?? 'zero'),
                ),
                RadioListTile<String>(
                  value: 'keep',
                  groupValue: policy,
                  dense: true,
                  contentPadding: EdgeInsets.zero,
                  title: Text(StringLookup.t(_loc, 'dealerSheetUncountedKeep')),
                  onChanged: (String? v) => setD(() => policy = v ?? 'keep'),
                ),
              ],
            ],
          ),
          actions: <Widget>[
            TextButton(onPressed: () => Navigator.of(ctx2).pop(false), child: Text(StringLookup.t(_loc, 'cancel'))),
            FilledButton(onPressed: () => Navigator.of(ctx2).pop(true), child: Text(StringLookup.t(_loc, 'dealerCountSubmit'))),
          ],
        ),
      ),
    );
    if (ok != true || !mounted) {
      return;
    }
    setState(() => _busy = true);
    try {
      final repo = ref.read(dealerCountsRepositoryProvider);
      await repo.putCounts(s.countId, s.countEntries());
      final DealerCount saved = await repo.submit(s.countId, uncounted: policy);
      final OfflineDatabase? db = await ref.read(offlineDatabaseProvider.future);
      await db?.dealerDraftDelete(DealerSheetDraft.storageKey(s.countId));
      ref.invalidate(dealerSheetDraftsProvider);
      ref.invalidate(dealerSheetsProvider);
      ref.invalidate(myDealerCountsProvider);
      if (!mounted) {
        return;
      }
      final String msg = StringLookup.t(_loc, 'dealerCountSubmitted');
      showAppSnackBar(context, SnackBar(content: Text(saved.warning != null ? '$msg\n${saved.warning}' : msg)), type: AppToastType.success);
      context.pop();
    } on DealerSheetGoneException {
      await _handleGone();
    } on Exception catch (e) {
      if (!mounted) {
        return;
      }
      showAppSnackBar(
        context,
        SnackBar(content: Text('${localizeApiErrorMessage(_loc, e)}\n${StringLookup.t(_loc, 'dealerCountOfflineKept')}')),
        type: AppToastType.error,
      );
    } finally {
      if (mounted) {
        setState(() => _busy = false);
      }
    }
  }

  // --- UI ----------------------------------------------------------------------

  @override
  Widget build(BuildContext context) {
    final AppLocale loc = ref.watch(appLocaleProvider);
    final ColorScheme cs = Theme.of(context).colorScheme;
    final DealerSheetDraft? s = _sheet;

    if (_loading) {
      return const Scaffold(body: Center(child: CircularProgressIndicator()));
    }
    if (s == null) {
      return Scaffold(
        appBar: AppBar(leading: IconButton(icon: const Icon(Icons.arrow_back), onPressed: () => context.pop())),
        body: Center(
          child: Padding(padding: const EdgeInsets.all(24), child: Text(_loadError ?? StringLookup.t(loc, 'notFound'), textAlign: TextAlign.center)),
        ),
      );
    }
    final List<DealerSheetLine> shown = s.filtered(_filter, _query);

    return Scaffold(
      appBar: AppBar(
        title: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: <Widget>[
            Text(s.dealerName, maxLines: 1, overflow: TextOverflow.ellipsis, style: const TextStyle(fontSize: 16)),
            Text(
              StringLookup.tParams(loc, 'dealerSheetProgress', <String, String>{'done': '${s.countedCount}', 'total': '${s.lines.length}'}),
              style: TextStyle(fontSize: 12, color: cs.onSurfaceVariant),
            ),
          ],
        ),
        leading: IconButton(icon: const Icon(Icons.arrow_back), onPressed: () => context.pop()),
      ),
      body: Column(
        children: <Widget>[
          Padding(
            padding: const EdgeInsets.fromLTRB(12, 12, 12, 4),
            child: Row(
              children: <Widget>[
                Expanded(
                  child: TextField(
                    controller: _search,
                    enabled: !_busy,
                    decoration: InputDecoration(
                      hintText: StringLookup.t(loc, 'dealerSheetSearchHint'),
                      prefixIcon: const Icon(Icons.search),
                      border: const OutlineInputBorder(),
                      isDense: true,
                    ),
                    textInputAction: TextInputAction.done,
                    onSubmitted: (String v) {
                      // Enter — kod sifatida qabul qilinadi (USB skaner / qo'lda kiritish).
                      if (v.trim().isNotEmpty) {
                        _handleCode(v.trim());
                      }
                    },
                  ),
                ),
                const SizedBox(width: 8),
                FilledButton(
                  onPressed: _busy ? null : _scan,
                  style: FilledButton.styleFrom(padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 14)),
                  child: const Icon(Icons.qr_code_scanner),
                ),
              ],
            ),
          ),
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: 12),
            child: Row(
              children: <Widget>[
                for (final SheetFilter f in SheetFilter.values) ...<Widget>[
                  ChoiceChip(
                    label: Text(
                      switch (f) {
                        SheetFilter.uncounted => '${StringLookup.t(loc, 'dealerSheetFilterUncounted')} ${s.uncountedCount}',
                        SheetFilter.counted => '${StringLookup.t(loc, 'dealerSheetFilterCounted')} ${s.countedCount}',
                        SheetFilter.all => StringLookup.t(loc, 'dealerSheetFilterAll'),
                      },
                    ),
                    selected: _filter == f,
                    onSelected: (_) => setState(() => _filter = f),
                  ),
                  const SizedBox(width: 6),
                ],
              ],
            ),
          ),
          Expanded(
            child: shown.isEmpty
                ? Center(
                    child: Text(
                      _filter == SheetFilter.uncounted && _query.isEmpty
                          ? StringLookup.t(loc, 'dealerSheetAllCounted')
                          : StringLookup.t(loc, 'notFound'),
                      style: TextStyle(color: cs.onSurfaceVariant),
                    ),
                  )
                : ListView.builder(
                    padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
                    itemCount: shown.length,
                    itemBuilder: (BuildContext ctx, int i) {
                      final DealerSheetLine l = shown[i];
                      final String exp = l.expiryDate != null ? ' · ${formatExpiryMonthYear(l.expiryDate)}' : '';
                      return Card(
                        child: ListTile(
                          dense: true,
                          leading: Icon(
                            l.isCounted ? Icons.check_circle : Icons.radio_button_unchecked,
                            color: l.isCounted ? Colors.green : cs.onSurfaceVariant,
                          ),
                          title: Text(
                            l.productName ?? StringLookup.t(loc, 'dealerCountUnknownBarcode'),
                            maxLines: 2,
                            overflow: TextOverflow.ellipsis,
                          ),
                          subtitle: Text(
                            '${l.sku ?? l.barcode}$exp'
                            '${l.snapshotQty != null ? ' · ${StringLookup.tParams(loc, 'dealerSheetSnapshot', <String, String>{'n': formatPickQty(l.snapshotQty!)})}' : ''}',
                            style: const TextStyle(fontFamily: 'monospace', fontSize: 12),
                          ),
                          trailing: Text(
                            l.isCounted ? formatPickQty(l.qty!) : '—',
                            style: TextStyle(
                              fontWeight: FontWeight.w700,
                              fontSize: 16,
                              color: l.isCounted ? null : cs.onSurfaceVariant,
                            ),
                          ),
                          onTap: () => _countLine(l),
                        ),
                      );
                    },
                  ),
          ),
          SafeArea(
            top: false,
            child: Padding(
              padding: const EdgeInsets.fromLTRB(12, 8, 12, 12),
              child: Row(
                children: <Widget>[
                  Expanded(
                    child: Text(
                      '${StringLookup.t(loc, 'dealerCountTotalUnits')}: ${formatPickQty(s.countedUnits)}',
                      style: TextStyle(color: cs.onSurfaceVariant, fontSize: 13),
                    ),
                  ),
                  FilledButton.icon(
                    onPressed: _busy || s.countedCount == 0 ? null : _submit,
                    icon: _busy
                        ? const SizedBox(width: 16, height: 16, child: CircularProgressIndicator(strokeWidth: 2))
                        : const Icon(Icons.cloud_upload_outlined),
                    label: Text(StringLookup.t(loc, 'dealerCountSubmit')),
                  ),
                ],
              ),
            ),
          ),
        ],
      ),
    );
  }
}

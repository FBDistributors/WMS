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
import '../dealer_counts_providers.dart';

/// Diller sanovi — draftni skanerlab to'ldirish va yuborish.
///
/// Har o'zgarish darhol telefonga (sqflite) yoziladi: viloyatda internet
/// uzilsa ham sanov yo'qolmaydi. Serverga faqat "Yuborish" da boradi.
class DealerCountScreen extends ConsumerStatefulWidget {
  const DealerCountScreen({super.key, required this.draftId});

  final String draftId;

  @override
  ConsumerState<DealerCountScreen> createState() => _DealerCountScreenState();
}

class _DealerCountScreenState extends ConsumerState<DealerCountScreen> {
  DealerCountDraft? _draft;
  bool _loading = true;
  bool _busy = false;
  final TextEditingController _code = TextEditingController();

  @override
  void initState() {
    super.initState();
    unawaited(_load());
  }

  @override
  void dispose() {
    _code.dispose();
    super.dispose();
  }

  Future<void> _load() async {
    final DealerCountDraft? d = await ref.read(dealerCountDraftProvider(widget.draftId).future);
    if (!mounted) {
      return;
    }
    setState(() {
      _draft = d;
      _loading = false;
    });
  }

  Future<void> _persist() async {
    final DealerCountDraft? d = _draft;
    if (d == null) {
      return;
    }
    final OfflineDatabase? db = await ref.read(offlineDatabaseProvider.future);
    await db?.dealerDraftSave(d.clientUuid, d.toJson());
    ref.invalidate(dealerCountDraftsProvider);
  }

  AppLocale get _loc => ref.read(appLocaleProvider);

  // --- skan ---------------------------------------------------------------

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
    final DealerCountDraft? d = _draft;
    if (d == null || _busy) {
      return;
    }
    setState(() => _busy = true);
    String? productId;
    String? productName;
    double defaultQty = 1;
    String? boxHint;
    bool resolveFailed = false;
    try {
      final ScannerResolveOut r = await ref.read(scannerRepositoryProvider).resolveBarcode(code);
      if (r.type == ScannerResolveType.product && r.productId != null) {
        productId = r.productId;
        productName = r.productName;
        if ((r.scanKind ?? '').toLowerCase() == 'box' && (r.unitsPerScan ?? 0) > 0) {
          defaultQty = r.unitsPerScan!.toDouble();
          boxHint = StringLookup.tParams(_loc, 'dealerCountBoxHint', <String, String>{'n': '${r.unitsPerScan}'});
        }
      } else {
        resolveFailed = true;
      }
    } on Exception {
      // Internet yo'q yoki server xatosi — xom kod bilan qo'shish taklif qilinadi.
      resolveFailed = true;
    }
    if (!mounted) {
      return;
    }
    setState(() => _busy = false);
    if (resolveFailed) {
      final bool? ok = await showDialog<bool>(
        context: context,
        builder: (BuildContext ctx) => AlertDialog(
          title: Text(StringLookup.t(_loc, 'dealerCountUnknownBarcode')),
          content: Text('${StringLookup.t(_loc, 'dealerCountResolveFailedAsk')}\n\n$code'),
          actions: <Widget>[
            TextButton(onPressed: () => Navigator.of(ctx).pop(false), child: Text(StringLookup.t(_loc, 'cancel'))),
            FilledButton(onPressed: () => Navigator.of(ctx).pop(true), child: Text(StringLookup.t(_loc, 'dealerCountAddUnknown'))),
          ],
        ),
      );
      if (ok != true || !mounted) {
        return;
      }
    }
    final _QtyResult? q = await _askQty(
      title: productName ?? StringLookup.t(_loc, 'dealerCountUnknownBarcode'),
      subtitle: code,
      initialQty: defaultQty,
      initialExpiry: null,
      hint: boxHint,
    );
    if (q == null || !mounted) {
      return;
    }
    setState(() {
      d.addScan(
        key: const Uuid().v4(),
        productId: productId,
        productName: productName,
        scannedBarcode: code,
        qty: q.qty,
        expiryDate: q.expiryIso,
        scannedAt: DateTime.now().toUtc().toIso8601String(),
      );
    });
    _code.clear();
    await _persist();
  }

  Future<void> _editLine(DealerCountDraftLine line) async {
    final _QtyResult? q = await _askQty(
      title: line.productName ?? StringLookup.t(_loc, 'dealerCountUnknownBarcode'),
      subtitle: line.scannedBarcode,
      initialQty: line.qty,
      initialExpiry: line.expiryDate,
      hint: null,
      allowDelete: true,
    );
    if (q == null || !mounted) {
      return;
    }
    setState(() {
      if (q.delete) {
        _draft!.lines.remove(line);
      } else {
        line.qty = q.qty;
        line.expiryDate = q.expiryIso;
      }
    });
    await _persist();
  }

  Future<_QtyResult?> _askQty({
    required String title,
    required String subtitle,
    required double initialQty,
    required String? initialExpiry,
    required String? hint,
    bool allowDelete = false,
  }) {
    return showModalBottomSheet<_QtyResult>(
      context: context,
      isScrollControlled: true,
      builder: (BuildContext ctx) => _QtySheet(
        loc: _loc,
        title: title,
        subtitle: subtitle,
        initialQty: initialQty,
        initialExpiry: initialExpiry,
        hint: hint,
        allowDelete: allowDelete,
      ),
    );
  }

  // --- yuborish / o'chirish ---------------------------------------------------

  Future<void> _submit() async {
    final DealerCountDraft? d = _draft;
    if (d == null || _busy) {
      return;
    }
    if (d.lines.isEmpty) {
      showAppSnackBar(context, SnackBar(content: Text(StringLookup.t(_loc, 'dealerCountSubmitEmpty'))), type: AppToastType.error);
      return;
    }
    final bool? ok = await showDialog<bool>(
      context: context,
      builder: (BuildContext ctx) => AlertDialog(
        title: Text(StringLookup.t(_loc, 'dealerCountSubmit')),
        content: Text(
          StringLookup.tParams(_loc, 'dealerCountSubmitConfirm', <String, String>{
            'dealer': d.dealerName,
            'lines': '${d.lines.length}',
            'units': formatPickQty(d.totalUnits),
          }),
        ),
        actions: <Widget>[
          TextButton(onPressed: () => Navigator.of(ctx).pop(false), child: Text(StringLookup.t(_loc, 'cancel'))),
          FilledButton(onPressed: () => Navigator.of(ctx).pop(true), child: Text(StringLookup.t(_loc, 'dealerCountSubmit'))),
        ],
      ),
    );
    if (ok != true || !mounted) {
      return;
    }
    setState(() => _busy = true);
    try {
      final DealerCount saved = await ref.read(dealerCountsRepositoryProvider).create(d, submit: true);
      final OfflineDatabase? db = await ref.read(offlineDatabaseProvider.future);
      await db?.dealerDraftDelete(d.clientUuid);
      ref.invalidate(dealerCountDraftsProvider);
      ref.invalidate(myDealerCountsProvider);
      if (!mounted) {
        return;
      }
      final String msg = StringLookup.t(_loc, 'dealerCountSubmitted');
      showAppSnackBar(
        context,
        SnackBar(content: Text(saved.warning != null ? '$msg\n${saved.warning}' : msg)),
        type: AppToastType.success,
      );
      context.pop();
    } on Exception catch (e) {
      if (!mounted) {
        return;
      }
      // Draft telefonda qoladi — xodim keyin qayta yuboradi.
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

  Future<void> _deleteDraft() async {
    final DealerCountDraft? d = _draft;
    if (d == null) {
      return;
    }
    final bool? ok = await showDialog<bool>(
      context: context,
      builder: (BuildContext ctx) => AlertDialog(
        title: Text(StringLookup.t(_loc, 'dealerCountDeleteDraft')),
        content: Text(StringLookup.t(_loc, 'dealerCountDeleteConfirm')),
        actions: <Widget>[
          TextButton(onPressed: () => Navigator.of(ctx).pop(false), child: Text(StringLookup.t(_loc, 'cancel'))),
          FilledButton(onPressed: () => Navigator.of(ctx).pop(true), child: Text(StringLookup.t(_loc, 'dealerCountDeleteDraft'))),
        ],
      ),
    );
    if (ok != true || !mounted) {
      return;
    }
    final OfflineDatabase? db = await ref.read(offlineDatabaseProvider.future);
    await db?.dealerDraftDelete(d.clientUuid);
    ref.invalidate(dealerCountDraftsProvider);
    if (mounted) {
      context.pop();
    }
  }

  // --- UI -------------------------------------------------------------------

  @override
  Widget build(BuildContext context) {
    final AppLocale loc = ref.watch(appLocaleProvider);
    final ColorScheme cs = Theme.of(context).colorScheme;
    final DealerCountDraft? d = _draft;

    if (_loading) {
      return const Scaffold(body: Center(child: CircularProgressIndicator()));
    }
    if (d == null) {
      return Scaffold(
        appBar: AppBar(leading: IconButton(icon: const Icon(Icons.arrow_back), onPressed: () => context.pop())),
        body: Center(child: Text(StringLookup.t(loc, 'notFound'))),
      );
    }

    return Scaffold(
      appBar: AppBar(
        title: Text(d.dealerName, maxLines: 1, overflow: TextOverflow.ellipsis),
        leading: IconButton(icon: const Icon(Icons.arrow_back), onPressed: () => context.pop()),
        actions: <Widget>[
          IconButton(
            tooltip: StringLookup.t(loc, 'dealerCountDeleteDraft'),
            icon: const Icon(Icons.delete_outline),
            onPressed: _busy ? null : _deleteDraft,
          ),
        ],
      ),
      body: Column(
        children: <Widget>[
          Padding(
            padding: const EdgeInsets.fromLTRB(12, 12, 12, 4),
            child: Row(
              children: <Widget>[
                Expanded(
                  child: TextField(
                    controller: _code,
                    enabled: !_busy,
                    decoration: InputDecoration(
                      hintText: StringLookup.t(loc, 'dealerCountScanHint'),
                      border: const OutlineInputBorder(),
                      isDense: true,
                    ),
                    textInputAction: TextInputAction.done,
                    onSubmitted: (String v) => _handleCode(v.trim()),
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
          Expanded(
            child: d.lines.isEmpty
                ? Center(
                    child: Text(
                      StringLookup.t(loc, 'dealerCountScanHint'),
                      style: TextStyle(color: cs.onSurfaceVariant),
                    ),
                  )
                : ListView.builder(
                    padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 4),
                    itemCount: d.lines.length,
                    itemBuilder: (BuildContext ctx, int i) {
                      // Oxirgi skan yuqorida — xodim hozir nima qo'shganini ko'rsin.
                      final DealerCountDraftLine l = d.lines[d.lines.length - 1 - i];
                      final String exp = l.expiryDate != null ? ' · ${formatExpiryMonthYear(l.expiryDate)}' : '';
                      return Card(
                        child: ListTile(
                          dense: true,
                          leading: l.isUnknown
                              ? const Icon(Icons.help_outline, color: Colors.orange)
                              : Icon(Icons.inventory_2_outlined, color: cs.primary),
                          title: Text(
                            l.productName ?? StringLookup.t(loc, 'dealerCountUnknownBarcode'),
                            maxLines: 2,
                            overflow: TextOverflow.ellipsis,
                          ),
                          subtitle: Text('${l.scannedBarcode}$exp', style: const TextStyle(fontFamily: 'monospace')),
                          trailing: Text(
                            formatPickQty(l.qty),
                            style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 16),
                          ),
                          onTap: () => _editLine(l),
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
                      '${StringLookup.t(loc, 'dealerCountLines')}: ${d.lines.length}\n'
                      '${StringLookup.t(loc, 'dealerCountTotalUnits')}: ${formatPickQty(d.totalUnits)}',
                      style: TextStyle(color: cs.onSurfaceVariant, fontSize: 13),
                    ),
                  ),
                  FilledButton.icon(
                    onPressed: _busy || d.lines.isEmpty ? null : _submit,
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

class _QtyResult {
  const _QtyResult({required this.qty, required this.expiryIso, this.delete = false});
  final double qty;
  final String? expiryIso;
  final bool delete;
}

class _QtySheet extends StatefulWidget {
  const _QtySheet({
    required this.loc,
    required this.title,
    required this.subtitle,
    required this.initialQty,
    required this.initialExpiry,
    required this.hint,
    required this.allowDelete,
  });

  final AppLocale loc;
  final String title;
  final String subtitle;
  final double initialQty;
  final String? initialExpiry;
  final String? hint;
  final bool allowDelete;

  @override
  State<_QtySheet> createState() => _QtySheetState();
}

class _QtySheetState extends State<_QtySheet> {
  late final TextEditingController _qty;
  String? _expiry;

  @override
  void initState() {
    super.initState();
    _qty = TextEditingController(text: formatPickQty(widget.initialQty));
    _expiry = widget.initialExpiry;
  }

  @override
  void dispose() {
    _qty.dispose();
    super.dispose();
  }

  Future<void> _pickExpiry() async {
    final DateTime now = DateTime.now();
    final DateTime? picked = await showDatePicker(
      context: context,
      initialDate: _expiry != null ? (DateTime.tryParse(_expiry!) ?? now) : now,
      firstDate: DateTime(now.year - 3),
      lastDate: DateTime(now.year + 6),
      initialDatePickerMode: DatePickerMode.year,
    );
    if (picked != null) {
      setState(() => _expiry = monthStartIso(picked));
    }
  }

  @override
  Widget build(BuildContext context) {
    final AppLocale loc = widget.loc;
    final ColorScheme cs = Theme.of(context).colorScheme;
    return SafeArea(
      child: Padding(
        padding: EdgeInsets.fromLTRB(16, 16, 16, 16 + MediaQuery.viewInsetsOf(context).bottom),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: <Widget>[
            Text(widget.title, style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 16)),
            const SizedBox(height: 2),
            Text(widget.subtitle, style: TextStyle(color: cs.onSurfaceVariant, fontFamily: 'monospace', fontSize: 13)),
            if (widget.hint != null) ...<Widget>[
              const SizedBox(height: 8),
              Text(widget.hint!, style: TextStyle(color: cs.primary, fontSize: 13)),
            ],
            const SizedBox(height: 14),
            TextField(
              controller: _qty,
              autofocus: true,
              keyboardType: const TextInputType.numberWithOptions(decimal: false),
              decoration: InputDecoration(
                labelText: StringLookup.t(loc, 'dealerCountQtyTitle'),
                border: const OutlineInputBorder(),
              ),
            ),
            const SizedBox(height: 10),
            OutlinedButton.icon(
              onPressed: _pickExpiry,
              icon: const Icon(Icons.event_outlined),
              label: Text(
                _expiry != null
                    ? '${StringLookup.t(loc, 'dealerCountExpiryLabel')}: ${formatExpiryMonthYear(_expiry)}'
                    : StringLookup.t(loc, 'dealerCountExpiryLabel'),
              ),
            ),
            if (_expiry != null)
              TextButton(
                onPressed: () => setState(() => _expiry = null),
                child: Text(StringLookup.t(loc, 'cancel')),
              ),
            const SizedBox(height: 12),
            Row(
              children: <Widget>[
                if (widget.allowDelete)
                  TextButton.icon(
                    onPressed: () => Navigator.of(context).pop(const _QtyResult(qty: 0, expiryIso: null, delete: true)),
                    icon: const Icon(Icons.delete_outline, color: Colors.red),
                    label: Text(StringLookup.t(loc, 'dealerCountRemoveLine'), style: const TextStyle(color: Colors.red)),
                  ),
                const Spacer(),
                FilledButton(
                  onPressed: () {
                    final double q = double.tryParse(_qty.text.trim().replaceAll(',', '.')) ?? 0;
                    if (q <= 0) {
                      return;
                    }
                    Navigator.of(context).pop(_QtyResult(qty: q, expiryIso: _expiry));
                  },
                  child: Text(StringLookup.t(loc, 'confirmButton')),
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }
}

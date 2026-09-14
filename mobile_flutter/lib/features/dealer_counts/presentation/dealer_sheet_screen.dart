import 'dart:async' show Timer, unawaited;

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
import '../../auth/presentation/auth_providers.dart';
import '../../customer_returns/data/customer_return_display_datetime.dart';
import '../../picking/data/picking_models.dart' show formatPickQty;
import '../../scanner/data/scanner_repository.dart';
import '../../scanner/scanner_providers.dart';
import '../data/dealer_counts_models.dart';
import '../data/dealer_counts_repository.dart';
import '../dealer_counts_providers.dart';
import 'dealer_qty_sheet.dart';

/// Diller sanovi: ro'yxat telefonga yuklanadi, skan qilinsa shu tovar qatoriga o'tiladi,
/// fakt qoldiq va joy (javon/zona) kiritiladi. Holat va "yuborish" yo'q — har sanalgan qator
/// internet bo'lganda o'zi serverga ketadi, bo'lmasa telefonda navbatda turadi. Bir sanovni
/// bir necha xodim sanashi mumkin: boshqalar sanagani yangilanganda keladi.
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
  bool _syncing = false;
  bool _syncAgain = false;
  bool _offline = false;
  Timer? _syncTimer;
  late final ProviderContainer _container;

  @override
  void initState() {
    super.initState();
    _container = ProviderScope.containerOf(context, listen: false);
    _search.addListener(() {
      if (_search.text != _query) {
        setState(() => _query = _search.text);
      }
    });
    unawaited(_load());
  }

  @override
  void dispose() {
    _syncTimer?.cancel();
    _search.dispose();
    // Ro'yxat ekrani telefondagi nusxalarni qayta o'qisin (progress, yuborilmaganlar).
    _container.invalidate(dealerSheetDraftsProvider);
    super.dispose();
  }

  AppLocale get _loc => ref.read(appLocaleProvider);

  void _toast(String text, {AppToastType type = AppToastType.info}) {
    if (mounted) {
      showAppSnackBar(context, SnackBar(content: Text(text)), type: type);
    }
  }

  /// Telefonda nusxa bo'lsa — o'sha (keyin fonda serverga yuboriladi/yangilanadi);
  /// bo'lmasa serverdan yuklab olinadi.
  Future<void> _load() async {
    final DealerSheetDraft? local = await ref.read(dealerSheetDraftProvider(widget.countId).future);
    if (local != null) {
      if (mounted) {
        setState(() {
          _sheet = local;
          _loading = false;
        });
      }
      unawaited(_sync());
      return;
    }
    try {
      final DealerCount c = await ref.read(dealerCountsRepositoryProvider).get(widget.countId);
      final String? me = ref.read(authControllerProvider).valueOrNull?.me?.id;
      final DealerSheetDraft sheet = DealerSheetDraft.fromCount(c, ownerUserId: me);
      _sheet = sheet;
      await _persist();
      if (mounted) {
        setState(() => _loading = false);
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

  Future<void> _persist() async {
    final DealerSheetDraft? s = _sheet;
    if (s == null) {
      return;
    }
    final OfflineDatabase? db = await ref.read(offlineDatabaseProvider.future);
    await db?.dealerDraftSave(DealerSheetDraft.storageKey(s.countId), s.toJson());
  }

  // --- serverga yuborish / yangilash ---------------------------------------------

  void _scheduleSync() {
    _syncTimer?.cancel();
    _syncTimer = Timer(const Duration(milliseconds: 800), () => unawaited(_sync()));
  }

  /// Yuborilmaganlarni yuborib, serverdagi holatni (boshqalar sanagani) qo'shadi.
  Future<void> _sync({bool manual = false}) async {
    if (_syncing) {
      _syncAgain = true;
      return;
    }
    final DealerSheetDraft? s = _sheet;
    if (s == null) {
      return;
    }
    setState(() => _syncing = true);
    try {
      do {
        _syncAgain = false;
        final ({List<Map<String, Object?>> entries, Set<String> opIds}) snap = s.pendingSnapshot();
        final CountsResult res = await ref.read(dealerCountsRepositoryProvider).putCounts(s.countId, snap.entries);
        s.markSynced(snap.opIds);
        s.mergeServer(res.count);
        await _persist();
        _offline = false;
        if (res.stale > 0) {
          _toast(StringLookup.tParams(_loc, 'dealerSheetStale', <String, String>{'n': '${res.stale}'}), type: AppToastType.warning);
        }
        if (!res.count.isActive && s.pendingCount == 0) {
          // Shu dillerga yangi sanov yaratilgan — sanalganlar yetkazildi, nusxa endi kerak emas.
          await _dropCopy('dealerSheetClosed');
          return;
        }
      } while (_syncAgain && mounted);
    } on DealerSheetGoneException {
      await _dropCopy('dealerSheetDeletedOnServer');
      return;
    } on Exception {
      _offline = true;
      if (manual) {
        _toast(StringLookup.t(_loc, 'dealerSheetSyncFailed'), type: AppToastType.warning);
      }
    } finally {
      _syncing = false;
      if (mounted) {
        setState(() {});
      }
    }
  }

  Future<void> _dropCopy(String messageKey) async {
    final OfflineDatabase? db = await ref.read(offlineDatabaseProvider.future);
    await db?.dealerDraftDelete(DealerSheetDraft.storageKey(widget.countId));
    _sheet = null;
    if (!mounted) {
      return;
    }
    _toast(StringLookup.t(_loc, messageKey), type: AppToastType.warning);
    context.pop();
  }

  // --- joy (javon / zona) ----------------------------------------------------------

  Future<void> _setLocation() async {
    final DealerSheetDraft? s = _sheet;
    if (s == null) {
      return;
    }
    final TextEditingController ctl = TextEditingController(text: s.currentLocation ?? '');
    final String? result = await showDialog<String>(
      context: context,
      builder: (BuildContext ctx) => AlertDialog(
        title: Text(StringLookup.t(_loc, 'dealerSheetLocationTitle')),
        content: TextField(
          controller: ctl,
          autofocus: true,
          textCapitalization: TextCapitalization.characters,
          maxLength: 32,
          decoration: InputDecoration(
            hintText: StringLookup.t(_loc, 'dealerSheetLocationHint'),
            border: const OutlineInputBorder(),
            suffixIcon: IconButton(
              icon: const Icon(Icons.qr_code_scanner),
              onPressed: () async {
                final String? raw = await ctx.pushNamed<String>('scanner', extra: const ScannerArgs(returnRawBarcode: true));
                if (raw != null && raw.trim().isNotEmpty) {
                  ctl.text = raw.trim();
                }
              },
            ),
          ),
          onSubmitted: (String v) => Navigator.of(ctx).pop(v),
        ),
        actions: <Widget>[
          TextButton(onPressed: () => Navigator.of(ctx).pop(''), child: Text(StringLookup.t(_loc, 'dealerSheetLocationClear'))),
          TextButton(onPressed: () => Navigator.of(ctx).pop(), child: Text(StringLookup.t(_loc, 'cancel'))),
          FilledButton(onPressed: () => Navigator.of(ctx).pop(ctl.text), child: Text(StringLookup.t(_loc, 'confirmButton'))),
        ],
      ),
    );
    ctl.dispose();
    if (result == null || !mounted) {
      return;
    }
    setState(() => s.currentLocation = normLocation(result));
    await _persist();
  }

  // --- skan / sanash -------------------------------------------------------------

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
    // Avval telefondagi ro'yxat: shtrix-kod yoki SKU aynan mos kelsa internet shart emas.
    bool localMatch(DealerSheetLine l) => l.barcode == code || (l.sku ?? '').toLowerCase() == code.toLowerCase();
    final DealerSheetLine? known = s.lines.cast<DealerSheetLine?>().firstWhere(
          (DealerSheetLine? l) => l != null && localMatch(l),
          orElse: () => null,
        );
    int? boxUnits;
    String? productId = known?.productId;
    String? productName = known?.productName;
    if (known == null) {
      setState(() => _busy = true);
      try {
        final ScannerResolveOut r = await ref.read(scannerRepositoryProvider).resolveBarcode(code);
        if (r.type == ScannerResolveType.product && r.productId != null) {
          productId = r.productId;
          productName = r.productName;
          if ((r.scanKind ?? '').toLowerCase() == 'box' && (r.unitsPerScan ?? 0) > 0) {
            boxUnits = r.unitsPerScan;
          }
        }
      } on Exception {
        // internet yo'q — pastda "ro'yxatda yo'q" oqimi
      }
      if (!mounted) {
        return;
      }
      setState(() => _busy = false);
    }
    bool isProduct(DealerSheetLine l) => productId != null ? l.productId == productId : localMatch(l);
    DealerSheetLine? line = s.lineForScan(isProduct, s.currentLocation);
    if (line == null) {
      final DealerSheetLine? template = s.lines.cast<DealerSheetLine?>().firstWhere(
            (DealerSheetLine? l) => l != null && isProduct(l),
            orElse: () => null,
          );
      if (template == null) {
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
      }
      // Shu tovar ro'yxatda bor, lekin boshqa joyda — bu joy uchun yangi qator.
      line = DealerSheetLine(
        key: const Uuid().v4(),
        lineId: null,
        productId: productId ?? template?.productId,
        sku: template?.sku,
        productName: productName ?? template?.productName,
        barcode: template?.barcode ?? code,
        snapshotQty: null,
        qty: null,
        expiryDate: null,
        countedAt: null,
        locationCode: normLocation(s.currentLocation),
      );
      s.lines.add(line);
    }
    await _countLine(line, boxUnits: boxUnits, location: s.currentLocation);
  }

  /// Miqdor kiritish. `location` — skandan: hozirgi joy; ro'yxatdan bosilganda: qatorning
  /// joyi (sanalmagan joysiz qator hozirgi joyni oladi). Qator allaqachon sanalgan bo'lsa oyna
  /// "qo'shish" rejimida ochiladi — oldingi son saqlanib, yangi topilgani ustiga qo'shiladi.
  Future<void> _countLine(DealerSheetLine line, {int? boxUnits, String? location}) async {
    final DealerSheetDraft? s = _sheet;
    if (s == null) {
      return;
    }
    final String? loc = normLocation(location ?? line.locationCode ?? (line.isCounted ? null : s.currentLocation));
    final List<String> sub = <String>[
      line.sku ?? line.barcode,
      if (loc != null) '📍 $loc',
      if (line.snapshotQty != null)
        StringLookup.tParams(_loc, 'dealerSheetSnapshot', <String, String>{'n': formatPickQty(line.snapshotQty!)}),
    ];
    final DealerQtyResult? q = await showModalBottomSheet<DealerQtyResult>(
      context: context,
      isScrollControlled: true,
      builder: (BuildContext ctx) => DealerQtySheet(
        loc: _loc,
        title: line.productName ?? StringLookup.t(_loc, 'dealerCountUnknownBarcode'),
        subtitle: sub.join(' · '),
        previousQty: line.qty,
        previousBy: line.dirty
            ? StringLookup.t(_loc, 'dealerQtyThisPhone')
            : <String>[
                if (line.countedByName != null) line.countedByName!,
                if (line.countedAt != null) formatCustomerReturnApiDateTime(line.countedAt!),
              ].join(' · '),
        initialExpiry: line.expiryDate,
        boxUnits: boxUnits,
        // Faqat telefonda qo'shilgan, hali serverga yetmagan qatorni olib tashlash mumkin.
        allowDelete: line.lineId == null && !line.isCounted,
      ),
    );
    if (!mounted) {
      return;
    }
    // Oyna ochiq turganda serverdan yangilanish kelgan bo'lishi mumkin — qatorni qayta topamiz.
    final DealerSheetLine? live = s.lines.cast<DealerSheetLine?>().firstWhere(
          (DealerSheetLine? l) => l != null && (identical(l, line) || l.key == line.key || (line.lineId != null && l.lineId == line.lineId)),
          orElse: () => null,
        );
    if (q == null) {
      // Bekor qilindi: skandan yaratilgan, sanalmagan yangi qator ro'yxatda qolmasin.
      if (live != null && live.lineId == null && !live.isCounted) {
        setState(() => s.lines.remove(live));
      }
      return;
    }
    if (live == null) {
      return;
    }
    PendingOp? op;
    final double? before = live.qty;
    setState(() {
      if (q.delete) {
        s.lines.remove(live);
      } else {
        op = s.addOp(live, mode: q.mode, qty: q.qty, expiry: q.expiryIso, location: loc);
      }
    });
    _search.clear();
    await _persist();
    _scheduleSync();
    final PendingOp? added = op;
    if (added != null && added.mode == 'add' && before != null && mounted) {
      showAppSnackBar(
        context,
        SnackBar(
          duration: const Duration(seconds: 5),
          content: Text(
            StringLookup.tParams(_loc, 'dealerQtyAdded', <String, String>{
              'prev': formatPickQty(before),
              'add': formatPickQty(added.qty),
              'total': formatPickQty(live.qty ?? 0),
            }),
          ),
          action: SnackBarAction(label: StringLookup.t(_loc, 'dealerQtyUndo'), onPressed: () => unawaited(_undo(live, added))),
        ),
        type: AppToastType.success,
      );
    }
  }

  /// Qo'shishni bekor qilish (xabardagi tugma): yuborilmagan bo'lsa navbatdan olinadi,
  /// yuborilgan bo'lsa serverga aynan shu qo'shishni ayiruvchi kiritish ketadi.
  Future<void> _undo(DealerSheetLine line, PendingOp add) async {
    final DealerSheetDraft? s = _sheet;
    if (s == null || !mounted) {
      return;
    }
    final DealerSheetLine target = s.lines.firstWhere(
      (DealerSheetLine l) => identical(l, line) || l.key == line.key || (line.lineId != null && l.lineId == line.lineId),
      orElse: () => line,
    );
    setState(() => s.undoAdd(target, add));
    await _persist();
    _scheduleSync();
  }

  // --- UI ----------------------------------------------------------------------

  Widget _syncChip(AppLocale loc, DealerSheetDraft s, ColorScheme cs) {
    if (_syncing) {
      return Row(
        mainAxisSize: MainAxisSize.min,
        children: <Widget>[
          const SizedBox(width: 14, height: 14, child: CircularProgressIndicator(strokeWidth: 2)),
          const SizedBox(width: 6),
          Text(StringLookup.t(loc, 'dealerSheetSyncing'), style: TextStyle(fontSize: 13, color: cs.onSurfaceVariant)),
        ],
      );
    }
    final int n = s.pendingCount;
    if (n == 0) {
      return Row(
        mainAxisSize: MainAxisSize.min,
        children: <Widget>[
          const Icon(Icons.cloud_done_outlined, size: 18, color: Colors.green),
          const SizedBox(width: 6),
          Text(StringLookup.t(loc, 'dealerSheetAllSynced'), style: const TextStyle(fontSize: 13, color: Colors.green)),
        ],
      );
    }
    return TextButton.icon(
      onPressed: () => unawaited(_sync(manual: true)),
      icon: const Icon(Icons.cloud_upload_outlined, size: 18, color: Colors.orange),
      label: Text(
        StringLookup.tParams(loc, _offline ? 'dealerSheetPendingOffline' : 'dealerSheetPending', <String, String>{'n': '$n'}),
        style: const TextStyle(fontSize: 13, color: Colors.orange),
      ),
    );
  }

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
        actions: <Widget>[
          IconButton(
            icon: const Icon(Icons.sync),
            tooltip: StringLookup.t(loc, 'dealerSheetRefresh'),
            onPressed: _syncing ? null : () => unawaited(_sync(manual: true)),
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
            child: Align(
              alignment: Alignment.centerLeft,
              child: ActionChip(
                avatar: Icon(Icons.place_outlined, size: 18, color: s.currentLocation != null ? cs.primary : cs.onSurfaceVariant),
                label: Text(
                  s.currentLocation != null
                      ? '${StringLookup.t(loc, 'dealerSheetLocation')}: ${s.currentLocation}'
                      : StringLookup.t(loc, 'dealerSheetLocationNone'),
                ),
                onPressed: _setLocation,
              ),
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
            child: RefreshIndicator(
              onRefresh: () => _sync(manual: true),
              child: shown.isEmpty
                  ? ListView(
                      children: <Widget>[
                        Padding(
                          padding: const EdgeInsets.all(32),
                          child: Text(
                            _filter == SheetFilter.uncounted && _query.isEmpty
                                ? StringLookup.t(loc, 'dealerSheetAllCounted')
                                : StringLookup.t(loc, 'notFound'),
                            textAlign: TextAlign.center,
                            style: TextStyle(color: cs.onSurfaceVariant),
                          ),
                        ),
                      ],
                    )
                  : ListView.builder(
                      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
                      itemCount: shown.length,
                      itemBuilder: (BuildContext ctx, int i) {
                        final DealerSheetLine l = shown[i];
                        final String? breakdown = l.breakdown;
                        final List<String> meta = <String>[
                          l.sku ?? l.barcode,
                          if (breakdown != null) '($breakdown)',
                          if (l.expiryDate != null) formatExpiryMonthYear(l.expiryDate),
                          if (l.locationCode != null) '📍 ${l.locationCode}',
                          if (l.snapshotQty != null)
                            StringLookup.tParams(loc, 'dealerSheetSnapshot', <String, String>{'n': formatPickQty(l.snapshotQty!)}),
                          if (!l.dirty && l.countedByName != null) l.countedByName!,
                        ];
                        return Card(
                          child: ListTile(
                            dense: true,
                            leading: Icon(
                              l.dirty
                                  ? Icons.cloud_upload_outlined
                                  : (l.isCounted ? Icons.check_circle : Icons.radio_button_unchecked),
                              color: l.dirty ? Colors.orange : (l.isCounted ? Colors.green : cs.onSurfaceVariant),
                            ),
                            title: Text(
                              l.productName ?? StringLookup.t(loc, 'dealerCountUnknownBarcode'),
                              maxLines: 2,
                              overflow: TextOverflow.ellipsis,
                            ),
                            subtitle: Text(meta.join(' · '), style: const TextStyle(fontFamily: 'monospace', fontSize: 12)),
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
                  _syncChip(loc, s, cs),
                ],
              ),
            ),
          ),
        ],
      ),
    );
  }
}

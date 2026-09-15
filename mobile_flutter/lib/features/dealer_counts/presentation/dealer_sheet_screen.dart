import 'dart:async' show Timer, unawaited;

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:uuid/uuid.dart';

import '../../../core/app_state/app_locale.dart';
import '../../../core/app_state/locale_controller.dart';
import '../../../core/errors/api_error_localization.dart';
import '../../../core/formatting/expiry_display_format.dart';
import '../../../core/router/scanner_args.dart';
import '../../../l10n/string_lookup.dart';
import '../../../shared/feedback/app_top_snackbar.dart';
import '../../customer_returns/data/customer_return_display_datetime.dart';
import '../../picking/data/picking_models.dart' show formatPickQty;
import '../../scanner/data/scanner_repository.dart';
import '../../scanner/scanner_providers.dart';
import '../data/dealer_counts_models.dart';
import '../data/dealer_counts_repository.dart';
import '../dealer_counts_providers.dart';
import 'dealer_qty_sheet.dart';

/// Ochiq sanovni yangilash oralig'i (boshqa xodimlar sanagani) — web bilan bir xil.
const Duration _refreshEvery = Duration(seconds: 20);

/// Diller sanovi — onlayn (inventarizatsiya kabi). Sanov serverdan olinadi va faqat ekran
/// xotirasida turadi; skan → qator → miqdor → "Saqlash" darhol serverga yoziladi, javobdagi
/// o'zgargan qatorlar ekranga qo'llanadi. Internet yo'q bo'lsa saqlanmaydi — oyna ochiq qoladi,
/// "Qayta urinish". Boshqalar sanagani ekran ochiq turganda har 20 s keladi.
class DealerSheetScreen extends ConsumerStatefulWidget {
  const DealerSheetScreen({super.key, required this.countId});

  final String countId;

  @override
  ConsumerState<DealerSheetScreen> createState() => _DealerSheetScreenState();
}

class _DealerSheetScreenState extends ConsumerState<DealerSheetScreen> with WidgetsBindingObserver {
  DealerSheet? _sheet;
  bool _loading = true;
  bool _busy = false;
  String? _loadError;
  SheetFilter _filter = SheetFilter.uncounted;
  final TextEditingController _search = TextEditingController();
  String _query = '';
  /// Keyingi yangilash uchun server vaqti (`changed_since`).
  String? _since;
  bool _refreshing = false;
  bool _offline = false;
  /// Miqdor oynasi ochiq — fondagi yangilash kutib turadi.
  bool _editing = false;
  Timer? _timer;
  /// Hozirgi joy (javon / zona): keyingi skanlar shu joyga yoziladi. Sanov bo'yicha eslab qolinadi.
  String? _location;

  String get _locationKey => 'dealer_count_location:${widget.countId}';

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    _search.addListener(() {
      if (_search.text != _query) {
        setState(() => _query = _search.text);
      }
    });
    unawaited(_restoreLocation());
    unawaited(_load());
    _timer = Timer.periodic(_refreshEvery, (_) => unawaited(_refresh()));
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    _timer?.cancel();
    _search.dispose();
    super.dispose();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.resumed) {
      unawaited(_refresh());
    }
  }

  AppLocale get _loc => ref.read(appLocaleProvider);

  void _toast(String text, {AppToastType type = AppToastType.info}) {
    if (mounted) {
      showAppSnackBar(context, SnackBar(content: Text(text)), type: type);
    }
  }

  // --- yuklash / yangilash ----------------------------------------------------------

  Future<void> _load() async {
    try {
      final DealerChangedLines r = await ref.read(dealerCountsRepositoryProvider).changedLines(widget.countId);
      if (!mounted) {
        return;
      }
      if (!r.isActive) {
        setState(() {
          _loadError = StringLookup.t(_loc, 'dealerSheetClosed');
          _loading = false;
        });
        return;
      }
      setState(() {
        _sheet = DealerSheet(countId: widget.countId, dealerName: r.dealerName, lines: r.lines)..serverSheetLines = r.sheetLines;
        _since = r.serverTime;
        _loading = false;
        _offline = false;
      });
    } on DealerSheetGoneException {
      if (mounted) {
        setState(() {
          _loadError = StringLookup.t(_loc, 'dealerSheetDeletedOnServer');
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

  /// Boshqalar sanaganini olish (faqat o'zgarganlar). Oyna ochiq yoki ilova fonda bo'lsa kutadi.
  Future<void> _refresh({bool manual = false}) async {
    final DealerSheet? s = _sheet;
    if (s == null || _refreshing || (!manual && (_editing || _busy))) {
      return;
    }
    if (!manual && WidgetsBinding.instance.lifecycleState != AppLifecycleState.resumed) {
      return;
    }
    _refreshing = true;
    try {
      final DealerChangedLines r = await ref.read(dealerCountsRepositoryProvider).changedLines(s.countId, since: _since);
      if (!mounted) {
        return;
      }
      if (!r.isActive) {
        _leave('dealerSheetClosed');
        return;
      }
      setState(() {
        s.applyLines(r.lines, sheetLines: r.sheetLines);
        _since = r.serverTime;
        _offline = false;
      });
      if (s.outOfSync) {
        // Web'da qator o'chirilgan — o'zgarganlar bilan bilinmaydi, to'liq qayta yuklanadi.
        final DealerChangedLines all = await ref.read(dealerCountsRepositoryProvider).changedLines(s.countId);
        if (mounted) {
          setState(() {
            s.lines = List<DealerCountLine>.of(all.lines);
            s.serverSheetLines = all.sheetLines;
            _since = all.serverTime;
          });
        }
      }
    } on DealerSheetGoneException {
      _leave('dealerSheetDeletedOnServer');
    } on Exception catch (e) {
      if (mounted) {
        setState(() => _offline = true);
        if (manual) {
          _toast(localizeApiErrorMessage(_loc, e), type: AppToastType.warning);
        }
      }
    } finally {
      _refreshing = false;
    }
  }

  void _leave(String messageKey) {
    if (!mounted) {
      return;
    }
    _timer?.cancel();
    _toast(StringLookup.t(_loc, messageKey), type: AppToastType.warning);
    context.pop();
  }

  // --- joy (javon / zona) ----------------------------------------------------------

  Future<void> _restoreLocation() async {
    final SharedPreferences prefs = await SharedPreferences.getInstance();
    final String? v = prefs.getString(_locationKey);
    if (mounted && v != null) {
      setState(() => _location = v);
    }
  }

  Future<void> _setLocation() async {
    final TextEditingController ctl = TextEditingController(text: _location ?? '');
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
    final String? loc = normLocation(result);
    setState(() => _location = loc);
    final SharedPreferences prefs = await SharedPreferences.getInstance();
    if (loc == null) {
      await prefs.remove(_locationKey);
    } else {
      await prefs.setString(_locationKey, loc);
    }
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
    final DealerSheet? s = _sheet;
    if (s == null || _busy) {
      return;
    }
    // Avval ekrandagi ro'yxat: shtrix-kod yoki SKU aynan mos kelsa server so'rovi shart emas.
    bool localMatch(DealerCountLine l) => l.scannedBarcode == code || (l.sku ?? '').toLowerCase() == code.toLowerCase();
    final DealerCountLine? known = s.lines.cast<DealerCountLine?>().firstWhere(
          (DealerCountLine? l) => l != null && localMatch(l),
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
      } on Exception catch (e) {
        if (mounted) {
          setState(() => _busy = false);
          _toast(localizeApiErrorMessage(_loc, e), type: AppToastType.error);
        }
        return;
      }
      if (!mounted) {
        return;
      }
      setState(() => _busy = false);
    }
    bool isProduct(DealerCountLine l) => productId != null ? l.productId == productId : localMatch(l);
    final DealerCountLine? line = s.lineForScan(isProduct, _location);
    final DealerCountLine? template = line ??
        s.lines.cast<DealerCountLine?>().firstWhere((DealerCountLine? l) => l != null && isProduct(l), orElse: () => null);
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
    await _count(
      line: line,
      productId: productId ?? template?.productId,
      productName: productName ?? template?.productName,
      sku: template?.sku,
      barcode: template?.scannedBarcode ?? code,
      boxUnits: boxUnits,
      location: _location,
    );
  }

  /// Miqdor kiritish va darhol saqlash. `line` — mavjud qator (null: shu joyda yangi qator —
  /// server ochadi). Qator sanalgan bo'lsa oyna "qo'shish" rejimida ochiladi.
  Future<void> _count({
    required DealerCountLine? line,
    required String? productId,
    required String? productName,
    required String? sku,
    required String barcode,
    required String? location,
    int? boxUnits,
  }) async {
    final DealerSheet? s = _sheet;
    if (s == null) {
      return;
    }
    final String? loc = normLocation(location);
    final double? previous = line?.qty;
    final List<String> sub = <String>[
      sku ?? barcode,
      if (loc != null) '📍 $loc',
      if (line?.snapshotQty != null)
        StringLookup.tParams(_loc, 'dealerSheetSnapshot', <String, String>{'n': formatPickQty(line!.snapshotQty!)}),
    ];
    // Qayta urinishda o'sha kiritish o'sha `op_id` bilan ketadi (server bir marta qo'llaydi);
    // xodim sonni o'zgartirsa — yangi kiritish.
    String opId = const Uuid().v4();
    String? lastPayload;
    bool gone = false;
    bool closed = false;
    int stale = 0;

    Future<String?> save(DealerQtyResult r) async {
      final String payload = '${r.mode}|${r.qty}|${r.expiryIso}|$loc';
      if (lastPayload != null && lastPayload != payload) {
        opId = const Uuid().v4();
      }
      lastPayload = payload;
      try {
        final CountsResult res = await ref.read(dealerCountsRepositoryProvider).putCounts(s.countId, <Map<String, Object?>>[
          dealerCountEntry(
            opId: opId,
            mode: r.mode,
            qty: r.qty,
            lineId: line?.id,
            productId: productId,
            barcode: barcode,
            expiryDate: r.expiryIso,
            locationCode: loc,
          ),
        ]);
        if (mounted) {
          setState(() {
            s.applyLines(res.count.lines, sheetLines: res.count.sheetLines);
            _offline = false;
          });
        }
        stale = res.stale;
        closed = !res.count.isActive;
        return null;
      } on DealerSheetGoneException {
        gone = true;
        return null;
      } on Exception catch (e) {
        if (mounted) {
          setState(() => _offline = true);
        }
        return StringLookup.tParams(_loc, 'dealerSaveFailed', <String, String>{'reason': localizeApiErrorMessage(_loc, e)});
      }
    }

    _editing = true;
    final DealerQtyResult? q = await showModalBottomSheet<DealerQtyResult>(
      context: context,
      isScrollControlled: true,
      isDismissible: false,
      builder: (BuildContext ctx) => DealerQtySheet(
        loc: _loc,
        title: productName ?? StringLookup.t(_loc, 'dealerCountUnknownBarcode'),
        subtitle: sub.join(' · '),
        previousQty: previous,
        previousBy: line == null || !line.isCounted
            ? null
            : <String>[
                if (line.countedByName != null) line.countedByName!,
                if (line.countedAt != null) formatCustomerReturnApiDateTime(line.countedAt!),
              ].join(' · '),
        initialExpiry: line?.expiryDate,
        boxUnits: boxUnits,
        onSave: save,
      ),
    );
    _editing = false;
    if (!mounted) {
      return;
    }
    if (gone) {
      _leave('dealerSheetDeletedOnServer');
      return;
    }
    if (q == null) {
      return;
    }
    _search.clear();
    if (stale > 0) {
      _toast(StringLookup.tParams(_loc, 'dealerSheetStale', <String, String>{'n': '$stale'}), type: AppToastType.warning);
    }
    if (closed) {
      // Saqlandi, lekin shu dillerga yangi sanov yaratilgan — bu sanovda ishlash to'xtaydi.
      _leave('dealerSheetClosed');
      return;
    }
    if (q.mode == 'add' && previous != null) {
      showAppSnackBar(
        context,
        SnackBar(
          duration: const Duration(seconds: 5),
          content: Text(
            StringLookup.tParams(_loc, 'dealerQtyAdded', <String, String>{
              'prev': formatPickQty(previous),
              'add': formatPickQty(q.qty),
              'total': formatPickQty(previous + q.qty),
            }),
          ),
          action: SnackBarAction(label: StringLookup.t(_loc, 'dealerQtyUndo'), onPressed: () => unawaited(_undo(opId))),
        ),
        type: AppToastType.success,
      );
    }
  }

  /// Qo'shishni bekor qilish (xabardagi tugma): server aynan shu qo'shishni ayiradi.
  Future<void> _undo(String addOpId) async {
    final DealerSheet? s = _sheet;
    if (s == null) {
      return;
    }
    try {
      final CountsResult res = await ref.read(dealerCountsRepositoryProvider).putCounts(s.countId, <Map<String, Object?>>[
        dealerCountEntry(opId: const Uuid().v4(), mode: 'undo', undoOpId: addOpId),
      ]);
      if (mounted) {
        setState(() => s.applyLines(res.count.lines, sheetLines: res.count.sheetLines));
      }
    } on Exception catch (e) {
      _toast(
        StringLookup.tParams(_loc, 'dealerUndoFailed', <String, String>{'reason': localizeApiErrorMessage(_loc, e)}),
        type: AppToastType.error,
      );
    }
  }

  // --- UI ----------------------------------------------------------------------

  @override
  Widget build(BuildContext context) {
    final AppLocale loc = ref.watch(appLocaleProvider);
    final ColorScheme cs = Theme.of(context).colorScheme;
    final DealerSheet? s = _sheet;

    if (_loading) {
      return const Scaffold(body: Center(child: CircularProgressIndicator()));
    }
    if (s == null) {
      return Scaffold(
        appBar: AppBar(leading: IconButton(icon: const Icon(Icons.arrow_back), onPressed: () => context.pop())),
        body: Center(
          child: Padding(
            padding: const EdgeInsets.all(24),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: <Widget>[
                Text(_loadError ?? StringLookup.t(loc, 'notFound'), textAlign: TextAlign.center),
                const SizedBox(height: 16),
                FilledButton(
                  onPressed: () {
                    setState(() {
                      _loading = true;
                      _loadError = null;
                    });
                    unawaited(_load());
                  },
                  child: Text(StringLookup.t(loc, 'dealerSaveRetry')),
                ),
              ],
            ),
          ),
        ),
      );
    }
    final List<DealerCountLine> shown = s.filtered(_filter, _query);

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
            icon: const Icon(Icons.refresh),
            tooltip: StringLookup.t(loc, 'dealerSheetRefresh'),
            onPressed: () => unawaited(_refresh(manual: true)),
          ),
        ],
      ),
      body: Column(
        children: <Widget>[
          if (_offline)
            Container(
              width: double.infinity,
              color: cs.errorContainer,
              padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
              child: Row(
                children: <Widget>[
                  Icon(Icons.wifi_off, size: 16, color: cs.onErrorContainer),
                  const SizedBox(width: 6),
                  Expanded(
                    child: Text(StringLookup.t(loc, 'dealerSheetNoInternet'), style: TextStyle(fontSize: 12, color: cs.onErrorContainer)),
                  ),
                ],
              ),
            ),
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
                  child: _busy
                      ? const SizedBox(width: 20, height: 20, child: CircularProgressIndicator(strokeWidth: 2))
                      : const Icon(Icons.qr_code_scanner),
                ),
              ],
            ),
          ),
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: 12),
            child: Align(
              alignment: Alignment.centerLeft,
              child: ActionChip(
                avatar: Icon(Icons.place_outlined, size: 18, color: _location != null ? cs.primary : cs.onSurfaceVariant),
                label: Text(
                  _location != null
                      ? '${StringLookup.t(loc, 'dealerSheetLocation')}: $_location'
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
              onRefresh: () => _refresh(manual: true),
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
                        final DealerCountLine l = shown[i];
                        final List<String> meta = <String>[
                          l.sku ?? l.scannedBarcode,
                          if (l.entriesBrief != null) '(${l.entriesBrief})',
                          if (l.expiryDate != null) formatExpiryMonthYear(l.expiryDate),
                          if (l.locationCode != null) '📍 ${l.locationCode}',
                          if (l.snapshotQty != null)
                            StringLookup.tParams(loc, 'dealerSheetSnapshot', <String, String>{'n': formatPickQty(l.snapshotQty!)}),
                          if (l.countedByName != null) l.countedByName!,
                        ];
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
                            subtitle: Text(meta.join(' · '), style: const TextStyle(fontFamily: 'monospace', fontSize: 12)),
                            trailing: Text(
                              l.isCounted ? formatPickQty(l.qty!) : '—',
                              style: TextStyle(
                                fontWeight: FontWeight.w700,
                                fontSize: 16,
                                color: l.isCounted ? null : cs.onSurfaceVariant,
                              ),
                            ),
                            onTap: () => _count(
                              line: l,
                              productId: l.productId,
                              productName: l.productName,
                              sku: l.sku,
                              barcode: l.scannedBarcode,
                              // Sanalmagan joysiz qator hozirgi joyni oladi; sanalgani o'z joyida qoladi.
                              location: l.locationCode ?? (l.isCounted ? null : _location),
                            ),
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
              child: Text(
                '${StringLookup.t(loc, 'dealerCountTotalUnits')}: ${formatPickQty(s.countedUnits)}',
                style: TextStyle(color: cs.onSurfaceVariant, fontSize: 13),
              ),
            ),
          ),
        ],
      ),
    );
  }
}

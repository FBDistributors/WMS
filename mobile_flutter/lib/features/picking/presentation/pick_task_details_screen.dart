import 'dart:async' show Timer, unawaited;
import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:shared_preferences/shared_preferences.dart';

import '../../../core/app_state/app_locale.dart';
import '../../../core/app_state/locale_controller.dart';
import '../../../core/app_state/network_status_provider.dart';
import '../../../core/app_state/theme_controller.dart';
import '../../../core/offline/offline_database.dart';
import '../../../core/offline/offline_providers.dart';
import '../../../core/router/scanner_args.dart';
import '../../../core/storage/shared_preferences_provider.dart';
import '../../../l10n/string_lookup.dart';
import '../../../shared/input/input_clear_button.dart';
import '../../../shared/input/stock_quantity_input.dart';
import '../../../shared/feedback/app_top_snackbar.dart';
import '../../../shared/layout/sheet_bottom_inset.dart';
import '../../../shared/widgets/scan_action_button.dart';
import '../alternate_location_menu_label.dart' show mergeAlternateLocationsForDisplay, MergedAlternateLocationRow;
import '../data/picking_constants.dart';
import '../data/return_session_storage.dart';
import '../data/picking_models.dart';
import '../domain/profile_type_param.dart';
import '../picking_providers.dart';

class _LineGroup {
  const _LineGroup({required this.virtual, required this.members});

  final PickingLine virtual;
  final List<PickingLine> members;
}

/// `_groupLinesByProduct` bilan bir xil — asosiy va aksiya/sovg'a alohida guruh.
String _lineGroupKey(PickingLine l) {
  if (l.isVipExpiryInformational) {
    return 'vip_info:${l.id}';
  }
  final String src = (l.lineSource ?? 'product').trim();
  if (l.productId != null && l.productId!.isNotEmpty) {
    return 'id:${l.productId}:src:$src';
  }
  return '${l.productName}|${l.barcode ?? l.sku ?? ''}|src:$src';
}

String? _lineSourceBadgeKey(PickingLine line) {
  final String src = (line.lineSource ?? 'product').trim();
  if (src == 'action') return 'lineSourceAction';
  if (src == 'gift') return 'lineSourceGift';
  return null;
}

bool _pickingLineEffectivelyDone(PickingLine l) =>
    l.isVipExpiryInformational || l.qtyPicked >= l.qtyRequired;

bool _lineGroupEffectivelyDone(_LineGroup g) =>
    g.members.every(_pickingLineEffectivelyDone);

/// Yig‘ish uchun keyingi ochiq qator (bir nechta joy/lot bo‘lsa).
PickingLine _activePickMember(_LineGroup g) {
  for (final PickingLine l in g.members) {
    if (!l.isVipExpiryInformational && l.qtyPicked < l.qtyRequired) {
      return l;
    }
  }
  return g.members.first;
}

String _groupLocationQtyLine(_LineGroup g) {
  final List<PickingLine> physical = g.members
      .where((PickingLine l) => !l.isVipExpiryInformational)
      .toList();
  if (physical.length <= 1) {
    final PickingLine l = physical.isNotEmpty ? physical.first : g.members.first;
    return '${l.locationCode} · ${formatPickQty(g.virtual.qtyPicked)}/${formatPickQty(g.virtual.qtyRequired)}';
  }
  return physical
      .map(
        (PickingLine l) =>
            '${l.locationCode}: ${formatPickQty(l.qtyPicked)}/${formatPickQty(l.qtyRequired)}',
      )
      .join(' · ');
}

double _aggregateQtyPicked(Iterable<PickingLine> lines) {
  return lines.fold<double>(0, (double s, PickingLine l) => s + l.qtyPicked);
}

double _aggregateQtyRequired(Iterable<PickingLine> lines) {
  return lines.fold<double>(0, (double s, PickingLine l) => s + l.qtyRequired);
}

List<_LineGroup> _groupLinesByProduct(List<PickingLine> lines) {
  final Map<String, List<PickingLine>> map = <String, List<PickingLine>>{};
  for (final PickingLine l in lines) {
    final String key = _lineGroupKey(l);
    map.putIfAbsent(key, () => <PickingLine>[]).add(l);
  }
  return map.values.map((List<PickingLine> groupLines) {
    final PickingLine first = groupLines.first;
    final double required = groupLines.fold<double>(
      0,
      (double s, PickingLine l) => s + l.qtyRequired,
    );
    final double picked = groupLines.fold<double>(
      0,
      (double s, PickingLine l) => s + l.qtyPicked,
    );
    final PickingLine virtual = PickingLine(
      id: first.id,
      productName: first.productName,
      sku: first.sku,
      barcode: first.barcode,
      locationCode: '—',
      batch: first.batch,
      expiryDate: first.expiryDate,
      qtyRequired: required,
      qtyPicked: picked,
      skipReason: first.skipReason,
      productId: first.productId,
      alternateLocations: first.alternateLocations,
      isVipExpiryInformational: first.isVipExpiryInformational,
      vipExpiryInformationKey: first.vipExpiryInformationKey,
      lineSource: first.lineSource,
    );
    return _LineGroup(virtual: virtual, members: groupLines);
  }).toList(growable: false);
}

/// Kartochka yig‘indisi bilan bir xil — `_groupLinesByProduct` a’zolari (kalit farqi bo‘lsa ham).
List<PickingLine> _membersOfSameCardAs(PickingDocument doc, PickingLine anchor) {
  final List<_LineGroup> groups = _groupLinesByProduct(doc.lines);
  for (final _LineGroup g in groups) {
    if (g.members.any((PickingLine l) => l.id == anchor.id)) {
      return List<PickingLine>.from(g.members);
    }
  }
  return <PickingLine>[anchor];
}

/// Noyakuniy qatorlar yuqorida, to‘liq terilganlar pastda (nisbiy tartib saqlanadi).
List<_LineGroup> _orderedLineGroups(List<_LineGroup> groups) {
  final List<_LineGroup> incomplete = groups
      .where((_LineGroup g) => !_lineGroupEffectivelyDone(g))
      .toList();
  final List<_LineGroup> complete = groups
      .where((_LineGroup g) => _lineGroupEffectivelyDone(g))
      .toList();
  return <_LineGroup>[...incomplete, ...complete];
}

bool _groupFullyVerified(_LineGroup g, Set<String> verifiedLineIds) {
  return g.members.every((PickingLine l) => verifiedLineIds.contains(l.id));
}

/// Kontroller: tekshirilmaganlar yuqorida (ichida miqdor bo‘yicha), to‘liq tekshirilganlar pastda.
List<_LineGroup> _orderedLineGroupsController(
  List<_LineGroup> groups,
  Set<String> verifiedLineIds,
) {
  final List<_LineGroup> pending = <_LineGroup>[];
  final List<_LineGroup> done = <_LineGroup>[];
  for (final _LineGroup g in groups) {
    if (_groupFullyVerified(g, verifiedLineIds)) {
      done.add(g);
    } else {
      pending.add(g);
    }
  }
  final List<_LineGroup> pendingInc = pending
      .where((_LineGroup g) => !_lineGroupEffectivelyDone(g))
      .toList();
  final List<_LineGroup> pendingRest = pending
      .where((_LineGroup g) => _lineGroupEffectivelyDone(g))
      .toList();
  return <_LineGroup>[...pendingInc, ...pendingRest, ...done];
}

String _barcodeSkuSubtitle(PickingLine l) => '${l.barcode ?? '—'} / ${l.sku ?? '—'}';

bool _barcodeMatchesLine(String raw, PickingLine line) {
  final String q = raw.trim().toLowerCase();
  if (q.isEmpty) {
    return false;
  }
  if (line.barcode != null && line.barcode!.toLowerCase() == q) {
    return true;
  }
  if (line.sku != null && line.sku!.toLowerCase() == q) {
    return true;
  }
  return false;
}

PickingLine? _findLineByScan(List<PickingLine> lines, String raw) {
  for (final PickingLine l in lines) {
    if (_barcodeMatchesLine(raw, l)) {
      return l;
    }
  }
  return null;
}

/// RN `Math.floor(Number(qtyInput))` bilan `qty_picked` solishtirish.
bool _controllerQtyMismatch(String qtyRaw, num qtyPicked) {
  final int entered = (double.tryParse(qtyRaw.trim()) ?? 0).floor();
  return entered != qtyPicked;
}

class PickTaskDetailsScreen extends ConsumerStatefulWidget {
  const PickTaskDetailsScreen({super.key, required this.taskId});

  final String taskId;

  @override
  ConsumerState<PickTaskDetailsScreen> createState() =>
      _PickTaskDetailsScreenState();
}

class _PickTaskDetailsScreenState extends ConsumerState<PickTaskDetailsScreen> {
  static String _verifiedKey(String taskId) => 'wms_controller_verified_$taskId';

  final TextEditingController _topScan = TextEditingController();
  bool _busy = false;
  String? _appliedRouteScanKey;
  Set<String> _verifiedLineIds = <String>{};
  Timer? _detailPollTimer;

  String _postCompleteRouteName(PickerProfileParam profile) {
    return profile == PickerProfileParam.controller ? 'pickTasks' : 'pickerHome';
  }

  void _navigateAfterComplete(PickerProfileParam profile, AppLocale loc) {
    if (profile == PickerProfileParam.controller) {
      unawaited(ref.read(openPickTasksProvider.notifier).refreshFromNetwork());
      if (Navigator.of(context).canPop()) {
        context.pop();
        return;
      }
      context.goNamed(
        'pickTasks',
        queryParameters: <String, String>{'profile': profileToQuery(profile)},
      );
      return;
    }
    context.goNamed(
      'pickerHome',
      queryParameters: <String, String>{
        'profile': profileToQuery(profile),
        'completedMessage': StringLookup.t(loc, 'taskCompletedBanner'),
      },
    );
  }

  @override
  void initState() {
    super.initState();
    _loadVerified();
    _detailPollTimer = Timer.periodic(const Duration(seconds: 12), (_) {
      if (!mounted) {
        return;
      }
      ref.invalidate(pickTaskDetailProvider(widget.taskId));
    });
  }

  Future<void> _loadVerified() async {
    final SharedPreferences sp = await SharedPreferences.getInstance();
    final String? raw = sp.getString(_verifiedKey(widget.taskId));
    if (raw == null || raw.isEmpty) {
      return;
    }
    try {
      final Object? dec = jsonDecode(raw);
      if (dec is List) {
        setState(() {
          _verifiedLineIds = dec.map((Object? e) => '$e').toSet();
        });
      }
    } on Object {
      /* ignore */
    }
  }

  Future<void> _saveVerified() async {
    final SharedPreferences sp = await SharedPreferences.getInstance();
    await sp.setString(
      _verifiedKey(widget.taskId),
      jsonEncode(_verifiedLineIds.toList()),
    );
  }

  @override
  void dispose() {
    _detailPollTimer?.cancel();
    _topScan.dispose();
    super.dispose();
  }

  void _rejectScanHaptic() {
    HapticFeedback.heavyImpact();
  }

  /// Konsolidatsiya `consolidatedPickSuccess` uslubida — modal yopilgach asosiy sahifada.
  void _showControllerVerifiedSnackBar() {
    final AppLocale loc = ref.read(appLocaleProvider);
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (!mounted) {
        return;
      }
      final Color iconColor = Colors.green.shade700;
      showAppSnackBar(context,
        SnackBar(
          behavior: SnackBarBehavior.floating,
          duration: const Duration(seconds: 3),
          content: Row(
            children: <Widget>[
              Icon(Icons.check_circle_rounded, color: iconColor, size: 22),
              const SizedBox(width: 10),
              Expanded(
                child: Text(StringLookup.t(loc, 'controllerPositionVerified')),
              ),
            ],
          ),
        ),
      );
    });
  }

  bool _isControllerGroupFullyVerified(PickingDocument doc, PickingLine anchor) {
    final List<PickingLine> members = _membersOfSameCardAs(doc, anchor);
    return members.every((PickingLine l) => _verifiedLineIds.contains(l.id));
  }

  Future<void> _clearVerifiedForGroup(PickingDocument doc, PickingLine anchor) async {
    final Set<String> ids =
        _membersOfSameCardAs(doc, anchor).map((PickingLine l) => l.id).toSet();
    if (!ids.any(_verifiedLineIds.contains)) {
      return;
    }
    setState(() {
      _verifiedLineIds = _verifiedLineIds.difference(ids);
    });
    await _saveVerified();
  }

  void _showControllerAlreadyVerifiedSnackBar() {
    final AppLocale loc = ref.read(appLocaleProvider);
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (!mounted) {
        return;
      }
      showAppSnackBar(
        context,
        SnackBar(
          behavior: SnackBarBehavior.floating,
          duration: const Duration(seconds: 3),
          content: Text(StringLookup.t(loc, 'controllerPositionAlreadyVerified')),
        ),
      );
    });
  }

  Future<void> _controllerVerifyAfterScan(
    PickingDocument doc,
    PickingLine line,
  ) async {
    if (_isControllerGroupFullyVerified(doc, line)) {
      _rejectScanHaptic();
      _showControllerAlreadyVerifiedSnackBar();
      return;
    }
    await _presentControllerVerifySheet(doc, line);
  }

  Future<void> _runPickTaskRouteScanWorkflow({
    required String sb,
    required String? lineId,
    required PickerProfileParam profile,
  }) async {
    try {
      if (profile == PickerProfileParam.picker &&
          lineId != null &&
          lineId.isNotEmpty) {
        await _handlePickerRouteScan(sb, lineId);
      } else if (profile == PickerProfileParam.controller) {
        if (lineId != null && lineId.isNotEmpty) {
          await _handleControllerRouteScan(sb, lineId);
        } else {
          await _handleControllerBarcodeOnlyScan(sb);
        }
      } else {
        _topScan.text = sb;
        await _submitTopScan();
      }
    } on Exception catch (e) {
      if (mounted) {
        _rejectScanHaptic();
        showAppSnackBar(context, SnackBar(content: Text('$e')));
      }
    } finally {
      if (mounted) {
        setState(() => _appliedRouteScanKey = null);
      }
    }
  }

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    final Uri uri = GoRouterState.of(context).uri;
    final String? sb = uri.queryParameters['scannedBarcode'];
    if (sb == null || sb.isEmpty) {
      return;
    }
    final String? lineId = uri.queryParameters['lineId'];
    final String scanKey = '${sb.trim()}|${lineId ?? ''}';
    if (_appliedRouteScanKey == scanKey) {
      return;
    }
    _appliedRouteScanKey = scanKey;

    WidgetsBinding.instance.addPostFrameCallback((_) async {
      if (!mounted) {
        return;
      }
      final String? profileQ = GoRouterState.of(context).uri.queryParameters['profile'];
      final PickerProfileParam profile = pickerProfileFromQuery(profileQ);
      final GoRouter router = GoRouter.of(context);
      // Route query ni tez tozalaymiz, scan ishlovi esa alohida davom etadi.
      router.goNamed(
        'pickTaskDetail',
        pathParameters: <String, String>{'taskId': widget.taskId},
        queryParameters: <String, String>{'profile': profileToQuery(profile)},
      );

      await _runPickTaskRouteScanWorkflow(sb: sb, lineId: lineId, profile: profile);
    });
  }

  Future<PickingDocument> _loadRouteScanDocument() async {
    final AsyncValue<PickingDocument> cached = ref.read(pickTaskDetailProvider(widget.taskId));
    final PickingDocument? doc = cached.valueOrNull;
    if (doc != null) {
      return doc;
    }
    return ref.read(pickingRepositoryProvider).getTaskById(widget.taskId);
  }

  /// Skaner `lineId`siz qaytganida (RN `useFocusEffect` kontroller branch).
  Future<void> _handleControllerBarcodeOnlyScan(String barcode) async {
    final PickingDocument doc = await _loadRouteScanDocument();
    if (!mounted) {
      return;
    }
    final AppLocale loc = ref.read(appLocaleProvider);
    final PickingLine? line = _findLineByScan(doc.lines, barcode);
    if (line == null) {
      _rejectScanHaptic();
      showAppSnackBar(context,
        SnackBar(content: Text(StringLookup.t(loc, 'productNotInOrder'))),
      );
      return;
    }
    await _controllerVerifyAfterScan(doc, line);
  }

  Future<void> _handleControllerRouteScan(String barcode, String lineId) async {
    final PickingDocument doc = await _loadRouteScanDocument();
    if (!mounted) {
      return;
    }
    PickingLine? physical;
    for (final PickingLine scanLine in doc.lines) {
      if (scanLine.id == lineId) {
        physical = scanLine;
        break;
      }
    }
    final AppLocale loc = ref.read(appLocaleProvider);
    if (physical == null) {
      _rejectScanHaptic();
      showAppSnackBar(context,
        SnackBar(content: Text(StringLookup.t(loc, 'notFound'))),
      );
      return;
    }
    if (!_barcodeMatchesLine(barcode, physical)) {
      _rejectScanHaptic();
      showAppSnackBar(context,
        SnackBar(
          content: Text(
            '${StringLookup.t(loc, 'wrongBarcodeMessage')}'
            '${physical.barcode ?? physical.sku ?? '—'}',
          ),
        ),
      );
      return;
    }
    await _controllerVerifyAfterScan(doc, physical);
  }

  /// RN `PickTaskDetails` `useFocusEffect`: skan + lineId → modal, `submitScan` yo‘q.
  Future<void> _handlePickerRouteScan(String barcode, String lineId) async {
    final PickingDocument doc = await _loadRouteScanDocument();
    if (!mounted) {
      return;
    }
    await _openPickerPickModalByBarcode(
      doc: doc,
      barcode: barcode,
      preferredLineId: lineId,
    );
  }

  Future<void> _openPickerPickModalByBarcode({
    required PickingDocument doc,
    required String barcode,
    String? preferredLineId,
  }) async {
    final AppLocale loc = ref.read(appLocaleProvider);
    final String normalized = barcode.trim();
    PickingLine? line = preferredLineId != null && preferredLineId.isNotEmpty
        ? null
        : _findLineByScan(doc.lines, normalized);

    if (preferredLineId != null && preferredLineId.isNotEmpty) {
      for (final PickingLine l in doc.lines) {
        if (l.id == preferredLineId) {
          line = l;
          break;
        }
      }
    }

    if (line == null) {
      _rejectScanHaptic();
      showAppSnackBar(context,
        SnackBar(
          content: Text(
            preferredLineId != null && preferredLineId.isNotEmpty
                ? StringLookup.t(loc, 'notFound')
                : StringLookup.t(loc, 'productNotInOrder'),
          ),
        ),
      );
      return;
    }
    if (!_barcodeMatchesLine(normalized, line)) {
      _rejectScanHaptic();
      showAppSnackBar(context,
        SnackBar(
          content: Text(
            '${StringLookup.t(loc, 'wrongBarcodeMessage')}'
            '${line.barcode ?? line.sku ?? '—'}',
          ),
        ),
      );
      return;
    }
    final double remaining = line.qtyRequired - line.qtyPicked;
    if (remaining <= 0) {
      _rejectScanHaptic();
      showAppSnackBar(context,
        SnackBar(content: Text(StringLookup.t(loc, 'consolidatedNothingToPick'))),
      );
      return;
    }
    final PickingLine resolvedLine = line;
    _topScan.clear();
    final List<_LineGroup> groups = _groupLinesByProduct(doc.lines);
    _LineGroup? group;
    for (final _LineGroup g in groups) {
      if (g.members.any((PickingLine m) => m.id == resolvedLine.id)) {
        group = g;
        break;
      }
    }
    await _openLineSheet(
      doc,
      group ??
          _LineGroup(
            virtual: resolvedLine,
            members: <PickingLine>[resolvedLine],
          ),
      PickerProfileParam.picker,
      presetScannedBarcode: normalized,
    );
  }

  Future<void> _presentControllerVerifySheet(
    PickingDocument doc,
    PickingLine physical,
  ) async {
    final AppLocale loc = ref.read(appLocaleProvider);
    final BuildContext hostContext = context;
    final List<PickingLine> groupLines = _membersOfSameCardAs(doc, physical);
    final double aggPicked = _aggregateQtyPicked(groupLines);
    final double aggRequired = _aggregateQtyRequired(groupLines);
    final TextEditingController qty =
        TextEditingController(text: formatPickQty(aggPicked));
    try {
      await showModalBottomSheet<void>(
        context: context,
        isScrollControlled: true,
        builder: (BuildContext ctx) {
          return Padding(
            padding: EdgeInsets.only(bottom: sheetBottomPadding(ctx)),
            child: SingleChildScrollView(
              padding: const EdgeInsets.all(20),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                mainAxisSize: MainAxisSize.min,
                children: <Widget>[
                  Text(
                    physical.productName,
                    style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 17),
                  ),
                  const SizedBox(height: 8),
                  Text(
                    '${groupLines.first.locationCode} · ${formatPickQty(aggPicked)}/${formatPickQty(aggRequired)}',
                    style: TextStyle(
                      color: Theme.of(ctx).colorScheme.onSurfaceVariant,
                    ),
                  ),
                  const SizedBox(height: 16),
                  TextField(
                    controller: qty,
                    keyboardType: kStockQtyKeyboardType,
                    inputFormatters: kStockQtyInputFormatters,
                    decoration: InputDecoration(
                      labelText: StringLookup.t(loc, 'qtyShort'),
                      border: const OutlineInputBorder(),
                    ),
                  ),
                  const SizedBox(height: 16),
                  FilledButton(
                    onPressed: () async {
                      if (_controllerQtyMismatch(qty.text, aggPicked)) {
                        _rejectScanHaptic();
                        showAppSnackBar(hostContext,
                          SnackBar(
                            content: Text(
                              '${StringLookup.t(loc, 'qtyMismatch')}: ${physical.productName}',
                            ),
                          ),
                        );
                        return;
                      }
                      final Set<String> ids =
                          groupLines.map((PickingLine l) => l.id).toSet();
                      setState(() {
                        _verifiedLineIds = {..._verifiedLineIds, ...ids};
                      });
                      await _saveVerified();
                      if (ctx.mounted) {
                        Navigator.of(ctx).pop();
                      }
                      _showControllerVerifiedSnackBar();
                    },
                    child: Text(StringLookup.t(loc, 'confirmButton')),
                  ),
                  TextButton(
                    onPressed: () => Navigator.of(ctx).pop(),
                    child: Text(StringLookup.t(loc, 'cancel')),
                  ),
                ],
              ),
            ),
          );
        },
      );
    } finally {
      qty.dispose();
    }
  }

  Future<void> _submitTopScan() async {
    final String code = _topScan.text.trim();
    if (code.isEmpty) {
      return;
    }
    final PickerProfileParam profile = pickerProfileFromQuery(
      GoRouterState.of(context).uri.queryParameters['profile'],
    );

    if (profile == PickerProfileParam.controller) {
      final bool online = ref.read(networkOnlineProvider).valueOrNull ?? true;
      final AppLocale loc = ref.read(appLocaleProvider);
      if (!online) {
        showAppSnackBar(context,
          SnackBar(
            content: Text(
              StringLookup.tParams(
                loc,
                'offlineBanner',
                <String, String>{'count': '0'},
              ),
            ),
          ),
        );
        return;
      }
      setState(() => _busy = true);
      try {
        final PickingDocument doc = await _loadRouteScanDocument();
        if (!mounted) {
          return;
        }
        final PickingLine? line = _findLineByScan(doc.lines, code);
        if (line == null) {
          _rejectScanHaptic();
          showAppSnackBar(context,
            SnackBar(content: Text(StringLookup.t(loc, 'productNotInOrder'))),
          );
          return;
        }
        _topScan.clear();
        await _controllerVerifyAfterScan(doc, line);
      } on Exception catch (e) {
        if (mounted) {
          _rejectScanHaptic();
          showAppSnackBar(context, SnackBar(content: Text('$e')));
        }
      } finally {
        if (mounted) {
          setState(() => _busy = false);
        }
      }
      return;
    }

    setState(() => _busy = true);
    try {
      final PickingDocument doc = await _loadRouteScanDocument();
      if (!mounted) {
        return;
      }
      await _openPickerPickModalByBarcode(doc: doc, barcode: code);
    } on Exception catch (e) {
      if (mounted) {
        _rejectScanHaptic();
        showAppSnackBar(context, SnackBar(content: Text('$e')));
      }
    } finally {
      if (mounted) {
        setState(() => _busy = false);
      }
    }
  }

  String _statusLabel(AppLocale loc, PickerProfileParam profile, PickingDocument doc) {
    if (profile == PickerProfileParam.controller && doc.status == 'picked') {
      return StringLookup.t(loc, 'statusPendingVerify');
    }
    const Map<String, String> map = <String, String>{
      'new': 'statusNew',
      'in_progress': 'statusInProgress',
      'partial': 'statusPartial',
      'picked': 'statusPicked',
      'completed': 'statusCompleted',
      'cancelled': 'statusCancelled',
    };
    return StringLookup.t(loc, map[doc.status] ?? 'statusNew');
  }

  String _headerTitle(AppLocale loc, PickingDocument doc) {
    final String? on = doc.orderNumber;
    if (on != null && on.isNotEmpty) {
      return StringLookup.tParams(loc, 'orderNumberDisplay', <String, String>{'number': on});
    }
    return doc.referenceNumber;
  }

  Future<void> _complete(PickingDocument doc, PickerProfileParam profile) async {
    final AppLocale loc = ref.read(appLocaleProvider);
    final bool online = ref.read(networkOnlineProvider).valueOrNull ?? true;

    if (profile == PickerProfileParam.picker) {
      final List<PickingLine> incomplete = doc.lines
          .where((PickingLine l) => !_pickingLineEffectivelyDone(l))
          .toList();
      if (incomplete.isNotEmpty) {
        if (!online) {
          final OfflineDatabase? db = await ref.read(offlineDatabaseProvider.future);
          if (db == null) {
            return;
          }
          String? pickedReason;
          if (!mounted) {
            return;
          }
          await showModalBottomSheet<void>(
            context: context,
            isScrollControlled: true,
            builder: (BuildContext ctx) {
              String? sel;
              return StatefulBuilder(
                builder: (BuildContext context, void Function(void Function()) setM) {
                  return Padding(
                    padding: EdgeInsets.only(
                      bottom: sheetBottomPadding(context),
                    ),
                    child: _ReasonListSheet(
                      loc: loc,
                      title: StringLookup.t(loc, 'incompleteReasonTitle'),
                      hint: StringLookup.t(loc, 'incompleteReasonSelect'),
                      selected: sel,
                      onSelect: (String? v) => setM(() => sel = v),
                      onConfirm: () async {
                        pickedReason = sel;
                        Navigator.of(ctx).pop();
                      },
                      onCancel: () => Navigator.of(ctx).pop(),
                    ),
                  );
                },
              );
            },
          );
          if (pickedReason == null) {
            return;
          }
          await db.queueAdd(
            'q_${DateTime.now().millisecondsSinceEpoch}',
            'PICK_CLOSE_TASK',
            <String, Object?>{
              'taskId': widget.taskId,
              'ts': DateTime.now().millisecondsSinceEpoch,
              'incomplete_reason': pickedReason,
            },
            'pending',
          );
          if (mounted) {
            _navigateAfterComplete(profile, loc);
          }
          return;
        }
        String? pickedReason;
        if (!mounted) {
          return;
        }
        await showModalBottomSheet<void>(
          context: context,
          isScrollControlled: true,
          builder: (BuildContext ctx) {
            String? sel;
            return StatefulBuilder(
              builder: (BuildContext context, void Function(void Function()) setM) {
                return Padding(
                  padding: EdgeInsets.only(
                    bottom: sheetBottomPadding(context),
                  ),
                  child: _ReasonListSheet(
                    loc: loc,
                    title: StringLookup.t(loc, 'incompleteReasonTitle'),
                    hint: StringLookup.t(loc, 'incompleteReasonSelect'),
                    selected: sel,
                    onSelect: (String? v) => setM(() => sel = v),
                    onConfirm: () async {
                      pickedReason = sel;
                      Navigator.of(ctx).pop();
                    },
                    onCancel: () => Navigator.of(ctx).pop(),
                  ),
                );
              },
            );
          },
        );
        if (pickedReason == null) {
          return;
        }
        setState(() => _busy = true);
        try {
          await ref.read(pickingRepositoryProvider).completePickDocument(
                widget.taskId,
                incompleteReason: pickedReason,
              );
          if (mounted) {
            _navigateAfterComplete(profile, loc);
          }
        } on Exception catch (e) {
          if (mounted) {
            showAppSnackBar(context, SnackBar(content: Text('$e')));
          }
        } finally {
          if (mounted) {
            setState(() => _busy = false);
          }
        }
        return;
      }
    } else {
      final List<PickingLine> pickedLines = doc.lines
          .where(
            (PickingLine l) =>
                !l.isVipExpiryInformational && l.qtyPicked >= l.qtyRequired,
          )
          .toList();
      if (pickedLines.isNotEmpty) {
        final bool allOk = pickedLines.every(
          (PickingLine l) => _verifiedLineIds.contains(l.id),
        );
        if (!allOk) {
          showAppSnackBar(context,
            SnackBar(content: Text(StringLookup.t(loc, 'verifyAllPickedLines'))),
          );
          return;
        }
      }
    }

    if (!online && profile == PickerProfileParam.picker) {
      final OfflineDatabase? db = await ref.read(offlineDatabaseProvider.future);
      if (db != null) {
        await db.queueAdd(
          'q_${DateTime.now().millisecondsSinceEpoch}',
          'PICK_CLOSE_TASK',
          <String, Object?>{
            'taskId': widget.taskId,
            'ts': DateTime.now().millisecondsSinceEpoch,
          },
          'pending',
        );
      }
      if (mounted) {
        _navigateAfterComplete(profile, loc);
      }
      return;
    }

    setState(() => _busy = true);
    try {
      await ref.read(pickingRepositoryProvider).completePickDocument(widget.taskId);
      final SharedPreferences sp = await SharedPreferences.getInstance();
      await sp.remove(_verifiedKey(widget.taskId));
      if (mounted) {
        _navigateAfterComplete(profile, loc);
      }
    } on Exception catch (e) {
      if (mounted) {
        _rejectScanHaptic();
        showAppSnackBar(context, SnackBar(content: Text('$e')));
      }
    } finally {
      if (mounted) {
        setState(() => _busy = false);
      }
    }
  }

  Future<void> _openLineSheet(
    PickingDocument doc,
    _LineGroup group,
    PickerProfileParam profile, {
    String? presetScannedBarcode,
  }) async {
    final AppLocale loc = ref.read(appLocaleProvider);
    final bool online = ref.read(networkOnlineProvider).valueOrNull ?? true;
    final List<PickingLine> pickTargetHolder = <PickingLine>[_activePickMember(group)];

    if (pickTargetHolder[0].isVipExpiryInformational) {
      await showModalBottomSheet<void>(
        context: context,
        builder: (BuildContext ctx) => Padding(
          padding: EdgeInsets.only(bottom: sheetBottomPadding(context)),
          child: Padding(
            padding: const EdgeInsets.all(20),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: <Widget>[
                Text(
                  group.virtual.productName,
                  style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 17),
                ),
                const SizedBox(height: 8),
                Text(
                  _barcodeSkuSubtitle(group.virtual),
                  style: TextStyle(
                    fontSize: 13,
                    color: Theme.of(context).colorScheme.onSurfaceVariant,
                    fontFamily: 'monospace',
                  ),
                ),
                const SizedBox(height: 12),
                Text(
                  StringLookup.t(ref.read(appLocaleProvider), 'vipExpiryNotPickedDetail'),
                  style: TextStyle(color: Colors.red.shade800, fontSize: 14),
                ),
                const SizedBox(height: 20),
                FilledButton(
                  onPressed: () => Navigator.of(ctx).pop(),
                  child: Text(StringLookup.t(ref.read(appLocaleProvider), 'back')),
                ),
              ],
            ),
          ),
        ),
      );
      return;
    }

    final String? pickerPreset = presetScannedBarcode != null &&
            presetScannedBarcode.trim().isNotEmpty &&
            profile == PickerProfileParam.picker
        ? presetScannedBarcode.trim()
        : null;
    final double remPick =
        pickTargetHolder[0].qtyRequired - pickTargetHolder[0].qtyPicked;
    final String presetQtyText = pickerPreset != null
        ? (remPick >= 1 ? formatPickQty(remPick) : '0')
        : '';
    final TextEditingController bc = TextEditingController();
    final TextEditingController qty =
        TextEditingController(text: presetQtyText);
    String? scannedForQty = pickerPreset;
    bool sheetBusy = false;
    String? selectedLocationId;
    for (final PickingAlternateLocation a in pickTargetHolder[0].alternateLocations) {
      if (a.isPrimary) {
        selectedLocationId = a.locationId;
        break;
      }
    }
    if (selectedLocationId == null) {
      for (final PickingAlternateLocation a in pickTargetHolder[0].alternateLocations) {
        if (a.locationCode.trim().toLowerCase() ==
            pickTargetHolder[0].locationCode.trim().toLowerCase()) {
          selectedLocationId = a.locationId;
          break;
        }
      }
    }

    try {
      await showModalBottomSheet<void>(
        context: context,
        isScrollControlled: true,
        builder: (BuildContext ctx) {
          return StatefulBuilder(
            builder: (BuildContext context, void Function(void Function()) setM) {
              return Padding(
                padding: EdgeInsets.only(bottom: sheetBottomPadding(context)),
                child: SingleChildScrollView(
                  padding: const EdgeInsets.all(20),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.stretch,
                    mainAxisSize: MainAxisSize.min,
                    children: <Widget>[
                    Text(
                      group.virtual.productName,
                      style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 17),
                    ),
                    const SizedBox(height: 6),
                    Text(
                      _barcodeSkuSubtitle(group.virtual),
                      style: TextStyle(
                        fontSize: 13,
                        color: Theme.of(context).colorScheme.onSurfaceVariant,
                        fontFamily: 'monospace',
                      ),
                    ),
                    const SizedBox(height: 8),
                    Text(
                      _groupLocationQtyLine(group),
                      style: TextStyle(color: Theme.of(context).colorScheme.onSurfaceVariant),
                    ),
                    if (group.members.length > 1 &&
                        profile == PickerProfileParam.picker) ...<Widget>[
                      const SizedBox(height: 6),
                      Text(
                        StringLookup.t(loc, 'pickMultiLocationHint'),
                        style: TextStyle(
                          fontSize: 12,
                          color: Theme.of(context).colorScheme.onSurfaceVariant,
                        ),
                      ),
                    ],
                    if (pickTargetHolder[0].skipReason != null &&
                        pickTargetHolder[0].skipReason!.isNotEmpty) ...<Widget>[
                      const SizedBox(height: 8),
                      Text(
                        '${StringLookup.t(loc, 'incompleteReasonLabel')} ${pickTargetHolder[0].skipReason}',
                      ),
                    ],
                    if (profile == PickerProfileParam.controller) ...<Widget>[
                      const SizedBox(height: 16),
                      Row(
                        crossAxisAlignment: CrossAxisAlignment.end,
                        children: <Widget>[
                          Expanded(
                            child: TextField(
                              controller: bc,
                              decoration: InputDecoration(
                                labelText: StringLookup.t(loc, 'barcodeOrSku'),
                                border: const OutlineInputBorder(),
                                suffixIcon: buildInputClearButton(
                                  visible: bc.text.trim().isNotEmpty,
                                  onPressed: () => setM(() => bc.clear()),
                                ),
                              ),
                              onChanged: (_) => setM(() {}),
                              onSubmitted: (String v) {
                                final String t = v.trim();
                                final PickingLine? match = _findLineByScan(doc.lines, t);
                                if (match == null) {
                                  _rejectScanHaptic();
                                  showAppSnackBar(context,
                                    SnackBar(content: Text(StringLookup.t(loc, 'productNotInOrder'))),
                                  );
                                  return;
                                }
                                if (!group.members.any((PickingLine m) => m.id == match.id)) {
                                  _rejectScanHaptic();
                                  showAppSnackBar(context,
                                    SnackBar(content: Text(StringLookup.t(loc, 'wrongBarcodeTitle'))),
                                  );
                                  return;
                                }
                                if (_isControllerGroupFullyVerified(doc, match)) {
                                  _rejectScanHaptic();
                                  _showControllerAlreadyVerifiedSnackBar();
                                  return;
                                }
                                setM(() {
                                  scannedForQty = t;
                                  qty.text =
                                      formatPickQty(_aggregateQtyPicked(group.members));
                                });
                              },
                            ),
                          ),
                          const SizedBox(width: 8),
                          ScanActionButton(
                            onPressed: () {
                              Navigator.of(ctx).pop();
                              context.pushNamed(
                                'scanner',
                                extra: ScannerArgs(
                                  returnToPick: true,
                                  taskId: widget.taskId,
                                  lineId: profile == PickerProfileParam.controller &&
                                          group.members.length > 1
                                      ? null
                                      : pickTargetHolder[0].id,
                                  profileType: profile,
                                ),
                              );
                            },
                            label: StringLookup.t(loc, 'scanButton'),
                            compact: true,
                          ),
                        ],
                      ),
                      if (scannedForQty != null) ...<Widget>[
                        const SizedBox(height: 12),
                        TextField(
                          controller: qty,
                          keyboardType: kStockQtyKeyboardType,
                          inputFormatters: kStockQtyInputFormatters,
                          decoration: InputDecoration(
                            labelText: StringLookup.t(loc, 'qtyShort'),
                            border: const OutlineInputBorder(),
                            suffixIcon: buildInputClearButton(
                              visible: qty.text.trim().isNotEmpty,
                              onPressed: () => setM(() => qty.clear()),
                            ),
                          ),
                          onChanged: (_) => setM(() {}),
                        ),
                        const SizedBox(height: 16),
                        FilledButton(
                          onPressed: () async {
                            final PickingLine? physical =
                                _findLineByScan(doc.lines, scannedForQty!);
                            if (physical == null) {
                              return;
                            }
                            if (!group.members.any((PickingLine m) => m.id == physical.id)) {
                              return;
                            }
                            final double aggPickConfirm =
                                _aggregateQtyPicked(group.members);
                            if (_controllerQtyMismatch(qty.text, aggPickConfirm)) {
                              _rejectScanHaptic();
                              showAppSnackBar(context,
                                SnackBar(
                                  content: Text(
                                    '${StringLookup.t(loc, 'qtyMismatch')}: ${physical.productName}',
                                  ),
                                ),
                              );
                              return;
                            }
                            final Set<String> ids =
                                group.members.map((PickingLine l) => l.id).toSet();
                            setState(() {
                              _verifiedLineIds = {..._verifiedLineIds, ...ids};
                            });
                            await _saveVerified();
                            if (ctx.mounted) {
                              Navigator.of(ctx).pop();
                            }
                            _showControllerVerifiedSnackBar();
                          },
                          child: Text(StringLookup.t(loc, 'confirmButton')),
                        ),
                        if (online &&
                            (_findLineByScan(doc.lines, scannedForQty!)?.qtyPicked ?? 0) >
                                0) ...<Widget>[
                          const SizedBox(height: 8),
                          TextButton(
                            onPressed: () async {
                              final PickingLine? lineForUnpick =
                                  _findLineByScan(doc.lines, scannedForQty!);
                              if (lineForUnpick == null) {
                                return;
                              }
                              Navigator.of(ctx).pop();
                              await _showUnpickSheet(lineForUnpick);
                            },
                            child: Text(StringLookup.t(loc, 'unpickActionTitle')),
                          ),
                        ],
                      ],
                    ] else ...<Widget>[
                      const SizedBox(height: 16),
                      Row(
                        crossAxisAlignment: CrossAxisAlignment.end,
                        children: <Widget>[
                          Expanded(
                            child: TextField(
                              controller: bc,
                              decoration: InputDecoration(
                                labelText: StringLookup.t(loc, 'barcodeOrSku'),
                                border: const OutlineInputBorder(),
                                suffixIcon: buildInputClearButton(
                                  visible: bc.text.trim().isNotEmpty,
                                  onPressed: () => setM(() => bc.clear()),
                                ),
                              ),
                              onChanged: (_) => setM(() {}),
                              onSubmitted: (String v) {
                                PickingLine? matched;
                                for (final PickingLine m in group.members) {
                                  if (_barcodeMatchesLine(v, m)) {
                                    matched = m;
                                    break;
                                  }
                                }
                                if (matched != null) {
                                  setM(() {
                                    pickTargetHolder[0] = matched!;
                                    scannedForQty = v.trim();
                                    final double rem =
                                        pickTargetHolder[0].qtyRequired -
                                        pickTargetHolder[0].qtyPicked;
                                    qty.text =
                                        rem >= 1 ? formatPickQty(rem) : '0';
                                  });
                                } else {
                                  _rejectScanHaptic();
                                  showAppSnackBar(context,
                                    SnackBar(
                                      content: Text(
                                        '${StringLookup.t(loc, 'wrongBarcodeMessage')}${pickTargetHolder[0].barcode ?? pickTargetHolder[0].sku ?? '—'}',
                                      ),
                                    ),
                                  );
                                }
                              },
                            ),
                          ),
                          const SizedBox(width: 8),
                          ScanActionButton(
                            onPressed: () {
                              Navigator.of(ctx).pop();
                              context.pushNamed(
                                'scanner',
                                extra: ScannerArgs(
                                  returnToPick: true,
                                  taskId: widget.taskId,
                                  lineId: pickTargetHolder[0].id,
                                  profileType: profile,
                                ),
                              );
                            },
                            label: StringLookup.t(loc, 'scanButton'),
                            compact: true,
                          ),
                        ],
                      ),
                      if (scannedForQty != null) ...<Widget>[
                        const SizedBox(height: 12),
                        TextField(
                          controller: qty,
                          keyboardType: kStockQtyKeyboardType,
                          inputFormatters: kStockQtyInputFormatters,
                          decoration: InputDecoration(
                            labelText: StringLookup.t(loc, 'qtyShort'),
                            border: const OutlineInputBorder(),
                            suffixIcon: buildInputClearButton(
                              visible: qty.text.trim().isNotEmpty,
                              onPressed: () => setM(() => qty.clear()),
                            ),
                          ),
                          onChanged: (_) => setM(() {}),
                        ),
                        const SizedBox(height: 16),
                        FilledButton(
                          onPressed: sheetBusy
                              ? null
                              : () async {
                            final int delta = int.tryParse(qty.text.trim()) ?? 0;
                              final double rem = pickTargetHolder[0].qtyRequired -
                                  pickTargetHolder[0].qtyPicked;
                            if (delta < 1 || delta > rem) {
                              _rejectScanHaptic();
                              showAppSnackBar(context,
                                SnackBar(
                                  content: Text(
                                    StringLookup.tParams(
                                      loc,
                                      'qtyRangeError',
                                      <String, String>{'max': formatPickQty(rem)},
                                    ),
                                  ),
                                ),
                              );
                              return;
                            }
                            setM(() => sheetBusy = true);
                            try {
                              if (online) {
                                final PickLineResponse res =
                                    await ref.read(pickingRepositoryProvider).pickLine(
                                      pickTargetHolder[0].id,
                                      delta,
                                      'scan-${widget.taskId}-${pickTargetHolder[0].id}-${DateTime.now().millisecondsSinceEpoch}',
                                    );
                                await ref
                                    .read(pickTaskDetailProvider(widget.taskId).notifier)
                                    .applyPickLineResponse(widget.taskId, res);
                              } else {
                                final OfflineDatabase? db =
                                    await ref.read(offlineDatabaseProvider.future);
                                if (db != null) {
                                  await db.queueAdd(
                                    'q_${DateTime.now().millisecondsSinceEpoch}',
                                    'PICK_CONFIRM_ITEM',
                                    <String, Object?>{
                                      'taskId': widget.taskId,
                                      'itemId': pickTargetHolder[0].id,
                                      'qty': delta,
                                      'ts': DateTime.now().millisecondsSinceEpoch,
                                    },
                                    'pending',
                                  );
                                }
                              }
                              if (ctx.mounted) {
                                Navigator.of(ctx).pop();
                              }
                            } on Exception catch (e) {
                              if (mounted) {
                                _rejectScanHaptic();
                                showAppSnackBar(
                                  context,
                                  SnackBar(content: Text('$e')),
                                );
                              }
                            } finally {
                              setM(() => sheetBusy = false);
                            }
                          },
                          child: Text(StringLookup.t(loc, 'submit')),
                        ),
                        if (online) ...<Widget>[
                          const SizedBox(height: 8),
                          TextButton(
                            onPressed: () async {
                              Navigator.of(ctx).pop();
                              await _showSkipReasonSheet(pickTargetHolder[0]);
                            },
                            child: Text(StringLookup.t(loc, 'lineReasonModalTitle')),
                          ),
                          if (pickTargetHolder[0].qtyPicked > 0)
                            TextButton(
                              onPressed: () async {
                                Navigator.of(ctx).pop();
                                await _showUnpickSheet(pickTargetHolder[0]);
                              },
                              child: Text(StringLookup.t(loc, 'unpickActionTitle')),
                            ),
                        ],
                      ],
                      if (group.members.length == 1 &&
                          online &&
                          pickTargetHolder[0].alternateLocations.isNotEmpty) ...<Widget>[
                        const SizedBox(height: 16),
                        Text(
                          StringLookup.t(loc, 'alternateLocations'),
                          style: const TextStyle(fontWeight: FontWeight.w600),
                        ),
                        ...mergeAlternateLocationsForDisplay(
                          pickTargetHolder[0].alternateLocations,
                        ).map((
                          MergedAlternateLocationRow row,
                        ) {
                          final String rowLocationId = row.representative.locationId;
                          final bool isSelected = selectedLocationId == rowLocationId;
                          return ListTile(
                            dense: true,
                            shape: RoundedRectangleBorder(
                              borderRadius: BorderRadius.circular(10),
                            ),
                            tileColor: isSelected ? Colors.green.withValues(alpha: 0.12) : null,
                            title: Text(
                              row.menuLabel,
                              maxLines: 2,
                              overflow: TextOverflow.ellipsis,
                            ),
                            trailing: isSelected
                                ? const Icon(Icons.check_circle, color: Colors.green)
                                : null,
                            onTap: () async {
                              if (sheetBusy) {
                                return;
                              }
                              setM(() => sheetBusy = true);
                              try {
                                final PickingAlternateLocation a = row.representative;
                                final PickLineResponse res =
                                    await ref.read(pickingRepositoryProvider).changePickSource(
                                      pickTargetHolder[0].id,
                                      locationId: a.locationId,
                                      lotId: a.lotId,
                                    );
                                if (mounted) {
                                  showAppSnackBar(context,
                                    SnackBar(
                                      content: Text(StringLookup.t(loc, 'pickSwitchSourceDone')),
                                    ),
                                  );
                                }
                                await ref
                                    .read(pickTaskDetailProvider(widget.taskId).notifier)
                                    .applyPickLineResponse(widget.taskId, res);
                                setM(() => selectedLocationId = rowLocationId);
                              } on Exception catch (e) {
                                if (mounted) {
                                  _rejectScanHaptic();
                                  showAppSnackBar(
                                    context,
                                    SnackBar(content: Text('$e')),
                                  );
                                }
                              } finally {
                                setM(() => sheetBusy = false);
                              }
                            },
                          );
                        }),
                      ],
                    ],
                      TextButton(
                        onPressed: () => Navigator.of(ctx).pop(),
                        child: Text(StringLookup.t(loc, 'cancel')),
                      ),
                    ],
                  ),
                ),
              );
            },
          );
        },
      );
    } finally {
      bc.dispose();
      qty.dispose();
    }
  }

  Future<void> _showSkipReasonSheet(PickingLine line) async {
    final AppLocale loc = ref.read(appLocaleProvider);
    final bool online = ref.read(networkOnlineProvider).valueOrNull ?? true;
    if (!online) {
      showAppSnackBar(context,
        SnackBar(content: Text(StringLookup.t(loc, 'reportReasonOffline'))),
      );
      return;
    }
    await showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      builder: (BuildContext ctx) {
        String? sel;
        return StatefulBuilder(
          builder: (BuildContext context, void Function(void Function()) setM) {
            return Padding(
              padding: EdgeInsets.only(bottom: sheetBottomPadding(context)),
              child: _ReasonListSheet(
                loc: loc,
                title: StringLookup.t(loc, 'lineReasonModalTitle'),
                hint: StringLookup.t(loc, 'incompleteReasonSelect'),
                productName: line.productName,
                selected: sel,
                onSelect: (String? v) => setM(() => sel = v),
                onConfirm: () async {
                  final String? r = sel;
                  if (r == null) {
                    return;
                  }
                  try {
                    final PickLineResponse res =
                        await ref.read(pickingRepositoryProvider).skipLine(line.id, r);
                    await ref
                        .read(pickTaskDetailProvider(widget.taskId).notifier)
                        .applyPickLineResponse(widget.taskId, res);
                    if (ctx.mounted) {
                      Navigator.of(ctx).pop();
                    }
                  } on Exception catch (e) {
                    if (mounted) {
                      _rejectScanHaptic();
                      showAppSnackBar(context, SnackBar(content: Text('$e')));
                    }
                  }
                },
                onCancel: () => Navigator.of(ctx).pop(),
              ),
            );
          },
        );
      },
    );
  }

  Future<void> _showUnpickSheet(PickingLine line) async {
    final AppLocale loc = ref.read(appLocaleProvider);
    final bool online = ref.read(networkOnlineProvider).valueOrNull ?? true;
    if (!online) {
      showAppSnackBar(
        context,
        SnackBar(content: Text(StringLookup.t(loc, 'reportReasonOffline'))),
      );
      return;
    }
    final int maxQty = line.qtyPicked.floor();
    if (maxQty < 1) {
      return;
    }

    final TextEditingController qty = TextEditingController(text: '1');
    try {
      await showModalBottomSheet<void>(
        context: context,
        isScrollControlled: true,
        builder: (BuildContext ctx) {
          String? selectedReason;
          bool sheetBusy = false;
          return StatefulBuilder(
            builder: (BuildContext context, void Function(void Function()) setM) {
              return Padding(
                padding: EdgeInsets.only(bottom: sheetBottomPadding(context)),
                child: SingleChildScrollView(
                  padding: const EdgeInsets.all(16),
                  child: Column(
                    mainAxisSize: MainAxisSize.min,
                    crossAxisAlignment: CrossAxisAlignment.stretch,
                    children: <Widget>[
                      Text(
                        StringLookup.t(loc, 'unpickReasonTitle'),
                        style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 17),
                      ),
                      const SizedBox(height: 8),
                      Text(line.productName, maxLines: 2, overflow: TextOverflow.ellipsis),
                      const SizedBox(height: 12),
                      TextField(
                        controller: qty,
                        keyboardType: kStockQtyKeyboardType,
                        inputFormatters: kStockQtyInputFormatters,
                        decoration: InputDecoration(
                          labelText: StringLookup.t(loc, 'unpickQtyLabel'),
                          helperText: StringLookup.tParams(
                            loc,
                            'qtyRangeError',
                            <String, String>{'max': '$maxQty'},
                          ),
                          border: const OutlineInputBorder(),
                        ),
                        onChanged: (_) => setM(() {}),
                      ),
                      const SizedBox(height: 8),
                      SizedBox(
                        height: 220,
                        child: ListView(
                          children: kIncompleteReasonKeys.map((String key) {
                            return RadioListTile<String>(
                              title: Text(StringLookup.t(loc, 'reason_$key')),
                              value: key,
                              groupValue: selectedReason,
                              onChanged: (String? v) => setM(() => selectedReason = v),
                            );
                          }).toList(),
                        ),
                      ),
                      Row(
                        children: <Widget>[
                          Expanded(
                            child: OutlinedButton(
                              onPressed: sheetBusy ? null : () => Navigator.of(ctx).pop(),
                              child: Text(StringLookup.t(loc, 'cancel')),
                            ),
                          ),
                          const SizedBox(width: 12),
                          Expanded(
                            child: FilledButton(
                              onPressed: (sheetBusy || selectedReason == null)
                                  ? null
                                  : () async {
                                      final int delta = int.tryParse(qty.text.trim()) ?? 0;
                                      if (delta < 1 || delta > maxQty) {
                                        _rejectScanHaptic();
                                        showAppSnackBar(
                                          this.context,
                                          SnackBar(
                                            content: Text(
                                              StringLookup.tParams(
                                                loc,
                                                'qtyRangeError',
                                                <String, String>{'max': '$maxQty'},
                                              ),
                                            ),
                                          ),
                                        );
                                        return;
                                      }
                                      setM(() => sheetBusy = true);
                                      try {
                                        final PickLineResponse res = await ref
                                            .read(pickingRepositoryProvider)
                                            .unpickLine(
                                              line.id,
                                              delta: delta,
                                              reason: selectedReason!,
                                              requestId:
                                                  'unpick-${widget.taskId}-${line.id}-${DateTime.now().millisecondsSinceEpoch}',
                                            );
                                        await ref
                                            .read(pickTaskDetailProvider(widget.taskId).notifier)
                                            .applyPickLineResponse(widget.taskId, res);
                                        final PickingDocument? updated = ref
                                            .read(pickTaskDetailProvider(widget.taskId))
                                            .valueOrNull;
                                        if (updated != null) {
                                          await _clearVerifiedForGroup(updated, line);
                                        }
                                        if (ctx.mounted) {
                                          Navigator.of(ctx).pop();
                                        }
                                        if (mounted) {
                                          showAppSnackBar(
                                            this.context,
                                            SnackBar(
                                              content: Text(StringLookup.t(loc, 'unpickDone')),
                                            ),
                                          );
                                        }
                                      } on Exception catch (e) {
                                        if (mounted) {
                                          _rejectScanHaptic();
                                          showAppSnackBar(
                                            this.context,
                                            SnackBar(content: Text('$e')),
                                          );
                                        }
                                      } finally {
                                        setM(() => sheetBusy = false);
                                      }
                                    },
                              child: Text(StringLookup.t(loc, 'confirmButton')),
                            ),
                          ),
                        ],
                      ),
                    ],
                  ),
                ),
              );
            },
          );
        },
      );
    } finally {
      qty.dispose();
    }
  }

  @override
  Widget build(BuildContext context) {
    final AppLocale loc = ref.watch(appLocaleProvider);
    final bool isDark = ref.watch(appThemeModeProvider) == ThemeMode.dark;
    final String? profileQ = GoRouterState.of(context).uri.queryParameters['profile'];
    final PickerProfileParam profile = pickerProfileFromQuery(profileQ);

    ref.listen<PickTaskScanFromScanner?>(
      pendingPickTaskScanProvider,
      (PickTaskScanFromScanner? prev, PickTaskScanFromScanner? next) {
        if (next == null || next.taskId != widget.taskId) {
          return;
        }
        final PickTaskScanFromScanner snap = next;
        ref.read(pendingPickTaskScanProvider.notifier).state = null;
        WidgetsBinding.instance.addPostFrameCallback((_) {
          if (!mounted) {
            return;
          }
          unawaited(
            _runPickTaskRouteScanWorkflow(
              sb: snap.barcode,
              lineId: snap.lineId,
              profile: pickerProfileFromQuery(snap.profileQuery),
            ),
          );
        });
      },
    );
    final AsyncValue<PickingDocument> docAsync =
        ref.watch(pickTaskDetailProvider(widget.taskId));
    ref.listen<AsyncValue<PickingDocument>>(
      pickTaskDetailProvider(widget.taskId),
      (AsyncValue<PickingDocument>? prev, AsyncValue<PickingDocument> next) {
        next.whenData((PickingDocument d) {
          final String? sid = d.safeCancelReturnSessionId;
          if (d.orderWmsStatus == 'cancelling_in_progress' &&
              sid != null &&
              sid.isNotEmpty) {
            unawaited(
              ReturnSessionStorage.save(ref.read(sharedPreferencesProvider), sid),
            );
          }
        });
      },
    );
    final Color bg = isDark ? const Color(0xFF0F172A) : const Color(0xFFF5F5F5);

    return Scaffold(
      backgroundColor: bg,
      appBar: AppBar(
        title: Text(StringLookup.t(loc, 'positions')),
        leading: IconButton(
          icon: const Icon(Icons.arrow_back_rounded),
          onPressed: () {
            ref.read(pickTaskDetailProvider(widget.taskId)).when(
                  data: (PickingDocument d) {
                    if (d.status == 'completed') {
                      if (profile == PickerProfileParam.controller &&
                          Navigator.of(context).canPop()) {
                        context.pop();
                      } else {
                        context.goNamed(
                          _postCompleteRouteName(profile),
                          queryParameters: <String, String>{
                            'profile': profileToQuery(profile),
                          },
                        );
                      }
                    } else {
                      context.goNamed(
                        'pickTasks',
                        queryParameters: <String, String>{
                          'profile': profileToQuery(profile),
                        },
                      );
                    }
                  },
                  loading: () => context.goNamed(
                    'pickTasks',
                    queryParameters: <String, String>{'profile': profileToQuery(profile)},
                  ),
                  error: (_, __) => context.goNamed(
                    'pickTasks',
                    queryParameters: <String, String>{'profile': profileToQuery(profile)},
                  ),
                );
          },
        ),
      ),
      body: docAsync.when(
        data: (PickingDocument d) {
          final List<_LineGroup> groups = _groupLinesByProduct(d.lines);
          final List<_LineGroup> orderedGroups = profile == PickerProfileParam.controller
              ? _orderedLineGroupsController(groups, _verifiedLineIds)
              : _orderedLineGroups(groups);

          final String? sidRaw = d.safeCancelReturnSessionId;
          final bool cancelBlock = profile == PickerProfileParam.picker &&
              d.orderWmsStatus == 'cancelling_in_progress' &&
              (sidRaw ?? '').isNotEmpty;

          final Widget mainPick = Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: <Widget>[
              Padding(
                padding: const EdgeInsets.fromLTRB(16, 16, 16, 8),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: <Widget>[
                    Text(
                      _headerTitle(loc, d),
                      style: const TextStyle(fontSize: 20, fontWeight: FontWeight.w700),
                    ),
                    const SizedBox(height: 6),
                    Wrap(
                      spacing: 8,
                      runSpacing: 6,
                      crossAxisAlignment: WrapCrossAlignment.center,
                      children: <Widget>[
                        Chip(
                          label: Text(_statusLabel(loc, profile, d)),
                          visualDensity: VisualDensity.compact,
                        ),
                        Text(
                          '${StringLookup.t(loc, 'picked')}: ${formatPickQty(d.progress.picked)} / ${formatPickQty(d.progress.required)}',
                          style: TextStyle(
                            color: Theme.of(context).colorScheme.onSurfaceVariant,
                          ),
                        ),
                      ],
                    ),
                    if (profile == PickerProfileParam.controller &&
                        d.assignedToUserName != null) ...<Widget>[
                      const SizedBox(height: 4),
                      Text(
                        '${StringLookup.t(loc, 'pickerNameLabel')}: ${d.assignedToUserName}',
                        style: TextStyle(color: Theme.of(context).colorScheme.onSurfaceVariant),
                      ),
                    ],
                    if (profile == PickerProfileParam.controller &&
                        d.incompleteReason != null &&
                        d.incompleteReason!.isNotEmpty) ...<Widget>[
                      const SizedBox(height: 8),
                      Material(
                        color: Colors.amber.shade100,
                        borderRadius: BorderRadius.circular(10),
                        child: Padding(
                          padding: const EdgeInsets.all(10),
                          child: Text(
                            '${StringLookup.t(loc, 'incompleteReasonLabel')} ${StringLookup.t(loc, 'reason_${d.incompleteReason}')}',
                          ),
                        ),
                      ),
                    ],
                  ],
                ),
              ),
              Padding(
                padding: const EdgeInsets.symmetric(horizontal: 16),
                child: Row(
                  children: <Widget>[
                    Expanded(
                      child: TextField(
                        controller: _topScan,
                        decoration: InputDecoration(
                          labelText: StringLookup.t(loc, 'barcodeOrSku'),
                          border: OutlineInputBorder(borderRadius: BorderRadius.circular(12)),
                          filled: true,
                        ),
                        onSubmitted: (_) => _submitTopScan(),
                      ),
                    ),
                    const SizedBox(width: 8),
                    FilledButton(
                      onPressed: _busy ? null : _submitTopScan,
                      child: Text(StringLookup.t(loc, 'submit')),
                    ),
                  ],
                ),
              ),
              const SizedBox(height: 8),
              Expanded(
                child: ListView.separated(
                  padding: const EdgeInsets.fromLTRB(16, 0, 16, 100),
                  itemCount: orderedGroups.length,
                  separatorBuilder: (_, __) => const SizedBox(height: 8),
                  itemBuilder: (BuildContext context, int i) {
                    final _LineGroup g = orderedGroups[i];
                    final bool groupVerified = profile == PickerProfileParam.controller
                        ? g.members.every((PickingLine l) => _verifiedLineIds.contains(l.id))
                        : false;
                    final bool lineComplete = _lineGroupEffectivelyDone(g);
                    final bool useGreenCard = profile == PickerProfileParam.controller
                        ? groupVerified
                        : lineComplete;
                    final bool controllerIncomplete =
                        profile == PickerProfileParam.controller && !lineComplete;
                    final ColorScheme cs = Theme.of(context).colorScheme;
                    final bool isDark = Theme.of(context).brightness == Brightness.dark;
                    final Color cardBg = useGreenCard
                        ? Colors.green.withValues(alpha: isDark ? 0.20 : 0.14)
                        : controllerIncomplete
                            ? (isDark
                                ? Colors.red.withValues(alpha: 0.16)
                                : const Color(0xFFFFEBEE))
                            : cs.surfaceContainerHighest.withValues(alpha: 0.35);
                    final IconData leadingIcon;
                    final Color iconColor;
                    if (profile == PickerProfileParam.controller) {
                      if (groupVerified) {
                        leadingIcon = Icons.verified_rounded;
                        iconColor = Colors.green.shade700;
                      } else if (lineComplete) {
                        leadingIcon = Icons.check_circle_outline_rounded;
                        iconColor = cs.primary;
                      } else {
                        leadingIcon = Icons.inventory_2_rounded;
                        iconColor = cs.primary;
                      }
                    } else {
                      if (lineComplete) {
                        leadingIcon = Icons.check_circle_rounded;
                        iconColor = Colors.green.shade700;
                      } else {
                        leadingIcon = Icons.inventory_2_rounded;
                        iconColor = cs.primary;
                      }
                    }
                    return Material(
                      color: cardBg,
                      borderRadius: BorderRadius.circular(12),
                      child: InkWell(
                        borderRadius: BorderRadius.circular(12),
                        onTap: () => _openLineSheet(d, g, profile),
                        child: Padding(
                          padding: const EdgeInsets.all(14),
                          child: Row(
                            children: <Widget>[
                              Icon(
                                leadingIcon,
                                color: iconColor,
                              ),
                              const SizedBox(width: 12),
                              Expanded(
                                child: Column(
                                  crossAxisAlignment: CrossAxisAlignment.start,
                                  children: <Widget>[
                                    Wrap(
                                      spacing: 8,
                                      runSpacing: 4,
                                      crossAxisAlignment: WrapCrossAlignment.center,
                                      children: <Widget>[
                                        Text(
                                          g.virtual.productName,
                                          style: const TextStyle(
                                            fontWeight: FontWeight.w600,
                                            fontSize: 15,
                                          ),
                                        ),
                                        if (_lineSourceBadgeKey(g.virtual) != null)
                                          Chip(
                                            label: Text(
                                              StringLookup.t(
                                                loc,
                                                _lineSourceBadgeKey(g.virtual)!,
                                              ),
                                            ),
                                            visualDensity: VisualDensity.compact,
                                            padding: EdgeInsets.zero,
                                            materialTapTargetSize:
                                                MaterialTapTargetSize.shrinkWrap,
                                          ),
                                      ],
                                    ),
                                    const SizedBox(height: 4),
                                    Text(
                                      _barcodeSkuSubtitle(g.virtual),
                                      style: TextStyle(
                                        fontSize: 13,
                                        color: cs.onSurfaceVariant,
                                        fontFamily: 'monospace',
                                      ),
                                      maxLines: 2,
                                      overflow: TextOverflow.ellipsis,
                                    ),
                                    const SizedBox(height: 4),
                                    Text(
                                      _groupLocationQtyLine(g),
                                      style: TextStyle(
                                        fontSize: 13,
                                        color: cs.onSurfaceVariant,
                                      ),
                                      maxLines: 4,
                                      overflow: TextOverflow.ellipsis,
                                    ),
                                  ],
                                ),
                              ),
                              if (profile == PickerProfileParam.picker &&
                                  (ref.watch(networkOnlineProvider).valueOrNull ?? true) &&
                                  !_lineGroupEffectivelyDone(g))
                                IconButton(
                                  icon: const Icon(Icons.flag_rounded),
                                  tooltip: StringLookup.t(loc, 'lineReasonModalTitle'),
                                  onPressed: () =>
                                      _showSkipReasonSheet(_activePickMember(g)),
                                ),
                            ],
                          ),
                        ),
                      ),
                    );
                  },
                ),
              ),
            ],
          );
          if (!cancelBlock) {
            return mainPick;
          }
          final String sidReturn = sidRaw!;
          return Stack(
            fit: StackFit.expand,
            children: <Widget>[
              IgnorePointer(ignoring: true, child: mainPick),
              Positioned.fill(
                child: Material(
                  color: Colors.black54,
                  child: Center(
                    child: ConstrainedBox(
                      constraints: const BoxConstraints(maxWidth: 360),
                      child: Card(
                        child: Padding(
                          padding: const EdgeInsets.all(20),
                          child: Column(
                            mainAxisSize: MainAxisSize.min,
                            children: <Widget>[
                              Text(
                                'DIQQAT',
                                style: TextStyle(
                                  fontSize: 22,
                                  fontWeight: FontWeight.bold,
                                  color: Colors.red.shade800,
                                ),
                              ),
                              const SizedBox(height: 12),
                              const Text(
                                'Buyurtma bekor qilindi. Terish to\'xtatildi. Terilgan mahsulotlarni ko\'rsatilgan joyga qaytaring.',
                                textAlign: TextAlign.center,
                              ),
                              const SizedBox(height: 20),
                              FilledButton(
                                onPressed: () async {
                                  await ReturnSessionStorage.save(
                                    ref.read(sharedPreferencesProvider),
                                    sidReturn,
                                  );
                                  if (!context.mounted) {
                                    return;
                                  }
                                  context.go('/return-items/$sidReturn');
                                },
                                child: const Text('Qaytarish ekraniga o\'tish'),
                              ),
                            ],
                          ),
                        ),
                      ),
                    ),
                  ),
                ),
              ),
            ],
          );
        },
        loading: () => const Center(child: CircularProgressIndicator()),
        error: (_, __) => Center(child: Text(StringLookup.t(loc, 'notFound'))),
      ),
      bottomNavigationBar: docAsync.maybeWhen(
        data: (PickingDocument d) {
          if (profile == PickerProfileParam.picker &&
              d.orderWmsStatus == 'cancelling_in_progress' &&
              (d.safeCancelReturnSessionId ?? '').isNotEmpty) {
            return const SizedBox.shrink();
          }
          void onComplete() => _complete(d, profile);
          void onScan() {
            context.pushNamed(
              'scanner',
              extra: ScannerArgs(
                returnToPick: true,
                taskId: widget.taskId,
                profileType: profile,
              ),
            );
          }

          return SafeArea(
            child: Padding(
              padding: const EdgeInsets.fromLTRB(16, 0, 16, 12),
              child: profile == PickerProfileParam.controller
                  ? IntrinsicHeight(
                      child: Row(
                        crossAxisAlignment: CrossAxisAlignment.center,
                        children: <Widget>[
                          Expanded(
                            child: FilledButton(
                              onPressed: _busy ? null : onComplete,
                              child: Text(
                                _busy
                                    ? StringLookup.t(loc, 'submittingProgress')
                                    : StringLookup.t(loc, 'completePicking'),
                              ),
                            ),
                          ),
                          const SizedBox(width: 8),
                          Tooltip(
                            message: StringLookup.t(loc, 'scanButton'),
                            child: FilledButton.tonal(
                              onPressed: _busy ? null : onScan,
                              style: FilledButton.styleFrom(
                                padding: const EdgeInsets.symmetric(horizontal: 14),
                                minimumSize: const Size(48, 48),
                                fixedSize: const Size(48, 48),
                                tapTargetSize: MaterialTapTargetSize.shrinkWrap,
                              ),
                              child: Icon(
                                Icons.qr_code_scanner_rounded,
                                semanticLabel: StringLookup.t(loc, 'scanButton'),
                              ),
                            ),
                          ),
                        ],
                      ),
                    )
                  : FilledButton(
                      onPressed: _busy ? null : onComplete,
                      child: Text(
                        _busy
                            ? StringLookup.t(loc, 'submittingProgress')
                            : StringLookup.t(loc, 'completePicking'),
                      ),
                    ),
            ),
          );
        },
        orElse: () => const SizedBox.shrink(),
      ),
    );
  }
}

class _ReasonListSheet extends StatelessWidget {
  const _ReasonListSheet({
    required this.loc,
    required this.title,
    required this.hint,
    required this.selected,
    required this.onSelect,
    required this.onConfirm,
    required this.onCancel,
    this.productName,
  });

  final AppLocale loc;
  final String title;
  final String hint;
  final String? productName;
  final String? selected;
  final void Function(String?) onSelect;
  final VoidCallback onConfirm;
  final VoidCallback onCancel;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.all(16),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: <Widget>[
          Text(title, style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 17)),
          if (productName != null) ...<Widget>[
            const SizedBox(height: 6),
            Text(productName!, maxLines: 2, overflow: TextOverflow.ellipsis),
          ],
          const SizedBox(height: 8),
          Text(hint, style: TextStyle(color: Theme.of(context).colorScheme.onSurfaceVariant)),
          SizedBox(
            height: 260,
            child: ListView(
              children: kIncompleteReasonKeys.map((String key) {
                return RadioListTile<String>(
                  title: Text(StringLookup.t(loc, 'reason_$key')),
                  value: key,
                  groupValue: selected,
                  onChanged: onSelect,
                );
              }).toList(),
            ),
          ),
          Row(
            children: <Widget>[
              Expanded(child: OutlinedButton(onPressed: onCancel, child: Text(StringLookup.t(loc, 'cancel')))),
              const SizedBox(width: 12),
              Expanded(
                child: FilledButton(
                  onPressed: selected == null ? null : onConfirm,
                  child: Text(StringLookup.t(loc, 'confirmButton')),
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }
}

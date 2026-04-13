import 'dart:async' show unawaited;
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
import '../../../l10n/string_lookup.dart';
import '../../../shared/input/stock_quantity_input.dart';
import '../../../shared/layout/sheet_bottom_inset.dart';
import '../alternate_location_menu_label.dart' show mergeAlternateLocationsForDisplay, MergedAlternateLocationRow;
import '../data/picking_constants.dart';
import '../data/picking_models.dart';
import '../domain/profile_type_param.dart';
import '../picking_providers.dart';

class _LineGroup {
  const _LineGroup({required this.virtual, required this.members});

  final PickingLine virtual;
  final List<PickingLine> members;
}

/// `_groupLinesByProduct` bilan bir xil — aksiya + asosiy qatorlarni bir guruhda sanash.
String _lineGroupKey(PickingLine l) {
  if (l.productId != null && l.productId!.isNotEmpty) {
    return 'id:${l.productId}';
  }
  return '${l.productName}|${l.barcode ?? l.sku ?? ''}';
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
      .where((_LineGroup g) => g.virtual.qtyPicked < g.virtual.qtyRequired)
      .toList();
  final List<_LineGroup> complete = groups
      .where((_LineGroup g) => g.virtual.qtyPicked >= g.virtual.qtyRequired)
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
      .where((_LineGroup g) => g.virtual.qtyPicked < g.virtual.qtyRequired)
      .toList();
  final List<_LineGroup> pendingRest = pending
      .where((_LineGroup g) => g.virtual.qtyPicked >= g.virtual.qtyRequired)
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

  @override
  void initState() {
    super.initState();
    _loadVerified();
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
      ScaffoldMessenger.of(context).showSnackBar(
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
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('$e')));
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
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(StringLookup.t(loc, 'productNotInOrder'))),
      );
      return;
    }
    await _presentControllerVerifySheet(doc, line);
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
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(StringLookup.t(loc, 'notFound'))),
      );
      return;
    }
    if (!_barcodeMatchesLine(barcode, physical)) {
      _rejectScanHaptic();
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(
            '${StringLookup.t(loc, 'wrongBarcodeMessage')}'
            '${physical.barcode ?? physical.sku ?? '—'}',
          ),
        ),
      );
      return;
    }
    await _presentControllerVerifySheet(doc, physical);
  }

  /// RN `PickTaskDetails` `useFocusEffect`: skan + lineId → modal, `submitScan` yo‘q.
  Future<void> _handlePickerRouteScan(String barcode, String lineId) async {
    final PickingDocument doc = await _loadRouteScanDocument();
    if (!mounted) {
      return;
    }
    final AppLocale loc = ref.read(appLocaleProvider);
    PickingLine? line;
    for (final PickingLine l in doc.lines) {
      if (l.id == lineId) {
        line = l;
        break;
      }
    }
    if (line == null) {
      _rejectScanHaptic();
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(StringLookup.t(loc, 'notFound'))),
      );
      return;
    }
    if (!_barcodeMatchesLine(barcode, line)) {
      _rejectScanHaptic();
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(
            '${StringLookup.t(loc, 'wrongBarcodeMessage')}'
            '${line.barcode ?? line.sku ?? '—'}',
          ),
        ),
      );
      return;
    }
    await _openLineSheet(
      doc,
      _LineGroup(virtual: line, members: <PickingLine>[line]),
      PickerProfileParam.picker,
      presetScannedBarcode: barcode.trim(),
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
                        ScaffoldMessenger.of(hostContext).showSnackBar(
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
        ScaffoldMessenger.of(context).showSnackBar(
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
          ScaffoldMessenger.of(context).showSnackBar(
            SnackBar(content: Text(StringLookup.t(loc, 'productNotInOrder'))),
          );
          return;
        }
        _topScan.clear();
        await _presentControllerVerifySheet(doc, line);
      } on Exception catch (e) {
        if (mounted) {
          _rejectScanHaptic();
          ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('$e')));
        }
      } finally {
        if (mounted) {
          setState(() => _busy = false);
        }
      }
      return;
    }

    final bool online = ref.read(networkOnlineProvider).valueOrNull ?? true;
    final OfflineDatabase? db = await ref.read(offlineDatabaseProvider.future);
    setState(() => _busy = true);
    try {
      if (online) {
        final PickLineResponse res = await ref.read(pickingRepositoryProvider).submitScan(
              widget.taskId,
              barcode: code,
            );
        _topScan.clear();
        await ref
            .read(pickTaskDetailProvider(widget.taskId).notifier)
            .applyPickLineResponse(widget.taskId, res);
      } else if (db != null) {
        await db.queueAdd(
          'q_${DateTime.now().millisecondsSinceEpoch}',
          'PICK_SCAN',
          <String, Object?>{
            'taskId': widget.taskId,
            'barcode': code,
            'ts': DateTime.now().millisecondsSinceEpoch,
          },
          'pending',
        );
        _topScan.clear();
      }
    } on Exception catch (e) {
      if (mounted) {
        _rejectScanHaptic();
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('$e')));
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
      final List<PickingLine> incomplete =
          doc.lines.where((PickingLine l) => l.qtyPicked < l.qtyRequired).toList();
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
            context.goNamed(
              'pickerHome',
              queryParameters: <String, String>{
                'profile': profileToQuery(profile),
                'completedMessage': StringLookup.t(loc, 'taskCompletedBanner'),
              },
            );
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
            context.goNamed(
              'pickerHome',
              queryParameters: <String, String>{
                'profile': profileToQuery(profile),
                'completedMessage': StringLookup.t(loc, 'taskCompletedBanner'),
              },
            );
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
        return;
      }
    } else {
      final List<PickingLine> pickedLines =
          doc.lines.where((PickingLine l) => l.qtyPicked >= l.qtyRequired).toList();
      if (pickedLines.isNotEmpty) {
        final bool allOk = pickedLines.every(
          (PickingLine l) => _verifiedLineIds.contains(l.id),
        );
        if (!allOk) {
          ScaffoldMessenger.of(context).showSnackBar(
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
        context.goNamed(
          'pickerHome',
          queryParameters: <String, String>{
            'profile': profileToQuery(profile),
            'completedMessage': StringLookup.t(loc, 'taskCompletedBanner'),
          },
        );
      }
      return;
    }

    setState(() => _busy = true);
    try {
      await ref.read(pickingRepositoryProvider).completePickDocument(widget.taskId);
      final SharedPreferences sp = await SharedPreferences.getInstance();
      await sp.remove(_verifiedKey(widget.taskId));
      if (mounted) {
        context.goNamed(
          'pickerHome',
          queryParameters: <String, String>{
            'profile': profileToQuery(profile),
            'completedMessage': StringLookup.t(loc, 'taskCompletedBanner'),
          },
        );
      }
    } on Exception catch (e) {
      if (mounted) {
        _rejectScanHaptic();
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('$e')));
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
    final PickingLine stock = group.members.first;

    final String? pickerPreset = presetScannedBarcode != null &&
            presetScannedBarcode.trim().isNotEmpty &&
            profile == PickerProfileParam.picker
        ? presetScannedBarcode.trim()
        : null;
    final double remPick = stock.qtyRequired - stock.qtyPicked;
    final String presetQtyText = pickerPreset != null
        ? (remPick >= 1 ? formatPickQty(remPick) : '0')
        : '';

    await showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      builder: (BuildContext ctx) {
        final TextEditingController bc = TextEditingController();
        final TextEditingController qty =
            TextEditingController(text: presetQtyText);
        String? scannedForQty = pickerPreset;
        bool sheetBusy = false;
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
                      '${stock.locationCode} · ${formatPickQty(group.virtual.qtyPicked)}/${formatPickQty(group.virtual.qtyRequired)}',
                      style: TextStyle(color: Theme.of(context).colorScheme.onSurfaceVariant),
                    ),
                    if (stock.skipReason != null && stock.skipReason!.isNotEmpty) ...<Widget>[
                      const SizedBox(height: 8),
                      Text('${StringLookup.t(loc, 'incompleteReasonLabel')} ${stock.skipReason}'),
                    ],
                    const SizedBox(height: 16),
                    FilledButton.icon(
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
                                : stock.id,
                            profileType: profile,
                          ),
                        );
                      },
                      icon: const Icon(Icons.qr_code_scanner_rounded),
                      label: Text(StringLookup.t(loc, 'scanButton')),
                    ),
                    const SizedBox(height: 16),
                    if (profile == PickerProfileParam.controller) ...<Widget>[
                      TextField(
                        controller: bc,
                        decoration: InputDecoration(
                          labelText: StringLookup.t(loc, 'barcodeOrSku'),
                          border: const OutlineInputBorder(),
                        ),
                        onSubmitted: (String v) {
                          final String t = v.trim();
                          final PickingLine? match = _findLineByScan(doc.lines, t);
                          if (match == null) {
                            _rejectScanHaptic();
                            ScaffoldMessenger.of(context).showSnackBar(
                              SnackBar(content: Text(StringLookup.t(loc, 'productNotInOrder'))),
                            );
                            return;
                          }
                          if (!group.members.any((PickingLine m) => m.id == match.id)) {
                            _rejectScanHaptic();
                            ScaffoldMessenger.of(context).showSnackBar(
                              SnackBar(content: Text(StringLookup.t(loc, 'wrongBarcodeTitle'))),
                            );
                            return;
                          }
                          setM(() {
                            scannedForQty = t;
                            qty.text =
                                formatPickQty(_aggregateQtyPicked(group.members));
                          });
                        },
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
                          ),
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
                              ScaffoldMessenger.of(context).showSnackBar(
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
                      ],
                    ] else ...<Widget>[
                      TextField(
                        controller: bc,
                        decoration: InputDecoration(
                          labelText: StringLookup.t(loc, 'barcodeOrSku'),
                          border: const OutlineInputBorder(),
                        ),
                        onSubmitted: (String v) {
                          if (_barcodeMatchesLine(v, stock)) {
                            setM(() {
                              scannedForQty = v.trim();
                              final double rem = stock.qtyRequired - stock.qtyPicked;
                              qty.text = rem >= 1 ? formatPickQty(rem) : '0';
                            });
                          } else {
                            _rejectScanHaptic();
                            ScaffoldMessenger.of(context).showSnackBar(
                              SnackBar(
                                content: Text(
                                  '${StringLookup.t(loc, 'wrongBarcodeMessage')}${stock.barcode ?? stock.sku ?? '—'}',
                                ),
                              ),
                            );
                          }
                        },
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
                          ),
                        ),
                        const SizedBox(height: 16),
                        FilledButton(
                          onPressed: sheetBusy
                              ? null
                              : () async {
                            final int delta = int.tryParse(qty.text.trim()) ?? 0;
                              final double rem = stock.qtyRequired - stock.qtyPicked;
                            if (delta < 1 || delta > rem) {
                              _rejectScanHaptic();
                              ScaffoldMessenger.of(context).showSnackBar(
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
                                      stock.id,
                                      delta,
                                      'scan-${widget.taskId}-${stock.id}-${DateTime.now().millisecondsSinceEpoch}',
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
                                      'itemId': stock.id,
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
                                ScaffoldMessenger.of(context)
                                    .showSnackBar(SnackBar(content: Text('$e')));
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
                              await _showSkipReasonSheet(stock);
                            },
                            child: Text(StringLookup.t(loc, 'lineReasonModalTitle')),
                          ),
                        ],
                      ],
                      if (group.members.length == 1 &&
                          online &&
                          stock.alternateLocations.isNotEmpty) ...<Widget>[
                        const SizedBox(height: 16),
                        Text(
                          StringLookup.t(loc, 'alternateLocations'),
                          style: const TextStyle(fontWeight: FontWeight.w600),
                        ),
                        ...mergeAlternateLocationsForDisplay(stock.alternateLocations).map((
                          MergedAlternateLocationRow row,
                        ) {
                          return ListTile(
                            dense: true,
                            title: Text(
                              row.menuLabel,
                              maxLines: 2,
                              overflow: TextOverflow.ellipsis,
                            ),
                            onTap: () async {
                              try {
                                final PickingAlternateLocation a = row.representative;
                                final PickLineResponse res =
                                    await ref.read(pickingRepositoryProvider).changePickSource(
                                      stock.id,
                                      locationId: a.locationId,
                                      lotId: a.lotId,
                                    );
                                if (mounted) {
                                  ScaffoldMessenger.of(context).showSnackBar(
                                    SnackBar(
                                      content: Text(StringLookup.t(loc, 'pickSwitchSourceDone')),
                                    ),
                                  );
                                }
                                await ref
                                    .read(pickTaskDetailProvider(widget.taskId).notifier)
                                    .applyPickLineResponse(widget.taskId, res);
                                if (ctx.mounted) {
                                  Navigator.of(ctx).pop();
                                }
                              } on Exception catch (e) {
                                if (mounted) {
                                  _rejectScanHaptic();
                                  ScaffoldMessenger.of(context)
                                      .showSnackBar(SnackBar(content: Text('$e')));
                                }
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
  }

  Future<void> _showSkipReasonSheet(PickingLine line) async {
    final AppLocale loc = ref.read(appLocaleProvider);
    final bool online = ref.read(networkOnlineProvider).valueOrNull ?? true;
    if (!online) {
      ScaffoldMessenger.of(context).showSnackBar(
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
                      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('$e')));
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
                      context.goNamed(
                        'pickerHome',
                        queryParameters: <String, String>{
                          'profile': profileToQuery(profile),
                        },
                      );
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
          final List<_LineGroup> groups = profile == PickerProfileParam.controller
              ? _groupLinesByProduct(d.lines)
              : d.lines
                  .map((PickingLine l) => _LineGroup(virtual: l, members: <PickingLine>[l]))
                  .toList(growable: false);
          final List<_LineGroup> orderedGroups = profile == PickerProfileParam.controller
              ? _orderedLineGroupsController(groups, _verifiedLineIds)
              : _orderedLineGroups(groups);

          return Column(
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
                    final bool lineComplete =
                        g.virtual.qtyPicked >= g.virtual.qtyRequired;
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
                                    Text(
                                      g.virtual.productName,
                                      style: const TextStyle(
                                        fontWeight: FontWeight.w600,
                                        fontSize: 15,
                                      ),
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
                                      '${g.members.first.locationCode} · ${formatPickQty(g.virtual.qtyPicked)}/${formatPickQty(g.virtual.qtyRequired)}',
                                      style: TextStyle(
                                        fontSize: 13,
                                        color: cs.onSurfaceVariant,
                                      ),
                                    ),
                                  ],
                                ),
                              ),
                              if (profile == PickerProfileParam.picker &&
                                  (ref.watch(networkOnlineProvider).valueOrNull ?? true) &&
                                  g.members.length == 1)
                                IconButton(
                                  icon: const Icon(Icons.flag_rounded),
                                  tooltip: StringLookup.t(loc, 'lineReasonModalTitle'),
                                  onPressed: () => _showSkipReasonSheet(g.members.first),
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
        },
        loading: () => const Center(child: CircularProgressIndicator()),
        error: (_, __) => Center(child: Text(StringLookup.t(loc, 'notFound'))),
      ),
      bottomNavigationBar: docAsync.maybeWhen(
        data: (PickingDocument d) {
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

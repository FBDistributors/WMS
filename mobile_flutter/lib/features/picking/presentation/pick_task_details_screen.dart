import 'dart:async' show Timer, unawaited;
import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:shared_preferences/shared_preferences.dart';

import '../../../core/errors/api_error_localization.dart';
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
import '../../../shared/feedback/scan_reject_haptic.dart';
import '../../../shared/layout/sheet_bottom_inset.dart';
import '../../../shared/widgets/pick_box_qty_fields.dart';
import '../../../shared/widgets/pick_hybrid_submit.dart';
import '../../../shared/widgets/scan_action_button.dart';
import '../alternate_location_menu_label.dart' show mergeAlternateLocationsForDisplay, MergedAlternateLocationRow;
import '../data/picking_constants.dart';
import '../data/return_session_storage.dart';
import '../data/picking_models.dart';
import '../../scanner/data/scanner_repository.dart';
import '../../scanner/scanner_providers.dart';
import '../../product_boxes/product_box_providers.dart';
import '../domain/pick_line_list_logic.dart';
import '../domain/pick_scan_resolution.dart';
import '../domain/profile_type_param.dart';
import '../picking_providers.dart';

String? _lineSourceBadgeKey(PickingLine line) {
  final String src = (line.lineSource ?? 'product').trim();
  if (src == 'action') return 'lineSourceAction';
  if (src == 'gift') return 'lineSourceGift';
  return null;
}

double _aggregateQtyPicked(Iterable<PickingLine> lines) {
  return lines.fold<double>(0, (double s, PickingLine l) => s + l.qtyPicked);
}

double _aggregateQtyRequired(Iterable<PickingLine> lines) {
  return lines.fold<double>(0, (double s, PickingLine l) => s + l.qtyRequired);
}

String _barcodeSkuSubtitle(PickingLine l) => '${l.barcode ?? '—'} / ${l.sku ?? '—'}';

bool _controllerEnteredQtyMismatch(int entered, num qtyPicked) => entered != qtyPicked;

/// Quti/dona skan natijasiga qarab sheet miqdor maydonlarini to'ldirish.
({String mode, int? unitsPerBox}) _boxScanSheetPreset({
  required bool isBox,
  required int? upb,
  required double referenceQty,
  required TextEditingController qty,
  required TextEditingController boxCountCtrl,
}) {
  final String mode = isBox && (upb ?? 0) > 0 ? 'byBox' : 'byUnit';
  final int? units = mode == 'byBox' ? upb : null;
  boxCountCtrl.text = '1';
  if (mode == 'byBox' && upb != null) {
    qty.text = formatPickQty(referenceQty < upb ? referenceQty : upb.toDouble());
  } else {
    qty.text = formatPickQty(referenceQty);
  }
  return (mode: mode, unitsPerBox: units);
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

  void _navigateAfterComplete(PickerProfileParam profile) {
    unawaited(ref.read(openPickTasksProvider.notifier).refreshFromNetwork());
    context.goNamed(
      'pickTasks',
      queryParameters: <String, String>{
        'profile': profileToQuery(profile),
        'promptFeedback': '1',
        'feedbackContext': widget.taskId,
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

  Future<void> _markControllerVerificationStartedIfNeeded(bool firstVerify) async {
    if (!firstVerify) {
      return;
    }
    try {
      await ref
          .read(pickingRepositoryProvider)
          .markControllerVerificationStarted(widget.taskId);
    } on Object {
      /* offline yoki vaqtinchalik xato — mahalliy tekshiruv davom etadi */
    }
  }

  @override
  void dispose() {
    _detailPollTimer?.cancel();
    _topScan.dispose();
    super.dispose();
  }

  void _rejectScanHaptic() {
    triggerRejectScanHaptic();
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
    return isControllerPickGroupFullyVerified(doc.lines, anchor, _verifiedLineIds);
  }

  Future<void> _clearVerifiedForGroup(PickingDocument doc, PickingLine anchor) async {
    final Set<String> ids =
        membersOfSameCardAs(doc, anchor).map((PickingLine l) => l.id).toSet();
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
      _rejectScanHaptic();
      showAppSnackBar(
        context,
        SnackBar(
          behavior: SnackBarBehavior.floating,
          duration: const Duration(seconds: 3),
          content: Text(StringLookup.t(loc, 'controllerPositionAlreadyVerified')),
        ),
        type: AppToastType.error,
      );
    });
  }

  Future<void> _controllerVerifyAfterScan(
    PickingDocument doc,
    PickScanResolveResult resolved,
  ) async {
    if (_isControllerGroupFullyVerified(doc, resolved.line)) {
      _showControllerAlreadyVerifiedSnackBar();
      return;
    }
    await _presentControllerVerifySheet(
      doc,
      resolved.line,
      isBoxScan: resolved.isBoxScan,
      unitsPerBox: resolved.isBoxScan ? resolved.unitsPerScan : null,
    );
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
        showAppSnackBar(context, SnackBar(content: Text(localizeApiErrorMessage(ref.read(appLocaleProvider), e))));
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

  Future<void> _submitControllerSheetScan({
    required String raw,
    required PickingDocument doc,
    required PickLineGroup group,
    required void Function(void Function()) setM,
    required TextEditingController qty,
    required TextEditingController boxCountCtrl,
    required void Function(String scan, String? productId) onResolved,
    required void Function(String mode) setPickQtyMode,
    required void Function(int? upb) setUnitsPerBox,
  }) async {
    final String t = raw.trim();
    if (t.isEmpty) {
      return;
    }
    final AppLocale loc = ref.read(appLocaleProvider);
    final PickScanResolveResult? resolved = await _resolvePickScanForDocument(
      doc: doc,
      barcode: t,
      controller: true,
    );
    PickingLine? match;
    if (resolved != null) {
      for (final PickingLine m in group.members) {
        if (m.id == resolved.line.id) {
          match = m;
          break;
        }
      }
      match ??= resolved.line.productId != null &&
              resolved.line.productId!.trim().isNotEmpty
          ? resolveScanLineInGroupByProductId(
              group.members,
              resolved.line.productId!,
            )
          : null;
    } else {
      match = resolveScanLineInGroup(group.members, t);
    }
    if (match == null) {
      _rejectScanHaptic();
      if (mounted) {
        showAppSnackBar(context,
          SnackBar(content: Text(StringLookup.t(loc, 'productNotInOrder'))),
        );
      }
      return;
    }
    if (_isControllerGroupFullyVerified(doc, match)) {
      _showControllerAlreadyVerifiedSnackBar();
      return;
    }
    final String? pid = match.productId?.trim();
    final double aggPicked = _aggregateQtyPicked(group.members);
    final bool isBox = resolved?.isBoxScan ?? false;
    final int? upb = isBox ? resolved?.unitsPerScan : null;
    setM(() {
      onResolved(t, pid != null && pid.isNotEmpty ? pid : null);
      final ({String mode, int? unitsPerBox}) preset = _boxScanSheetPreset(
        isBox: isBox,
        upb: upb,
        referenceQty: aggPicked,
        qty: qty,
        boxCountCtrl: boxCountCtrl,
      );
      setPickQtyMode(preset.mode);
      setUnitsPerBox(preset.unitsPerBox);
    });
  }

  Future<PickScanResolveResult?> _resolvePickScanForDocument({
    required PickingDocument doc,
    required String barcode,
    required bool controller,
    String? preferredLineId,
  }) async {
    final String normalized = barcode.trim();
    if (normalized.isEmpty) {
      return null;
    }
    try {
      final ScannerResolveOut out =
          await ref.read(scannerRepositoryProvider).resolveBarcode(normalized);
      if (out.type == ScannerResolveType.product &&
          out.productId != null &&
          out.productId!.trim().isNotEmpty) {
        final bool isBox = out.isBoxScan;
        final int units = out.unitsPerScan ?? 1;
        PickingLine? line;
        if (preferredLineId != null && preferredLineId.isNotEmpty) {
          for (final PickingLine l in doc.lines) {
            if (l.id == preferredLineId) {
              line = l;
              break;
            }
          }
          if (line == null) {
            return null;
          }
          if (isBox) {
            if (!productIdMatchesPickLine(out.productId!, line)) {
              return null;
            }
          } else if (!barcodeMatchesPickLine(normalized, line)) {
            return null;
          }
        } else if (controller) {
          line = isBox
              ? resolveControllerScanLineByProductId(
                  doc.lines,
                  out.productId!,
                  _verifiedLineIds,
                )
              : resolveControllerScanLine(doc.lines, normalized, _verifiedLineIds);
        } else {
          line = isBox
              ? resolvePickerScanLineByProductId(doc.lines, out.productId!)
              : resolvePickerScanLine(doc.lines, normalized);
        }
        if (line == null) {
          return null;
        }
        return PickScanResolveResult(
          line: line,
          unitsPerScan: units,
          isBoxScan: isBox,
        );
      }
    } on Object {
      /* offline yoki resolve xato — mahalliy dona qidiruv */
    }
    final PickingLine? fallback = controller
        ? resolveControllerScanLine(doc.lines, normalized, _verifiedLineIds)
        : resolvePickerScanLine(doc.lines, normalized);
    if (fallback == null) {
      return null;
    }
    return PickScanResolveResult(line: fallback);
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
    final PickScanResolveResult? resolved = await _resolvePickScanForDocument(
      doc: doc,
      barcode: barcode,
      controller: true,
    );
    if (resolved == null) {
      _rejectScanHaptic();
      showAppSnackBar(context,
        SnackBar(content: Text(StringLookup.t(loc, 'productNotInOrder'))),
      );
      return;
    }
    await _controllerVerifyAfterScan(doc, resolved);
  }

  Future<void> _handleControllerRouteScan(String barcode, String lineId) async {
    final PickingDocument doc = await _loadRouteScanDocument();
    if (!mounted) {
      return;
    }
    final AppLocale loc = ref.read(appLocaleProvider);
    final PickScanResolveResult? resolved = await _resolvePickScanForDocument(
      doc: doc,
      barcode: barcode,
      controller: true,
      preferredLineId: lineId,
    );
    if (resolved == null) {
      _rejectScanHaptic();
      showAppSnackBar(context,
        SnackBar(
          content: Text(
            '${StringLookup.t(loc, 'wrongBarcodeMessage')}'
            '—',
          ),
        ),
      );
      return;
    }
    await _controllerVerifyAfterScan(doc, resolved);
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
    final PickScanResolveResult? resolved = await _resolvePickScanForDocument(
      doc: doc,
      barcode: normalized,
      controller: false,
      preferredLineId: preferredLineId,
    );

    if (resolved == null) {
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
    final PickingLine line = resolved.line;
    final double remaining = line.qtyRequired - line.qtyPicked;
    if (remaining <= 0) {
      _rejectScanHaptic();
      showAppSnackBar(context,
        SnackBar(content: Text(StringLookup.t(loc, 'consolidatedNothingToPick'))),
      );
      return;
    }
    final double presetQty = resolved.isBoxScan
        ? (remaining < resolved.unitsPerScan ? remaining : resolved.unitsPerScan.toDouble())
        : remaining;
    _topScan.clear();
    await _openLineSheet(
      doc,
      pickLineGroupFromSingle(line),
      PickerProfileParam.picker,
      presetScannedBarcode: normalized,
      presetPickQty: presetQty,
      presetIsBoxScan: resolved.isBoxScan,
      presetUnitsPerBox: resolved.isBoxScan ? resolved.unitsPerScan : null,
    );
  }

  Future<void> _presentControllerVerifySheet(
    PickingDocument doc,
    PickingLine physical, {
    bool isBoxScan = false,
    int? unitsPerBox,
  }) async {
    final AppLocale loc = ref.read(appLocaleProvider);
    final BuildContext hostContext = context;
    final List<PickingLine> groupLines = membersOfSameCardAs(doc, physical);
    final double aggPicked = _aggregateQtyPicked(groupLines);
    final double aggRequired = _aggregateQtyRequired(groupLines);
    final TextEditingController qty = TextEditingController();
    final TextEditingController boxCountCtrl = TextEditingController(text: '1');
    String pickQtyMode = isBoxScan ? 'byBox' : 'byUnit';
    int? upb = unitsPerBox;
    final ({String mode, int? unitsPerBox}) preset = _boxScanSheetPreset(
      isBox: isBoxScan,
      upb: unitsPerBox,
      referenceQty: aggPicked,
      qty: qty,
      boxCountCtrl: boxCountCtrl,
    );
    pickQtyMode = preset.mode;
    upb = preset.unitsPerBox;
    try {
      await showModalBottomSheet<void>(
        context: context,
        isScrollControlled: true,
        builder: (BuildContext ctx) {
          return StatefulBuilder(
            builder: (BuildContext context, void Function(void Function()) setM) {
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
                      PickBoxQtyFields(
                        loc: loc,
                        mode: pickQtyMode,
                        onModeChanged: (String m) => setM(() => pickQtyMode = m),
                        unitQty: qty,
                        boxCount: boxCountCtrl,
                        unitsPerBox: upb,
                        maxUnits: aggPicked,
                        onFieldsChanged: () => setM(() {}),
                      ),
                      const SizedBox(height: 16),
                      FilledButton(
                        onPressed: () async {
                          final int entered = pickQtyFromBoxMode(
                            mode: pickQtyMode,
                            unitQty: qty,
                            boxCount: boxCountCtrl,
                            unitsPerBox: upb,
                            maxUnits: aggPicked,
                          );
                          if (_controllerEnteredQtyMismatch(entered, aggPicked)) {
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
                          final bool firstVerify = _verifiedLineIds.isEmpty;
                          setState(() {
                            _verifiedLineIds = {..._verifiedLineIds, ...ids};
                          });
                          await _saveVerified();
                          await _markControllerVerificationStartedIfNeeded(firstVerify);
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
        },
      );
    } finally {
      qty.dispose();
      boxCountCtrl.dispose();
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
        final PickScanResolveResult? resolved = await _resolvePickScanForDocument(
          doc: doc,
          barcode: code,
          controller: true,
        );
        if (resolved == null) {
          _rejectScanHaptic();
          showAppSnackBar(context,
            SnackBar(content: Text(StringLookup.t(loc, 'productNotInOrder'))),
          );
          return;
        }
        _topScan.clear();
        await _controllerVerifyAfterScan(doc, resolved);
      } on Exception catch (e) {
        if (mounted) {
          _rejectScanHaptic();
          showAppSnackBar(context, SnackBar(content: Text(localizeApiErrorMessage(ref.read(appLocaleProvider), e))));
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
        showAppSnackBar(context, SnackBar(content: Text(localizeApiErrorMessage(ref.read(appLocaleProvider), e))));
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
          .where((PickingLine l) => !pickingLineEffectivelyDone(l))
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
            _navigateAfterComplete(profile);
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
            _navigateAfterComplete(profile);
          }
        } on Exception catch (e) {
          if (mounted) {
            showAppSnackBar(context, SnackBar(content: Text(localizeApiErrorMessage(ref.read(appLocaleProvider), e))));
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
        _navigateAfterComplete(profile);
      }
      return;
    }

    setState(() => _busy = true);
    try {
      await ref.read(pickingRepositoryProvider).completePickDocument(widget.taskId);
      final SharedPreferences sp = await SharedPreferences.getInstance();
      await sp.remove(_verifiedKey(widget.taskId));
      if (mounted) {
        _navigateAfterComplete(profile);
      }
    } on Exception catch (e) {
      if (mounted) {
        _rejectScanHaptic();
        showAppSnackBar(context, SnackBar(content: Text(localizeApiErrorMessage(ref.read(appLocaleProvider), e))));
      }
    } finally {
      if (mounted) {
        setState(() => _busy = false);
      }
    }
  }

  Future<void> _openLineSheet(
    PickingDocument doc,
    PickLineGroup group,
    PickerProfileParam profile, {
    String? presetScannedBarcode,
    double? presetPickQty,
    bool presetIsBoxScan = false,
    int? presetUnitsPerBox,
  }) async {
    final AppLocale loc = ref.read(appLocaleProvider);
    final bool online = ref.read(networkOnlineProvider).valueOrNull ?? true;
    final List<PickingLine> pickTargetHolder = <PickingLine>[activePickMember(group)];

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
        ? formatPickQty(
            presetPickQty != null
                ? (presetPickQty <= remPick ? presetPickQty : remPick)
                : (remPick >= 1 ? remPick : 0),
          )
        : '';
    final TextEditingController bc = TextEditingController();
    final TextEditingController qty =
        TextEditingController(text: presetQtyText);
    final TextEditingController boxCountCtrl = TextEditingController(text: '1');
    String? scannedForQty = pickerPreset;
    String? scannedResolveProductId;
    String pickQtyMode = presetIsBoxScan ? 'byBox' : 'byUnit';
    int? unitsPerBox = presetUnitsPerBox;
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
    final bool isPickerProfile = profile == PickerProfileParam.picker;
    int? hybridUnitsPerBox = hybridUnitsPerBoxHint(
      unitsPerBox: presetUnitsPerBox,
      alternates: pickTargetHolder[0].alternateLocations,
    );
    final ({int? looseUnits, int? boxCount}) primaryAltHint =
        primaryAlternateBoxHint(pickTargetHolder[0].alternateLocations);
    final TextEditingController hybridBoxCount = TextEditingController();
    final TextEditingController hybridLooseQty = TextEditingController();
    final TextEditingController hybridBoxBarcode = TextEditingController();
    final TextEditingController hybridProductBarcode = TextEditingController();
    if (isPickerProfile) {
      applyHybridQtyDefaults(
        boxCount: hybridBoxCount,
        looseQty: hybridLooseQty,
        unitsPerBox: hybridUnitsPerBox,
        maxUnits: remPick,
      );
      if (pickerPreset != null) {
        if (presetIsBoxScan && presetUnitsPerBox != null) {
          hybridUnitsPerBox = presetUnitsPerBox;
          final HybridScanApplyResult scanRes = await applyHybridBoxScan(
            scanner: ref.read(scannerRepositoryProvider),
            raw: pickerPreset,
            boxCount: hybridBoxCount,
            looseQty: hybridLooseQty,
            boxBarcode: hybridBoxBarcode,
            unitsPerBox: hybridUnitsPerBox,
            maxUnits: remPick,
          );
          hybridUnitsPerBox = scanRes.unitsPerBox ?? hybridUnitsPerBox;
        } else {
          final HybridScanApplyResult scanRes = await applyHybridProductScan(
            scanner: ref.read(scannerRepositoryProvider),
            raw: pickerPreset,
            boxCount: hybridBoxCount,
            looseQty: hybridLooseQty,
            boxBarcode: hybridBoxBarcode,
            productBarcode: hybridProductBarcode,
            unitsPerBox: hybridUnitsPerBox,
            maxUnits: remPick,
          );
          hybridUnitsPerBox = scanRes.unitsPerBox ?? hybridUnitsPerBox;
        }
      }
      if (hybridUnitsPerBox == null || hybridUnitsPerBox < 1) {
        final String? productId = pickTargetHolder[0].productId;
        if (productId != null && productId.trim().isNotEmpty) {
          final ({int? unitsPerBox, String? boxBarcode}) boxHint =
              await loadHybridProductBoxHint(
            ref.read(productBoxRepositoryProvider),
            productId,
          );
          if (boxHint.unitsPerBox != null && boxHint.unitsPerBox! >= 1) {
            hybridUnitsPerBox = boxHint.unitsPerBox;
            if ((boxHint.boxBarcode ?? '').trim().isNotEmpty &&
                hybridBoxBarcode.text.trim().isEmpty) {
              hybridBoxBarcode.text = boxHint.boxBarcode!.trim();
            }
            applyHybridQtyDefaults(
              boxCount: hybridBoxCount,
              looseQty: hybridLooseQty,
              unitsPerBox: hybridUnitsPerBox,
              maxUnits: remPick,
            );
          }
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
                      profile == PickerProfileParam.picker
                          ? (pickTargetHolder[0].isVipExpiryInformational
                              ? StringLookup.t(loc, 'vipExpiryNotPickedDetail')
                              : pickerLocationQtyLine(pickTargetHolder[0]))
                          : groupLocationQtyLine(group),
                      style: TextStyle(color: Theme.of(context).colorScheme.onSurfaceVariant),
                    ),
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
                                unawaited(_submitControllerSheetScan(
                                  raw: v,
                                  doc: doc,
                                  group: group,
                                  setM: setM,
                                  qty: qty,
                                  boxCountCtrl: boxCountCtrl,
                                  onResolved: (String scan, String? productId) {
                                    scannedForQty = scan;
                                    scannedResolveProductId = productId;
                                  },
                                  setPickQtyMode: (String m) => pickQtyMode = m,
                                  setUnitsPerBox: (int? u) => unitsPerBox = u,
                                ));
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
                        PickBoxQtyFields(
                          loc: loc,
                          mode: pickQtyMode,
                          onModeChanged: (String m) => setM(() => pickQtyMode = m),
                          unitQty: qty,
                          boxCount: boxCountCtrl,
                          unitsPerBox: unitsPerBox,
                          maxUnits: _aggregateQtyPicked(group.members),
                          onFieldsChanged: () => setM(() {}),
                        ),
                        const SizedBox(height: 16),
                        FilledButton(
                          onPressed: () async {
                            final PickingLine? physical = scannedResolveProductId != null &&
                                    scannedResolveProductId!.trim().isNotEmpty
                                ? resolveScanLineInGroupByProductId(
                                    group.members,
                                    scannedResolveProductId!,
                                  )
                                : resolveScanLineInGroup(group.members, scannedForQty!);
                            if (physical == null) {
                              return;
                            }
                            final double aggPickConfirm =
                                _aggregateQtyPicked(group.members);
                            final int entered = pickQtyFromBoxMode(
                              mode: pickQtyMode,
                              unitQty: qty,
                              boxCount: boxCountCtrl,
                              unitsPerBox: unitsPerBox,
                              maxUnits: aggPickConfirm,
                            );
                            if (_controllerEnteredQtyMismatch(entered, aggPickConfirm)) {
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
                            final bool firstVerify = _verifiedLineIds.isEmpty;
                            setState(() {
                              _verifiedLineIds = {..._verifiedLineIds, ...ids};
                            });
                            await _saveVerified();
                            await _markControllerVerificationStartedIfNeeded(firstVerify);
                            if (ctx.mounted) {
                              Navigator.of(ctx).pop();
                            }
                            _showControllerVerifiedSnackBar();
                          },
                          child: Text(StringLookup.t(loc, 'confirmButton')),
                        ),
                        if (online &&
                            (resolveScanLineInGroup(group.members, scannedForQty!)?.qtyPicked ??
                                    0) >
                                0) ...<Widget>[
                          const SizedBox(height: 8),
                          TextButton(
                            onPressed: () async {
                              final PickingLine? lineForUnpick =
                                  resolveScanLineInGroup(group.members, scannedForQty!);
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
                      Text(
                        StringLookup.tParams(
                          loc,
                          'quantityRemainingLine',
                          <String, String>{
                            'n': formatPickQty(
                              pickTargetHolder[0].qtyRequired -
                                  pickTargetHolder[0].qtyPicked,
                            ),
                          },
                        ),
                        style: TextStyle(
                          fontSize: 14,
                          color: Theme.of(context).colorScheme.onSurfaceVariant,
                        ),
                      ),
                      const SizedBox(height: 12),
                      PickHybridQtyFields(
                        loc: loc,
                        boxCount: hybridBoxCount,
                        looseQty: hybridLooseQty,
                        unitsPerBox: hybridUnitsPerBox,
                        maxUnits: pickTargetHolder[0].qtyRequired -
                            pickTargetHolder[0].qtyPicked,
                        looseUnits: primaryAltHint.looseUnits,
                        stockBoxCount: primaryAltHint.boxCount,
                        onFieldsChanged: () => setM(() {}),
                        boxBarcode: hybridBoxBarcode,
                        productBarcode: hybridProductBarcode,
                        busy: sheetBusy,
                        onBoxBarcodeChanged: () => setM(() {
                          if (hybridBoxBarcode.text.trim().isEmpty) {
                            hybridUnitsPerBox = unitsPerBoxFromAlternateLocations(
                              pickTargetHolder[0].alternateLocations,
                            );
                            hybridBoxCount.text = '0';
                          }
                        }),
                        onProductBarcodeChanged: () => setM(() {}),
                        onBoxBarcodeSubmitted: (String code) async {
                          final HybridScanApplyResult result = await applyHybridBoxScan(
                            scanner: ref.read(scannerRepositoryProvider),
                            raw: code,
                            boxCount: hybridBoxCount,
                            looseQty: hybridLooseQty,
                            boxBarcode: hybridBoxBarcode,
                            unitsPerBox: hybridUnitsPerBox,
                            maxUnits: pickTargetHolder[0].qtyRequired -
                                pickTargetHolder[0].qtyPicked,
                          );
                          setM(() {
                            if (result.unitsPerBox != null) {
                              hybridUnitsPerBox = result.unitsPerBox;
                            }
                          });
                        },
                        onProductBarcodeSubmitted: (String code) async {
                          final HybridScanApplyResult result =
                              await applyHybridProductScan(
                            scanner: ref.read(scannerRepositoryProvider),
                            raw: code,
                            boxCount: hybridBoxCount,
                            looseQty: hybridLooseQty,
                            boxBarcode: hybridBoxBarcode,
                            productBarcode: hybridProductBarcode,
                            unitsPerBox: hybridUnitsPerBox,
                            maxUnits: pickTargetHolder[0].qtyRequired -
                                pickTargetHolder[0].qtyPicked,
                          );
                          setM(() {
                            if (result.unitsPerBox != null) {
                              hybridUnitsPerBox = result.unitsPerBox;
                            }
                          });
                        },
                        onScanBox: () {
                          unawaited(() async {
                            final String? code = await launchHybridRawBarcodeScan(context);
                            if (code == null) {
                              return;
                            }
                            final HybridScanApplyResult result = await applyHybridBoxScan(
                              scanner: ref.read(scannerRepositoryProvider),
                              raw: code,
                              boxCount: hybridBoxCount,
                              looseQty: hybridLooseQty,
                              boxBarcode: hybridBoxBarcode,
                              unitsPerBox: hybridUnitsPerBox,
                              maxUnits: pickTargetHolder[0].qtyRequired -
                                  pickTargetHolder[0].qtyPicked,
                            );
                            setM(() {
                              if (result.unitsPerBox != null) {
                                hybridUnitsPerBox = result.unitsPerBox;
                              }
                            });
                          }());
                        },
                        onScanProduct: () {
                          unawaited(() async {
                            final String? code = await launchHybridRawBarcodeScan(context);
                            if (code == null) {
                              return;
                            }
                            final HybridScanApplyResult result =
                                await applyHybridProductScan(
                              scanner: ref.read(scannerRepositoryProvider),
                              raw: code,
                              boxCount: hybridBoxCount,
                              looseQty: hybridLooseQty,
                              boxBarcode: hybridBoxBarcode,
                              productBarcode: hybridProductBarcode,
                              unitsPerBox: hybridUnitsPerBox,
                              maxUnits: pickTargetHolder[0].qtyRequired -
                                  pickTargetHolder[0].qtyPicked,
                            );
                            setM(() {
                              if (result.unitsPerBox != null) {
                                hybridUnitsPerBox = result.unitsPerBox;
                              }
                            });
                          }());
                        },
                      ),
                      const SizedBox(height: 16),
                      FilledButton(
                        onPressed: sheetBusy
                            ? null
                            : () async {
                            final double rem = pickTargetHolder[0].qtyRequired -
                                pickTargetHolder[0].qtyPicked;
                            if ((hybridUnitsPerBox == null || hybridUnitsPerBox! < 1) &&
                                pickTargetHolder[0].productId != null) {
                              final ({int? unitsPerBox, String? boxBarcode}) boxHint =
                                  await loadHybridProductBoxHint(
                                ref.read(productBoxRepositoryProvider),
                                pickTargetHolder[0].productId,
                              );
                              if (boxHint.unitsPerBox != null &&
                                  boxHint.unitsPerBox! >= 1) {
                                hybridUnitsPerBox = boxHint.unitsPerBox;
                                if (hybridBoxBarcode.text.trim().isEmpty &&
                                    (boxHint.boxBarcode ?? '').trim().isNotEmpty) {
                                  hybridBoxBarcode.text = boxHint.boxBarcode!.trim();
                                }
                                applyHybridQtyDefaults(
                                  boxCount: hybridBoxCount,
                                  looseQty: hybridLooseQty,
                                  unitsPerBox: hybridUnitsPerBox,
                                  maxUnits: rem,
                                );
                              }
                            }
                            if (hybridProductBarcode.text.trim().isNotEmpty) {
                              final HybridBoxScanResult productRes =
                                  await resolveHybridProductBarcode(
                                ref.read(scannerRepositoryProvider),
                                hybridProductBarcode.text,
                              );
                              if (productRes.unitsPerBox != null &&
                                  productRes.unitsPerBox! >= 1) {
                                hybridUnitsPerBox = productRes.unitsPerBox;
                                applyHybridQtyDefaults(
                                  boxCount: hybridBoxCount,
                                  looseQty: hybridLooseQty,
                                  unitsPerBox: hybridUnitsPerBox,
                                  maxUnits: rem,
                                );
                              }
                            }
                            PickHybridQty hybrid = pickHybridQtyFromControllers(
                              boxCount: hybridBoxCount,
                              looseQty: hybridLooseQty,
                              unitsPerBox: hybridUnitsPerBox,
                              maxUnits: rem,
                            );
                            final String? boxOnlyValidation =
                                hybridBoxOnlyStockValidationMessage(
                              loc: loc,
                              hybrid: hybrid,
                              primaryLooseUnits: primaryAltHint.looseUnits,
                              primaryBoxCount: primaryAltHint.boxCount,
                            );
                            if (boxOnlyValidation != null) {
                              _rejectScanHaptic();
                              showAppSnackBar(
                                context,
                                SnackBar(content: Text(boxOnlyValidation)),
                              );
                              return;
                            }
                            final String? validation = hybridPickValidationMessage(
                              loc: loc,
                              hybrid: hybrid,
                              boxBarcode: hybridBoxBarcode.text,
                              productBarcode: hybridProductBarcode.text,
                              maxUnits: rem,
                            );
                            if (validation != null) {
                              _rejectScanHaptic();
                              showAppSnackBar(
                                context,
                                SnackBar(content: Text(validation)),
                              );
                              return;
                            }
                            setM(() => sheetBusy = true);
                            try {
                              if (online) {
                                await submitHybridPick(
                                  hybrid: hybrid,
                                  boxBarcode: hybridBoxBarcode.text,
                                  productBarcode: hybridProductBarcode.text,
                                  pickBox: ({
                                    required int qty,
                                    required int boxCount,
                                    required String barcode,
                                  }) async {
                                    final PickLineResponse res =
                                        await ref.read(pickingRepositoryProvider).pickLine(
                                              pickTargetHolder[0].id,
                                              qty,
                                              'scan-${widget.taskId}-${pickTargetHolder[0].id}-${DateTime.now().millisecondsSinceEpoch}',
                                              barcode: barcode,
                                              boxCount: boxCount,
                                            );
                                    await ref
                                        .read(pickTaskDetailProvider(widget.taskId).notifier)
                                        .applyPickLineResponse(widget.taskId, res);
                                  },
                                  pickUnit: ({
                                    required int qty,
                                    required String barcode,
                                  }) async {
                                    final PickLineResponse res =
                                        await ref.read(pickingRepositoryProvider).pickLine(
                                              pickTargetHolder[0].id,
                                              qty,
                                              'scan-${widget.taskId}-${pickTargetHolder[0].id}-${DateTime.now().millisecondsSinceEpoch}',
                                              barcode: barcode,
                                            );
                                    await ref
                                        .read(pickTaskDetailProvider(widget.taskId).notifier)
                                        .applyPickLineResponse(widget.taskId, res);
                                  },
                                  pickCombined: ({
                                    required int totalQty,
                                    required int boxCount,
                                    required String productBarcode,
                                    required String boxBarcode,
                                  }) async {
                                    final PickLineResponse res =
                                        await ref.read(pickingRepositoryProvider).pickLine(
                                              pickTargetHolder[0].id,
                                              totalQty,
                                              'scan-${widget.taskId}-${pickTargetHolder[0].id}-${DateTime.now().millisecondsSinceEpoch}',
                                              barcode: productBarcode,
                                              boxCount: boxCount,
                                              boxBarcode: boxBarcode,
                                            );
                                    await ref
                                        .read(pickTaskDetailProvider(widget.taskId).notifier)
                                        .applyPickLineResponse(widget.taskId, res);
                                  },
                                );
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
                                      'qty': hybrid.total,
                                      if (hybrid.boxCount > 0) 'box_count': hybrid.boxCount,
                                      if (hybrid.boxCount > 0 &&
                                          hybridBoxBarcode.text.trim().isNotEmpty)
                                        'box_barcode': hybridBoxBarcode.text.trim(),
                                      if (hybrid.looseUnits > 0 &&
                                          hybridProductBarcode.text.trim().isNotEmpty)
                                        'product_barcode': hybridProductBarcode.text.trim(),
                                      'ts': DateTime.now().millisecondsSinceEpoch,
                                    },
                                    'pending',
                                  );
                                }
                              }
                              if (ctx.mounted) {
                                Navigator.of(ctx).pop();
                              }
                            } on HybridPickPartialFailure catch (e) {
                              if (mounted) {
                                _rejectScanHaptic();
                                showAppSnackBar(
                                  context,
                                  SnackBar(
                                    content: Text(
                                      StringLookup.tParams(
                                        loc,
                                        'pickHybridPartialProgress',
                                        <String, String>{
                                          'picked': '${e.boxUnitsPicked}',
                                          'total': '${hybrid.total}',
                                        },
                                      ),
                                    ),
                                  ),
                                );
                              }
                              ref.invalidate(pickTaskDetailProvider(widget.taskId));
                            } on Exception catch (e) {
                              if (mounted) {
                                _rejectScanHaptic();
                                showAppSnackBar(
                                  context,
                                  SnackBar(content: Text(localizeApiErrorMessage(ref.read(appLocaleProvider), e))),
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
                                    SnackBar(content: Text(localizeApiErrorMessage(ref.read(appLocaleProvider), e))),
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
      boxCountCtrl.dispose();
      hybridBoxCount.dispose();
      hybridLooseQty.dispose();
      hybridBoxBarcode.dispose();
      hybridProductBarcode.dispose();
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
                      showAppSnackBar(context, SnackBar(content: Text(localizeApiErrorMessage(ref.read(appLocaleProvider), e))));
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
                                            SnackBar(content: Text(localizeApiErrorMessage(ref.read(appLocaleProvider), e))),
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
                      context.goNamed(
                        'pickTasks',
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
          final bool isPickerList = profile == PickerProfileParam.picker;
          final List<PickLineGroup> groups = groupLinesByProduct(d.lines);
          final List<PickLineGroup> orderedGroups = isPickerList
              ? const <PickLineGroup>[]
              : orderedLineGroupsController(groups, _verifiedLineIds);
          final List<PickingLine> orderedPickerLinesList =
              isPickerList ? orderedPickerLines(d.lines) : const <PickingLine>[];
          final int listItemCount =
              isPickerList ? orderedPickerLinesList.length : orderedGroups.length;

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
                  itemCount: listItemCount,
                  separatorBuilder: (_, __) => const SizedBox(height: 8),
                  itemBuilder: (BuildContext context, int i) {
                    final ColorScheme cs = Theme.of(context).colorScheme;
                    final bool isDark = Theme.of(context).brightness == Brightness.dark;

                    if (isPickerList) {
                      final PickingLine line = orderedPickerLinesList[i];
                      final bool lineComplete = pickingLineEffectivelyDone(line);
                      final Color cardBg = lineComplete
                          ? Colors.green.withValues(alpha: isDark ? 0.20 : 0.14)
                          : cs.surfaceContainerHighest.withValues(alpha: 0.35);
                      final IconData leadingIcon = lineComplete
                          ? Icons.check_circle_rounded
                          : Icons.inventory_2_rounded;
                      final Color iconColor = lineComplete
                          ? Colors.green.shade700
                          : cs.primary;
                      return Material(
                        color: cardBg,
                        borderRadius: BorderRadius.circular(12),
                        child: InkWell(
                          borderRadius: BorderRadius.circular(12),
                          onTap: () => _openLineSheet(
                            d,
                            pickLineGroupFromSingle(line),
                            profile,
                          ),
                          child: Padding(
                            padding: const EdgeInsets.all(14),
                            child: Row(
                              children: <Widget>[
                                Icon(leadingIcon, color: iconColor),
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
                                            line.productName,
                                            style: const TextStyle(
                                              fontWeight: FontWeight.w600,
                                              fontSize: 15,
                                            ),
                                          ),
                                          if (_lineSourceBadgeKey(line) != null)
                                            Chip(
                                              label: Text(
                                                StringLookup.t(
                                                  loc,
                                                  _lineSourceBadgeKey(line)!,
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
                                        _barcodeSkuSubtitle(line),
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
                                        line.isVipExpiryInformational
                                            ? StringLookup.t(loc, 'vipExpiryNotPickedDetail')
                                            : pickerLocationQtyLine(line),
                                        style: TextStyle(
                                          fontSize: 13,
                                          color: line.isVipExpiryInformational
                                              ? Colors.red.shade800
                                              : cs.onSurfaceVariant,
                                        ),
                                        maxLines: 4,
                                        overflow: TextOverflow.ellipsis,
                                      ),
                                    ],
                                  ),
                                ),
                                if ((ref.watch(networkOnlineProvider).valueOrNull ?? true) &&
                                    !lineComplete)
                                  IconButton(
                                    icon: const Icon(Icons.flag_rounded),
                                    tooltip: StringLookup.t(loc, 'lineReasonModalTitle'),
                                    onPressed: () => _showSkipReasonSheet(line),
                                  ),
                              ],
                            ),
                          ),
                        ),
                      );
                    }

                    final PickLineGroup g = orderedGroups[i];
                    final bool groupVerified = g.members
                        .every((PickingLine l) => _verifiedLineIds.contains(l.id));
                    final bool lineComplete = pickLineGroupEffectivelyDone(g);
                    final bool useGreenCard = groupVerified;
                    final bool controllerIncomplete = !lineComplete;
                    final Color cardBg = useGreenCard
                        ? Colors.green.withValues(alpha: isDark ? 0.20 : 0.14)
                        : controllerIncomplete
                            ? (isDark
                                ? Colors.red.withValues(alpha: 0.16)
                                : const Color(0xFFFFEBEE))
                            : cs.surfaceContainerHighest.withValues(alpha: 0.35);
                    final IconData leadingIcon;
                    final Color iconColor;
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
                                      groupLocationQtyLine(g),
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

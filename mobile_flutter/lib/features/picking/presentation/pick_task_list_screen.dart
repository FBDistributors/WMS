import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:intl/intl.dart';

import '../../../core/app_state/app_locale.dart';
import '../../../core/app_state/locale_controller.dart';
import '../../../core/app_state/network_status_provider.dart';
import '../../../core/app_state/theme_controller.dart';
import '../../../l10n/string_lookup.dart';
import '../../../shared/feedback/app_top_snackbar.dart';
import '../../../shared/widgets/consolidated_pick_content.dart';
import '../../../shared/widgets/consolidated_top_pick_qty_sheet.dart';
import '../../../shared/widgets/picker_footer.dart';
import '../../../shared/widgets/picker_tab_app_header.dart';
import '../data/picking_constants.dart';
import '../data/picking_models.dart';
import '../domain/profile_type_param.dart';
import '../picking_providers.dart';

bool _pickerEligibleBulkSend(PickingListItem item, PickerProfileParam profile) {
  return profile == PickerProfileParam.picker &&
      item.linesDone > 0 &&
      item.controlledByUserId == null;
}

bool _isFullyPickedLines(PickingListItem d) =>
    d.linesTotal > 0 && d.linesDone >= d.linesTotal;

bool _pickerCanCancelOrderRow(PickingListItem item) {
  if (item.pickedAny) {
    return false;
  }
  if (item.controlledByUserId != null) {
    return false;
  }
  const Set<String> blocked = <String>{
    'cancelled',
    'completed',
    'packed',
    'shipped',
    'picked',
  };
  return !blocked.contains(item.status);
}

class PickTaskListScreen extends ConsumerStatefulWidget {
  const PickTaskListScreen({super.key});

  @override
  ConsumerState<PickTaskListScreen> createState() => _PickTaskListScreenState();
}

class _PickTaskListScreenState extends ConsumerState<PickTaskListScreen> {
  bool _handledRouteExtras = false;
  bool _showConsolidated = false;
  int _consolidatedRefreshKey = 0;
  String? _pendingConsolidatedBarcode;
  String? _restoreConsolidatedProductKey;
  final TextEditingController _controllerSearch = TextEditingController();
  final TextEditingController _consolidatedBarcode = TextEditingController();

  String? _completedBanner;
  bool _bannerScheduled = false;
  bool _orderSelectionMode = false;
  final Set<String> _selectedOrderIds = <String>{};
  bool _headerRefreshing = false;

  Future<void> _onAppBarRefresh() async {
    setState(() => _headerRefreshing = true);
    try {
      await ref.read(openPickTasksProvider.notifier).refreshFromNetwork();
      if (_showConsolidated) {
        await ref.read(consolidatedViewProvider.notifier).refreshFromNetwork();
        if (mounted) {
          setState(() => _consolidatedRefreshKey++);
        }
      }
    } finally {
      if (mounted) {
        setState(() => _headerRefreshing = false);
      }
    }
  }

  @override
  void dispose() {
    _controllerSearch.dispose();
    _consolidatedBarcode.dispose();
    super.dispose();
  }

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    final Uri uri = GoRouterState.of(context).uri;
    final String? profileQ = uri.queryParameters['profile'];
    final PickerProfileParam routeProfile = pickerProfileFromQuery(profileQ);

    if (uri.queryParameters['openConsolidated'] == '1') {
      final String? scanB = uri.queryParameters['scannedBarcode'];
      final String? scanK = uri.queryParameters['selectedProductKey'];
      final bool hasScanExtras = (scanB != null && scanB.isNotEmpty) ||
          (scanK != null && scanK.isNotEmpty);
      if (hasScanExtras) {
        WidgetsBinding.instance.addPostFrameCallback((_) {
          if (!mounted) {
            return;
          }
          setState(() {
            _showConsolidated = true;
            _pendingConsolidatedBarcode =
                (scanB != null && scanB.isNotEmpty) ? scanB : null;
            _restoreConsolidatedProductKey =
                (scanK != null && scanK.isNotEmpty) ? scanK : null;
            if (_restoreConsolidatedProductKey == null &&
                _pendingConsolidatedBarcode != null) {
              _consolidatedBarcode.text = _pendingConsolidatedBarcode!;
            }
          });
          if (!mounted) {
            return;
          }
          context.goNamed(
            'pickTasks',
            queryParameters: <String, String>{
              'profile': profileToQuery(routeProfile),
              'openConsolidated': '1',
            },
          );
        });
      } else if (!_handledRouteExtras) {
        _handledRouteExtras = true;
        _showConsolidated = true;
        final String? b = uri.queryParameters['scannedBarcode'];
        if (b != null && b.isNotEmpty) {
          _consolidatedBarcode.text = b;
        }
      }
    }
    final String? done = uri.queryParameters['completedMessage'];
    if (done != null && done.isNotEmpty && !_bannerScheduled) {
      _bannerScheduled = true;
      _completedBanner = done;
      WidgetsBinding.instance.addPostFrameCallback((_) {
        if (!mounted) {
          return;
        }
        setState(() {});
        Future<void>.delayed(const Duration(milliseconds: 2600), () {
          if (mounted) {
            setState(() => _completedBanner = null);
          }
        });
      });
    }
  }

  String _taskTitle(AppLocale loc, PickingListItem item) {
    final String? on = item.orderNumber;
    if (on != null && on.isNotEmpty) {
      return StringLookup.tParams(loc, 'orderNumberDisplay', <String, String>{'number': on});
    }
    return item.referenceNumber;
  }

  String _statusLabel(AppLocale loc, PickerProfileParam profile, PickingListItem item) {
    if (profile == PickerProfileParam.controller && item.status == 'picked') {
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
    return StringLookup.t(loc, map[item.status] ?? 'statusNew');
  }

  String _sentAtLabel(AppLocale loc, String? iso, AppLocale forFormat) {
    if (iso == null || iso.isEmpty) {
      return '—';
    }
    try {
      final DateTime d = DateTime.parse(iso).toLocal();
      final String tag = switch (forFormat) {
        AppLocale.uz => 'uz_UZ',
        AppLocale.ru => 'ru_RU',
        AppLocale.en => 'en_US',
      };
      return DateFormat.yMd(tag).add_jm().format(d);
    } on Exception {
      return iso;
    }
  }

  List<PickingListItem> _filtered(
    List<PickingListItem> list,
    PickerProfileParam profile,
  ) {
    if (profile != PickerProfileParam.controller) {
      return list;
    }
    final String q = _controllerSearch.text.trim().toLowerCase();
    if (q.isEmpty) {
      return list;
    }
    return list.where((PickingListItem item) {
      final String hay = <String?>[
        item.referenceNumber,
        item.orderNumber,
        item.deliveryNumber,
        item.assignedToUserName,
      ].whereType<String>().join(' ').toLowerCase();
      return hay.contains(q);
    }).toList(growable: false);
  }

  Future<void> _openControllerModal(PickingListItem doc) async {
    final bool online = ref.read(networkOnlineProvider).valueOrNull ?? true;
    List<ControllerUser> controllers = const <ControllerUser>[];
    try {
      if (online) {
        controllers = await ref.read(pickingRepositoryProvider).getControllers();
      }
    } on Exception catch (e) {
      if (mounted) {
        showAppSnackBar(
          context,
          SnackBar(content: Text('$e')),
        );
      }
      return;
    }
    if (!mounted) {
      return;
    }
    await showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      builder: (BuildContext ctx) {
        bool sending = false;
        return StatefulBuilder(
          builder: (BuildContext context, void Function(void Function()) setModal) {
            return _ControllerPickerSheet(
              loc: ref.read(appLocaleProvider),
              isDark: ref.read(appThemeModeProvider) == ThemeMode.dark,
              loading: false,
              sending: sending,
              controllers: controllers,
              onPick: (String id) async {
                setModal(() => sending = true);
                try {
                  await _sendToControllerConfirm(doc, id);
                  if (ctx.mounted) {
                    Navigator.of(ctx).pop();
                  }
                } finally {
                  if (context.mounted) {
                    setModal(() => sending = false);
                  }
                }
              },
              onCancel: () => Navigator.of(ctx).pop(),
            );
          },
        );
      },
    );
  }

  Future<void> _onSendToControllerPress(PickingListItem doc) async {
    final bool online = ref.read(networkOnlineProvider).valueOrNull ?? true;
    final bool fully =
        doc.linesTotal > 0 && doc.linesDone >= doc.linesTotal;
    if (fully) {
      await _openControllerModal(doc);
      return;
    }
    if (!online) {
      final AppLocale loc = ref.read(appLocaleProvider);
      showAppSnackBar(
        context,
        SnackBar(content: Text(StringLookup.t(loc, 'loadError'))),
      );
      return;
    }
    await showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      builder: (BuildContext ctx) {
        String? selected;
        bool busy = false;
        return StatefulBuilder(
          builder: (BuildContext context, void Function(void Function()) setModal) {
            return _IncompleteReasonSheet(
              loc: ref.read(appLocaleProvider),
              isDark: ref.read(appThemeModeProvider) == ThemeMode.dark,
              busy: busy,
              selected: selected,
              onSelect: (String? v) => setModal(() => selected = v),
              onConfirm: () async {
                final String? reason = selected;
                if (reason == null) {
                  return;
                }
                setModal(() => busy = true);
                try {
                  await ref.read(pickingRepositoryProvider).completePickDocument(
                        doc.id,
                        incompleteReason: reason,
                      );
                  if (ctx.mounted) {
                    Navigator.of(ctx).pop();
                  }
                  unawaited(ref.read(openPickTasksProvider.notifier).refreshFromNetwork());
                  await _openControllerModal(doc);
                } on Exception catch (e) {
                  if (ctx.mounted) {
                    showAppSnackBar(ctx, SnackBar(content: Text('$e')));
                  }
                } finally {
                  if (context.mounted) {
                    setModal(() => busy = false);
                  }
                }
              },
              onCancel: () => Navigator.of(ctx).pop(),
            );
          },
        );
      },
    );
  }

  Future<void> _onCancelOrderPressed(PickingListItem item) async {
    final AppLocale loc = ref.read(appLocaleProvider);
    final bool? confirm = await showDialog<bool>(
      context: context,
      builder: (BuildContext ctx) => AlertDialog(
        title: Text(StringLookup.t(loc, 'cancelOrder')),
        content: Text(StringLookup.t(loc, 'cancelOrderConfirm')),
        actions: <Widget>[
          TextButton(
            onPressed: () => Navigator.of(ctx).pop(false),
            child: Text(StringLookup.t(loc, 'cancelOrderDialogNo')),
          ),
          FilledButton(
            onPressed: () => Navigator.of(ctx).pop(true),
            child: Text(StringLookup.t(loc, 'cancelOrderDialogYes')),
          ),
        ],
      ),
    );
    if (confirm != true || !mounted) {
      return;
    }
    try {
      await ref.read(pickingRepositoryProvider).cancelPickDocument(item.id);
      if (!mounted) {
        return;
      }
      unawaited(ref.read(openPickTasksProvider.notifier).refreshFromNetwork());
      showAppSnackBar(
        context,
        SnackBar(content: Text(StringLookup.t(loc, 'cancelOrderSuccess'))),
      );
    } on Exception catch (e) {
      if (mounted) {
        showAppSnackBar(
          context,
          SnackBar(content: Text('$e')),
        );
      }
    }
  }

  Future<void> _sendSingleDocumentToControllerForBulk(
    PickingListItem doc,
    String controllerUserId, {
    String? sharedIncompleteReason,
  }) async {
    final bool fully = _isFullyPickedLines(doc);
    if (!fully) {
      final String? r = sharedIncompleteReason;
      if (r == null || r.isEmpty) {
        throw StateError('incomplete_reason');
      }
      await ref.read(pickingRepositoryProvider).completePickDocument(
            doc.id,
            incompleteReason: r,
          );
    } else if (doc.status != 'picked') {
      await ref.read(pickingRepositoryProvider).completePickDocument(doc.id);
    }
    await ref.read(pickingRepositoryProvider).sendToController(
          doc.id,
          controllerUserId,
        );
  }

  Future<String?> _showIncompleteReasonPickerForBulk() async {
    return showModalBottomSheet<String>(
      context: context,
      isScrollControlled: true,
      builder: (BuildContext ctx) {
        String? selected;
        return StatefulBuilder(
          builder: (BuildContext context, void Function(void Function()) setModal) {
            return _IncompleteReasonSheet(
              loc: ref.read(appLocaleProvider),
              isDark: ref.read(appThemeModeProvider) == ThemeMode.dark,
              busy: false,
              selected: selected,
              onSelect: (String? v) => setModal(() => selected = v),
              onConfirm: () {
                if (selected != null && ctx.mounted) {
                  Navigator.of(ctx).pop<String>(selected);
                }
              },
              onCancel: () => Navigator.of(ctx).pop(),
            );
          },
        );
      },
    );
  }

  Future<void> _openBulkControllerModal(
    List<PickingListItem> docs, {
    String? sharedIncompleteReason,
  }) async {
    final bool online = ref.read(networkOnlineProvider).valueOrNull ?? true;
    List<ControllerUser> controllers = const <ControllerUser>[];
    try {
      if (online) {
        controllers = await ref.read(pickingRepositoryProvider).getControllers();
      }
    } on Exception catch (e) {
      if (mounted) {
        showAppSnackBar(
          context,
          SnackBar(content: Text('$e')),
        );
      }
      return;
    }
    if (!mounted) {
      return;
    }
    await showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      builder: (BuildContext ctx) {
        bool sending = false;
        return StatefulBuilder(
          builder: (BuildContext context, void Function(void Function()) setModal) {
            return _ControllerPickerSheet(
              loc: ref.read(appLocaleProvider),
              isDark: ref.read(appThemeModeProvider) == ThemeMode.dark,
              loading: false,
              sending: sending,
              controllers: controllers,
              onPick: (String controllerId) async {
                setModal(() => sending = true);
                try {
                  int ok = 0;
                  int fail = 0;
                  for (final PickingListItem doc in docs) {
                    try {
                      await _sendSingleDocumentToControllerForBulk(
                        doc,
                        controllerId,
                        sharedIncompleteReason: sharedIncompleteReason,
                      );
                      ok++;
                    } on Exception catch (e) {
                      fail++;
                      debugPrint('bulk send ${doc.id}: $e');
                    }
                  }
                  if (!ctx.mounted) {
                    return;
                  }
                  Navigator.of(ctx).pop();
                  if (!mounted) {
                    return;
                  }
                  final AppLocale loc = ref.read(appLocaleProvider);
                  setState(() {
                    _consolidatedRefreshKey++;
                    _selectedOrderIds.clear();
                    _orderSelectionMode = false;
                  });
                  unawaited(ref.read(openPickTasksProvider.notifier).refreshFromNetwork());
                  unawaited(ref.read(consolidatedViewProvider.notifier).refreshFromNetwork());
                  final String msg;
                  if (fail == 0) {
                    msg = StringLookup.tParams(
                      loc,
                      'bulkSendResultAllOk',
                      <String, String>{'count': '$ok'},
                    );
                  } else if (ok == 0) {
                    msg = StringLookup.tParams(
                      loc,
                      'bulkSendResultAllFail',
                      <String, String>{'fail': '$fail'},
                    );
                  } else {
                    msg = StringLookup.tParams(
                      loc,
                      'bulkSendResultPartial',
                      <String, String>{'ok': '$ok', 'fail': '$fail'},
                    );
                  }
                  showAppSnackBar(
                    context,
                    SnackBar(content: Text(msg)),
                  );
                } finally {
                  if (context.mounted) {
                    setModal(() => sending = false);
                  }
                }
              },
              onCancel: () => Navigator.of(ctx).pop(),
            );
          },
        );
      },
    );
  }

  Future<void> _onBulkSendPressed(List<PickingListItem> shown) async {
    final List<PickingListItem> docs = shown
        .where(
          (PickingListItem e) =>
              _selectedOrderIds.contains(e.id) &&
              _pickerEligibleBulkSend(e, PickerProfileParam.picker),
        )
        .toList(growable: false);
    if (docs.isEmpty) {
      return;
    }
    final bool anyIncomplete = docs.any((PickingListItem d) => !_isFullyPickedLines(d));
    String? sharedIncompleteReason;
    if (anyIncomplete) {
      final bool online = ref.read(networkOnlineProvider).valueOrNull ?? true;
      if (!online) {
        final AppLocale loc = ref.read(appLocaleProvider);
        if (mounted) {
          showAppSnackBar(
        context,
            SnackBar(content: Text(StringLookup.t(loc, 'loadError'))),
          );
        }
        return;
      }
      sharedIncompleteReason = await _showIncompleteReasonPickerForBulk();
      if (!mounted || sharedIncompleteReason == null || sharedIncompleteReason.isEmpty) {
        return;
      }
    }
    await _openBulkControllerModal(docs, sharedIncompleteReason: sharedIncompleteReason);
  }

  Future<void> _sendToControllerConfirm(
    PickingListItem doc,
    String controllerUserId,
  ) async {
    final AppLocale loc = ref.read(appLocaleProvider);
    try {
      if (doc.status != 'picked') {
        await ref.read(pickingRepositoryProvider).completePickDocument(doc.id);
      }
      await ref.read(pickingRepositoryProvider).sendToController(
            doc.id,
            controllerUserId,
          );
      if (!mounted) {
        return;
      }
      setState(() => _consolidatedRefreshKey++);
      unawaited(ref.read(openPickTasksProvider.notifier).refreshFromNetwork());
      unawaited(ref.read(consolidatedViewProvider.notifier).refreshFromNetwork());
      showAppSnackBar(
        context,
        SnackBar(content: Text(StringLookup.t(loc, 'sendToControllerDone'))),
      );
    } on Exception catch (e) {
      if (mounted) {
        showAppSnackBar(
          context,
          SnackBar(content: Text('$e')),
        );
      }
    }
  }

  Future<void> _submitConsolidatedPick() async {
    final AppLocale loc = ref.read(appLocaleProvider);
    final String b = _consolidatedBarcode.text.trim();
    if (b.isEmpty) {
      return;
    }
    AsyncValue<ConsolidatedViewResponse> view = ref.read(consolidatedViewProvider);
    if (!view.hasValue) {
      await ref.read(consolidatedViewProvider.notifier).refreshFromNetwork();
      view = ref.read(consolidatedViewProvider);
    }
    if (!view.hasValue) {
      if (mounted) {
        showAppSnackBar(
        context,
          SnackBar(content: Text(StringLookup.t(loc, 'loading'))),
        );
      }
      return;
    }
    final int? openQty = consolidatedOpenPickQtyForBarcode(b, view.requireValue.products);
    if (openQty == null) {
      if (mounted) {
        showAppSnackBar(
        context,
          SnackBar(content: Text(StringLookup.t(loc, 'productNotInOrder'))),
        );
      }
      return;
    }
    if (openQty < 1) {
      if (mounted) {
        showAppSnackBar(
        context,
          SnackBar(content: Text(StringLookup.t(loc, 'consolidatedNothingToPick'))),
        );
      }
      return;
    }
    final ConsolidatedProduct? product =
        consolidatedProductForBarcode(b, view.requireValue.products);
    if (product == null) {
      if (mounted) {
        showAppSnackBar(
        context,
          SnackBar(content: Text(StringLookup.t(loc, 'productNotInOrder'))),
        );
      }
      return;
    }
    if (!mounted) {
      return;
    }
    await showConsolidatedTopPickQtySheet(
      context: context,
      ref: ref,
      loc: loc,
      product: product,
      pickBarcode: b,
      onSuccess: () {
        if (!mounted) {
          return;
        }
        _consolidatedBarcode.clear();
        setState(() => _consolidatedRefreshKey++);
      },
    );
  }

  @override
  Widget build(BuildContext context) {
    final AppLocale loc = ref.watch(appLocaleProvider);
    final bool isDark = ref.watch(appThemeModeProvider) == ThemeMode.dark;
    final String? qp = GoRouterState.of(context).uri.queryParameters['profile'];
    final PickerProfileParam profile = pickerProfileFromQuery(qp);
    final AsyncValue<List<PickingListItem>> tasks = ref.watch(openPickTasksProvider);
    final ColorScheme cs = Theme.of(context).colorScheme;
    final Color bg = isDark ? const Color(0xFF0F172A) : Colors.white;
    final Color cardBg = isDark ? const Color(0xFF1E293B) : const Color(0xFFF8FAFC);
    final Color border = isDark ? const Color(0xFF334155) : const Color(0xFFE2E8F0);

    ref.listen<ConsolidatedScanFromScanner?>(
      pendingConsolidatedScanProvider,
      (ConsolidatedScanFromScanner? prev, ConsolidatedScanFromScanner? next) {
        if (next == null) {
          return;
        }
        final ConsolidatedScanFromScanner snap = next;
        ref.read(pendingConsolidatedScanProvider.notifier).state = null;
        WidgetsBinding.instance.addPostFrameCallback((_) {
          if (!mounted) {
            return;
          }
          setState(() {
            _showConsolidated = true;
            _pendingConsolidatedBarcode =
                snap.barcode.isNotEmpty ? snap.barcode : null;
            _restoreConsolidatedProductKey =
                (snap.selectedProductKey != null && snap.selectedProductKey!.isNotEmpty)
                    ? snap.selectedProductKey
                    : null;
            if (_restoreConsolidatedProductKey == null &&
                _pendingConsolidatedBarcode != null) {
              _consolidatedBarcode.text = _pendingConsolidatedBarcode!;
            }
          });
          context.goNamed(
            'pickTasks',
            queryParameters: <String, String>{
              'profile': snap.profileQuery,
              'openConsolidated': '1',
            },
          );
        });
      },
    );

    final String headerTitle = _showConsolidated && profile == PickerProfileParam.picker
        ? StringLookup.t(loc, 'consolidatedPickTitle')
        : StringLookup.t(loc, 'openTasks');

    return Scaffold(
      backgroundColor: bg,
      body: Column(
        children: <Widget>[
          if (_completedBanner != null)
            Material(
              color: const Color(0xFF15803D),
              child: Padding(
                padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 10),
                child: Row(
                  children: <Widget>[
                    const Icon(Icons.check_circle_rounded, color: Colors.white, size: 22),
                    const SizedBox(width: 10),
                    Expanded(
                      child: Text(
                        Uri.decodeComponent(_completedBanner!),
                        style: const TextStyle(color: Colors.white, fontSize: 14),
                      ),
                    ),
                  ],
                ),
              ),
            ),
          PickerTabAppHeader(
            title: headerTitle,
            headerBackgroundColor: isDark ? const Color(0xFF1E293B) : null,
            titleColor: isDark ? const Color(0xFFF1F5F9) : null,
            accentColor: isDark ? const Color(0xFF93C5FD) : null,
            actionsBeforeNotification: <Widget>[
              if (!_showConsolidated && profile == PickerProfileParam.picker)
                IconButton(
                  tooltip: _orderSelectionMode
                      ? StringLookup.t(loc, 'orderSelectModeDone')
                      : StringLookup.t(loc, 'orderSelectMode'),
                  onPressed: () {
                    setState(() {
                      _orderSelectionMode = !_orderSelectionMode;
                      if (!_orderSelectionMode) {
                        _selectedOrderIds.clear();
                      }
                    });
                  },
                  icon: Icon(
                    _orderSelectionMode
                        ? Icons.checklist_rtl_rounded
                        : Icons.checklist_rounded,
                    color: Colors.white,
                  ),
                ),
            ],
            onRefresh: () => unawaited(_onAppBarRefresh()),
            refreshing: _headerRefreshing,
          ),
          if (!_showConsolidated && profile == PickerProfileParam.controller)
            Padding(
              padding: const EdgeInsets.fromLTRB(16, 12, 16, 8),
              child: TextField(
                controller: _controllerSearch,
                onChanged: (_) => setState(() {}),
                decoration: InputDecoration(
                  hintText: StringLookup.t(loc, 'controllerTasksSearchPlaceholder'),
                  prefixIcon: const Icon(Icons.search_rounded),
                  filled: true,
                  fillColor: cardBg,
                  border: OutlineInputBorder(
                    borderRadius: BorderRadius.circular(12),
                    borderSide: BorderSide(color: border),
                  ),
                ),
              ),
            ),
          Expanded(
            child: _showConsolidated && profile == PickerProfileParam.picker
                ? Column(
                    children: <Widget>[
                      Padding(
                        padding: const EdgeInsets.fromLTRB(16, 12, 16, 8),
                        child: Row(
                          children: <Widget>[
                            Expanded(
                              child: TextField(
                                controller: _consolidatedBarcode,
                                decoration: InputDecoration(
                                  labelText: StringLookup.t(loc, 'barcodeOrSku'),
                                  border: OutlineInputBorder(
                                    borderRadius: BorderRadius.circular(12),
                                  ),
                                ),
                              ),
                            ),
                            const SizedBox(width: 8),
                            FilledButton(
                              onPressed: _submitConsolidatedPick,
                              child: Text(StringLookup.t(loc, 'submit')),
                            ),
                          ],
                        ),
                      ),
                      tasks.when(
                        data: (List<PickingListItem> list) {
                          return Padding(
                            padding: const EdgeInsets.symmetric(horizontal: 16),
                            child: Row(
                              children: <Widget>[
                                Text(
                                  StringLookup.t(loc, 'consolidatedMyTasks'),
                                  style: TextStyle(
                                    fontWeight: FontWeight.w600,
                                    color: cs.onSurfaceVariant,
                                  ),
                                ),
                                const Spacer(),
                                Text(
                                  '${list.length}${StringLookup.t(loc, 'countTa')}',
                                  style: TextStyle(color: cs.primary, fontWeight: FontWeight.w700),
                                ),
                              ],
                            ),
                          );
                        },
                        loading: () => const SizedBox.shrink(),
                        error: (_, __) => const SizedBox.shrink(),
                      ),
                      const SizedBox(height: 4),
                      Expanded(
                        child: ConsolidatedPickContent(
                          refreshVersion: _consolidatedRefreshKey,
                          onPullRefresh: _onAppBarRefresh,
                          pendingScannedBarcode: _pendingConsolidatedBarcode,
                          restoreConsolidatedProductKey:
                              _restoreConsolidatedProductKey,
                          onClearPendingScan: () {
                            if (mounted) {
                              setState(() {
                                _pendingConsolidatedBarcode = null;
                                _restoreConsolidatedProductKey = null;
                              });
                            }
                          },
                          onAfterSuccessfulPick: () {
                            if (mounted) {
                              setState(() => _consolidatedRefreshKey++);
                            }
                          },
                        ),
                      ),
                    ],
                  )
                : tasks.when(
                    data: (List<PickingListItem> list) {
                      final List<PickingListItem> shown = _filtered(list, profile);
                      if (shown.isEmpty) {
                        return Center(child: Text(StringLookup.t(loc, 'openTasksEmpty')));
                      }
                      final Set<String> eligibleIds = shown
                          .where((PickingListItem e) => _pickerEligibleBulkSend(e, profile))
                          .map((PickingListItem e) => e.id)
                          .toSet();
                      final bool anyEligibleSelected =
                          eligibleIds.any(_selectedOrderIds.contains);
                      final bool allEligibleSelected = eligibleIds.isNotEmpty &&
                          eligibleIds.every(_selectedOrderIds.contains);
                      bool? selectAllValue;
                      if (!anyEligibleSelected) {
                        selectAllValue = false;
                      } else if (allEligibleSelected) {
                        selectAllValue = true;
                      } else {
                        selectAllValue = null;
                      }
                      return Column(
                        crossAxisAlignment: CrossAxisAlignment.stretch,
                        children: <Widget>[
                          if (_orderSelectionMode &&
                              profile == PickerProfileParam.picker &&
                              eligibleIds.isNotEmpty)
                            CheckboxListTile(
                              value: selectAllValue,
                              tristate: true,
                              title: Text(StringLookup.t(loc, 'selectAllEligible')),
                              onChanged: (bool? v) {
                                setState(() {
                                  if (v == true) {
                                    _selectedOrderIds.addAll(eligibleIds);
                                  } else {
                                    _selectedOrderIds.removeAll(eligibleIds);
                                  }
                                });
                              },
                            ),
                          Expanded(
                            child: RefreshIndicator(
                              onRefresh: _onAppBarRefresh,
                              child: ListView.separated(
                                physics: const AlwaysScrollableScrollPhysics(),
                                padding: const EdgeInsets.fromLTRB(16, 8, 16, 8),
                                itemCount: shown.length,
                                separatorBuilder: (_, __) => const SizedBox(height: 10),
                                itemBuilder: (BuildContext context, int i) {
                                final PickingListItem item = shown[i];
                                final bool eligible =
                                    _pickerEligibleBulkSend(item, profile);
                                return _TaskCard(
                                  item: item,
                                  profile: profile,
                                  loc: loc,
                                  isDark: isDark,
                                  title: _taskTitle(loc, item),
                                  statusText: _statusLabel(loc, profile, item),
                                  sentAt: profile == PickerProfileParam.controller
                                      ? StringLookup.tParams(
                                          loc,
                                          'sentToControllerAt',
                                          <String, String>{
                                            'datetime': _sentAtLabel(
                                              loc,
                                              item.sentToControllerAt,
                                              loc,
                                            ),
                                          },
                                        )
                                      : null,
                                  selectionMode: _orderSelectionMode &&
                                      profile == PickerProfileParam.picker,
                                  selected: _selectedOrderIds.contains(item.id),
                                  eligibleForSelection: eligible,
                                  onToggleSelected: eligible
                                      ? () {
                                          setState(() {
                                            if (_selectedOrderIds.contains(item.id)) {
                                              _selectedOrderIds.remove(item.id);
                                            } else {
                                              _selectedOrderIds.add(item.id);
                                            }
                                          });
                                        }
                                      : null,
                                  onOpen: () => context.pushNamed(
                                    'pickTaskDetail',
                                    pathParameters: <String, String>{'taskId': item.id},
                                    queryParameters: <String, String>{
                                      'profile': profileToQuery(profile),
                                    },
                                  ),
                                  onSendToController: profile == PickerProfileParam.picker
                                      ? () => _onSendToControllerPress(item)
                                      : null,
                                  onCancelOrder: profile == PickerProfileParam.picker &&
                                          _pickerCanCancelOrderRow(item)
                                      ? () => _onCancelOrderPressed(item)
                                      : null,
                                );
                              },
                            ),
                            ),
                          ),
                          if (_orderSelectionMode &&
                              profile == PickerProfileParam.picker &&
                              _selectedOrderIds.isNotEmpty)
                            Padding(
                              padding: const EdgeInsets.fromLTRB(16, 0, 16, 8),
                              child: FilledButton.tonal(
                                onPressed: () => unawaited(_onBulkSendPressed(shown)),
                                child: Text(
                                  StringLookup.tParams(
                                    loc,
                                    'bulkSendToController',
                                    <String, String>{
                                      'count':
                                          '${_selectedOrderIds.where(eligibleIds.contains).length}',
                                    },
                                  ),
                                ),
                              ),
                            ),
                        ],
                      );
                    },
                    loading: () => const Center(child: CircularProgressIndicator()),
                    error: (Object e, _) => Center(
                      child: Column(
                        mainAxisAlignment: MainAxisAlignment.center,
                        children: <Widget>[
                          Text('$e'),
                          FilledButton(
                            onPressed: () => unawaited(
                              ref.read(openPickTasksProvider.notifier).refreshFromNetwork(),
                            ),
                            child: Text(StringLookup.t(loc, 'retry')),
                          ),
                        ],
                      ),
                    ),
                  ),
          ),
          if (profile == PickerProfileParam.picker)
            Padding(
              padding: const EdgeInsets.fromLTRB(16, 0, 16, 8),
              child: SegmentedButton<bool>(
                segments: <ButtonSegment<bool>>[
                  ButtonSegment<bool>(
                    value: false,
                    label: Text(StringLookup.t(loc, 'toggleOrdersList')),
                    icon: const Icon(Icons.receipt_long_rounded, size: 18),
                  ),
                  ButtonSegment<bool>(
                    value: true,
                    label: Text(StringLookup.t(loc, 'toggleGeneralList')),
                    icon: const Icon(Icons.layers_rounded, size: 18),
                  ),
                ],
                selected: <bool>{_showConsolidated},
                onSelectionChanged: (Set<bool> next) {
                  setState(() {
                    _showConsolidated = next.single;
                    _orderSelectionMode = false;
                    _selectedOrderIds.clear();
                    if (!_showConsolidated) {
                      unawaited(ref.read(openPickTasksProvider.notifier).refreshFromNetwork());
                    } else {
                      unawaited(ref.read(consolidatedViewProvider.notifier).refreshFromNetwork());
                    }
                  });
                },
              ),
            ),
          const PickerFooter(current: PickerFooterRoute.pickTaskList),
        ],
      ),
    );
  }
}

class _TaskCard extends StatelessWidget {
  const _TaskCard({
    required this.item,
    required this.profile,
    required this.loc,
    required this.isDark,
    required this.title,
    required this.statusText,
    required this.sentAt,
    required this.onOpen,
    this.selectionMode = false,
    this.selected = false,
    this.eligibleForSelection = false,
    this.onToggleSelected,
    this.onSendToController,
    this.onCancelOrder,
  });

  final PickingListItem item;
  final PickerProfileParam profile;
  final AppLocale loc;
  final bool isDark;
  final String title;
  final String statusText;
  final String? sentAt;
  final VoidCallback onOpen;
  final bool selectionMode;
  final bool selected;
  final bool eligibleForSelection;
  final VoidCallback? onToggleSelected;
  final void Function()? onSendToController;
  final VoidCallback? onCancelOrder;

  @override
  Widget build(BuildContext context) {
    final bool fully = item.linesTotal > 0 && item.linesDone >= item.linesTotal;
    final bool useGreenListStyle =
        profile != PickerProfileParam.controller && fully;
    final bool showSend = profile == PickerProfileParam.picker &&
        item.linesDone > 0 &&
        item.controlledByUserId == null;
    final ColorScheme cs = Theme.of(context).colorScheme;
    final Color greenBg = isDark ? const Color(0xFF14532D) : const Color(0xFFDCFCE7);
    final Color greenBorder = isDark ? const Color(0xFF22C55E) : const Color(0xFF16A34A);

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: <Widget>[
        Material(
          color: useGreenListStyle
              ? greenBg
              : cs.surfaceContainerHighest.withValues(alpha: 0.4),
          borderRadius: BorderRadius.circular(14),
          child: InkWell(
            borderRadius: BorderRadius.circular(14),
            onTap: onOpen,
            child: Container(
              decoration: BoxDecoration(
                borderRadius: BorderRadius.circular(14),
                border: Border.all(
                  color: useGreenListStyle
                      ? greenBorder
                      : cs.outlineVariant.withValues(alpha: 0.6),
                ),
              ),
              padding: const EdgeInsets.all(14),
              child: Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: <Widget>[
                  if (selectionMode) ...<Widget>[
                    Checkbox(
                      value: selected && eligibleForSelection,
                      tristate: false,
                      onChanged: eligibleForSelection && onToggleSelected != null
                          ? (_) => onToggleSelected!()
                          : null,
                    ),
                    const SizedBox(width: 4),
                  ],
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: <Widget>[
                  Text(
                    title,
                    style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 16),
                  ),
                  const SizedBox(height: 6),
                  Text(
                    StringLookup.tParams(
                      loc,
                      'linesCount',
                      <String, String>{
                        'done': '${item.linesDone}',
                        'total': '${item.linesTotal}',
                      },
                    ),
                    style: TextStyle(color: cs.onSurfaceVariant, fontSize: 14),
                  ),
                  if (profile == PickerProfileParam.controller &&
                      (item.assignedToUserName != null || item.assignedToUserId != null)) ...<Widget>[
                    const SizedBox(height: 4),
                    Text(
                      '${StringLookup.t(loc, 'pickerNameLabel')}: ${item.assignedToUserName ?? '—'}',
                      style: TextStyle(fontSize: 13, color: cs.onSurfaceVariant),
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                    ),
                  ],
                  if (sentAt != null) ...<Widget>[
                    const SizedBox(height: 4),
                    Text(sentAt!, style: TextStyle(fontSize: 12, color: cs.onSurfaceVariant)),
                  ],
                  const SizedBox(height: 8),
                  Align(
                    alignment: Alignment.centerLeft,
                    child: Container(
                      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
                      decoration: BoxDecoration(
                        color: cs.primaryContainer.withValues(alpha: 0.9),
                        borderRadius: BorderRadius.circular(20),
                      ),
                      child: Text(
                        statusText,
                        style: TextStyle(
                          fontSize: 12,
                          fontWeight: FontWeight.w600,
                          color: cs.onPrimaryContainer,
                        ),
                      ),
                    ),
                  ),
                  if (profile == PickerProfileParam.picker &&
                      item.status == 'picked' &&
                      item.controlledByUserId != null) ...<Widget>[
                    const SizedBox(height: 8),
                    Text(
                      StringLookup.t(loc, 'sendToControllerDone'),
                      style: TextStyle(
                        fontSize: 13,
                        color: cs.tertiary,
                        fontWeight: FontWeight.w500,
                      ),
                    ),
                  ],
                      ],
                    ),
                  ),
                ],
              ),
            ),
          ),
        ),
        if (onCancelOrder != null)
          Padding(
            padding: const EdgeInsets.only(top: 8),
            child: OutlinedButton(
              onPressed: onCancelOrder,
              style: OutlinedButton.styleFrom(
                foregroundColor: cs.error,
                side: BorderSide(color: cs.error.withValues(alpha: 0.65)),
              ),
              child: Text(StringLookup.t(loc, 'cancelOrder')),
            ),
          ),
        if (showSend && onSendToController != null)
          Padding(
            padding: const EdgeInsets.only(top: 8),
            child: FilledButton.tonal(
              onPressed: onSendToController,
              child: Text(StringLookup.t(loc, 'sendToController')),
            ),
          ),
      ],
    );
  }
}

class _IncompleteReasonSheet extends StatelessWidget {
  const _IncompleteReasonSheet({
    required this.loc,
    required this.isDark,
    required this.busy,
    required this.selected,
    required this.onSelect,
    required this.onConfirm,
    required this.onCancel,
  });

  final AppLocale loc;
  final bool isDark;
  final bool busy;
  final String? selected;
  final void Function(String?) onSelect;
  final VoidCallback onConfirm;
  final VoidCallback onCancel;

  @override
  Widget build(BuildContext context) {
    return SafeArea(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Material(
          borderRadius: BorderRadius.circular(16),
          color: isDark ? const Color(0xFF1E293B) : Colors.white,
          child: Padding(
            padding: const EdgeInsets.all(16),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: <Widget>[
                Text(
                  StringLookup.t(loc, 'incompleteReasonTitle'),
                  style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 17),
                ),
                const SizedBox(height: 8),
                Text(
                  StringLookup.t(loc, 'incompleteReasonSelect'),
                  style: TextStyle(color: Theme.of(context).colorScheme.onSurfaceVariant),
                ),
                const SizedBox(height: 12),
                SizedBox(
                  height: 280,
                  child: ListView(
                    children: kIncompleteReasonKeys.map((String key) {
                      return RadioListTile<String>(
                        title: Text(StringLookup.t(loc, 'reason_$key')),
                        value: key,
                        groupValue: selected,
                        onChanged: busy ? null : onSelect,
                      );
                    }).toList(),
                  ),
                ),
                Row(
                  children: <Widget>[
                    Expanded(
                      child: OutlinedButton(
                        onPressed: busy ? null : onCancel,
                        child: Text(StringLookup.t(loc, 'cancel')),
                      ),
                    ),
                    const SizedBox(width: 12),
                    Expanded(
                      child: FilledButton(
                        onPressed: busy || selected == null ? null : onConfirm,
                        child: Text(
                          busy
                              ? StringLookup.t(loc, 'submittingProgress')
                              : StringLookup.t(loc, 'confirmButton'),
                        ),
                      ),
                    ),
                  ],
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

class _ControllerPickerSheet extends StatelessWidget {
  const _ControllerPickerSheet({
    required this.loc,
    required this.isDark,
    required this.loading,
    required this.sending,
    required this.controllers,
    required this.onPick,
    required this.onCancel,
  });

  final AppLocale loc;
  final bool isDark;
  final bool loading;
  final bool sending;
  final List<ControllerUser> controllers;
  final void Function(String id) onPick;
  final VoidCallback onCancel;

  @override
  Widget build(BuildContext context) {
    return SafeArea(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Material(
          borderRadius: BorderRadius.circular(16),
          color: isDark ? const Color(0xFF1E293B) : Colors.white,
          child: Padding(
            padding: const EdgeInsets.all(12),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: <Widget>[
                Row(
                  children: <Widget>[
                    Expanded(
                      child: Text(
                        StringLookup.t(loc, 'selectController'),
                        style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 17),
                      ),
                    ),
                    IconButton(onPressed: sending ? null : onCancel, icon: const Icon(Icons.close)),
                  ],
                ),
                if (loading)
                  const Padding(
                    padding: EdgeInsets.all(24),
                    child: Center(child: CircularProgressIndicator()),
                  )
                else
                  SizedBox(
                    height: 320,
                    child: ListView(
                      children: controllers.map((ControllerUser c) {
                        return ListTile(
                          leading: const CircleAvatar(child: Icon(Icons.verified_user_rounded)),
                          title: Text(c.fullName ?? c.username),
                          subtitle: c.fullName != null ? Text(c.username) : null,
                          onTap: sending ? null : () => onPick(c.id),
                        );
                      }).toList(),
                    ),
                  ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

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
import '../data/picking_repository.dart';
import '../domain/profile_type_param.dart';
import '../picking_providers.dart';
import '../../feedback/presentation/app_feedback_sheet.dart';

bool _isFullyPickedLines(PickingListItem d) =>
    d.linesTotal > 0 && d.linesDone >= d.linesTotal;

/// Yig'uvchi hujjatni tekshiruv navbatiga yuborishi mumkinmi.
///
/// Oddiy holat: kamida bitta oddiy qator terilgan (`pickedAny`).
/// VIP-muddat holati: hamma qator faqat ma'lumot (yig'ilmaydi) bo'lsa hech narsa
/// terilmaydi (`pickedAny == false`), lekin buyurtma to'liq "bajarilgan" va
/// "picked" holatda — u ham navbatga yuborilishi kerak, aks holda yig'uvchida
/// qotib qoladi. Yarim terilgan (hali "picked" bo'lmagan) buyurtma yuborilmaydi.
bool pickerCanSendToController(PickingListItem item, PickerProfileParam profile) {
  if (profile != PickerProfileParam.picker) {
    return false;
  }
  if (item.sentToControllerAt != null) {
    return false;
  }
  return item.pickedAny ||
      (_isFullyPickedLines(item) && item.status == 'picked');
}

bool _pickerEligibleBulkSend(PickingListItem item, PickerProfileParam profile) =>
    pickerCanSendToController(item, profile);

/// Hujjat umumiy tekshiruv navbatida — hech kim band qilmagan.
///
/// Backend controllerga faqat ikki xil hujjat qaytaradi: navbatdagilar va o'zi
/// band qilganlari, shuning uchun `controlled_by` bo'sh bo'lishi "navbatda"ni bildiradi.
bool controllerDocIsInQueue(PickingListItem item) => item.controlledByUserId == null;

/// Controller ro'yxatini bo'limga ajratadi: `mine=false` — navbat, `true` — o'zinikilar.
List<PickingListItem> controllerDocsForTab(
  List<PickingListItem> list, {
  required bool mine,
}) {
  return list
      .where((PickingListItem e) => controllerDocIsInQueue(e) != mine)
      .toList(growable: false);
}

/// Band qilingan hujjatni navbatga qaytarish mumkinmi (skan boshlanmagan bo'lsa).
bool controllerCanReleaseToQueue(PickingListItem item) =>
    !controllerDocIsInQueue(item) && item.controllerVerificationStartedAt == null;

/// Ro'yxatni manba guruhi bo'yicha ajratadi (shahar / region).
///
/// Guruhlar qoldiqsiz: nomalum yoki yo'q qiymat shaharga tushadi, shuning uchun
/// hujjat ikkala tabda ham ko'rinmay qolmaydi.
List<PickingListItem> controllerDocsForSourceGroup(
  List<PickingListItem> list,
  String group,
) {
  return list
      .where((PickingListItem e) => e.sourceGroup == group)
      .toList(growable: false);
}

class PickTaskListScreen extends ConsumerStatefulWidget {
  const PickTaskListScreen({super.key});

  @override
  ConsumerState<PickTaskListScreen> createState() => _PickTaskListScreenState();
}

class _PickTaskListScreenState extends ConsumerState<PickTaskListScreen> {
  bool _handledRouteExtras = false;
  bool _handledFeedbackPrompt = false;
  bool _showConsolidated = false;
  int _consolidatedRefreshKey = 0;
  String? _pendingConsolidatedBarcode;
  String? _restoreConsolidatedProductKey;
  final TextEditingController _controllerSearch = TextEditingController();
  final TextEditingController _consolidatedBarcode = TextEditingController();

  bool _orderSelectionMode = false;
  final Set<String> _selectedOrderIds = <String>{};
  bool _headerRefreshing = false;

  /// Controller ro'yxati: false — "Navbatda" (band qilinmagan), true — "Menda".
  bool _controllerShowMine = false;

  /// Controller ro'yxatining yuqori darajasi: manba guruhi (shahar / region).
  String _controllerSourceGroup = kSourceGroupCity;
  bool _claiming = false;

  /// Navbat umumiy — boshqa controller olganini ko'rish uchun davriy yangilash.
  Timer? _queuePollTimer;

  void _ensureQueuePolling() {
    _queuePollTimer ??= Timer.periodic(const Duration(seconds: 20), (_) {
      final bool online = ref.read(networkOnlineProvider).valueOrNull ?? true;
      if (!mounted || _claiming || !online) {
        return;
      }
      unawaited(ref.read(openPickTasksProvider.notifier).refreshFromNetwork());
    });
  }

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
    _queuePollTimer?.cancel();
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

    if (routeProfile == PickerProfileParam.controller) {
      _ensureQueuePolling();
    }

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

    if (!_handledFeedbackPrompt && uri.queryParameters['promptFeedback'] == '1') {
      _handledFeedbackPrompt = true;
      final String? feedbackContext = uri.queryParameters['feedbackContext'];
      WidgetsBinding.instance.addPostFrameCallback((_) async {
        if (!mounted) {
          return;
        }
        await maybeShowAutomaticAppFeedback(
          context: context,
          ref: ref,
          module: 'picking',
          contextRef: feedbackContext,
        );
        if (!mounted) {
          return;
        }
        context.goNamed(
          'pickTasks',
          queryParameters: <String, String>{'profile': profileToQuery(routeProfile)},
        );
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

  List<PickingListItem> _searched(
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

  /// Controller uchun ro'yxat "Navbatda" va "Menda" bo'limlariga bo'linadi.
  List<PickingListItem> _filtered(
    List<PickingListItem> list,
    PickerProfileParam profile,
  ) {
    final List<PickingListItem> searched = _searched(list, profile);
    if (profile != PickerProfileParam.controller) {
      return searched;
    }
    return controllerDocsForTab(
      controllerDocsForSourceGroup(searched, _controllerSourceGroup),
      mine: _controllerShowMine,
    );
  }

  /// Navbatdagi hujjatni band qilib ochadi; boshqasi ulgurgan bo'lsa ro'yxat yangilanadi.
  Future<void> _openQueueDocument(PickingListItem item) async {
    final AppLocale loc = ref.read(appLocaleProvider);
    final bool online = ref.read(networkOnlineProvider).valueOrNull ?? true;
    if (!online) {
      showAppSnackBar(
        context,
        SnackBar(content: Text(StringLookup.t(loc, 'claimNeedsNetwork'))),
      );
      return;
    }
    setState(() => _claiming = true);
    try {
      await ref.read(pickingRepositoryProvider).claimDocument(item.id);
    } on PickingClaimConflict {
      unawaited(ref.read(openPickTasksProvider.notifier).refreshFromNetwork());
      if (mounted) {
        showAppSnackBar(
          context,
          SnackBar(content: Text(StringLookup.t(loc, 'claimTakenByOther'))),
        );
      }
      return;
    } on Exception catch (e) {
      if (mounted) {
        showAppLocalizedError(context, loc, e);
      }
      return;
    } finally {
      if (mounted) {
        setState(() => _claiming = false);
      }
    }
    unawaited(ref.read(openPickTasksProvider.notifier).refreshFromNetwork());
    if (!mounted) {
      return;
    }
    setState(() => _controllerShowMine = true);
    await context.pushNamed(
      'pickTaskDetail',
      pathParameters: <String, String>{'taskId': item.id},
      queryParameters: <String, String>{
        'profile': profileToQuery(PickerProfileParam.controller),
      },
    );
    if (mounted) {
      unawaited(ref.read(openPickTasksProvider.notifier).refreshFromNetwork());
    }
  }

  /// Qidiruv qo'llangan, tanlangan manba guruhidagi hujjatlar.
  List<PickingListItem> _controllerSearchedInGroup(
    AsyncValue<List<PickingListItem>> tasks,
  ) {
    final List<PickingListItem>? list = tasks.valueOrNull;
    if (list == null) {
      return const <PickingListItem>[];
    }
    return controllerDocsForSourceGroup(
      _searched(list, PickerProfileParam.controller),
      _controllerSourceGroup,
    );
  }

  /// Manba tabidagi son: qidiruv qo'llangan holda o'sha guruhdagi jami.
  int _countForSourceGroup(AsyncValue<List<PickingListItem>> tasks, String group) {
    final List<PickingListItem>? list = tasks.valueOrNull;
    if (list == null) {
      return 0;
    }
    return controllerDocsForSourceGroup(
      _searched(list, PickerProfileParam.controller),
      group,
    ).length;
  }

  /// Bo'lim yorlig'idagi son: tanlangan guruh ichida navbat / o'zinikilar soni.
  int _countForControllerTab(
    AsyncValue<List<PickingListItem>> tasks, {
    required bool inQueue,
  }) {
    return controllerDocsForTab(
      _controllerSearchedInGroup(tasks),
      mine: !inQueue,
    ).length;
  }

  /// Band qilingan, lekin hali tekshirilmagan hujjatni navbatga qaytaradi.
  Future<void> _releaseToQueue(PickingListItem item) async {
    final AppLocale loc = ref.read(appLocaleProvider);
    try {
      await ref.read(pickingRepositoryProvider).releaseDocument(item.id);
    } on Exception catch (e) {
      if (mounted) {
        showAppLocalizedError(context, loc, e);
      }
      return;
    }
    unawaited(ref.read(openPickTasksProvider.notifier).refreshFromNetwork());
    if (!mounted) {
      return;
    }
    showAppSnackBar(
      context,
      SnackBar(content: Text(StringLookup.t(loc, 'releaseToQueueDone'))),
    );
  }

  /// "Tekshiruvga yuborilsinmi?" — controller tanlanmaydi, hujjat umumiy navbatga tushadi.
  Future<bool> _askSendConfirmation({String? messageOverride}) async {
    final AppLocale loc = ref.read(appLocaleProvider);
    final bool? confirmed = await showDialog<bool>(
      context: context,
      builder: (BuildContext ctx) => AlertDialog(
        title: Text(StringLookup.t(loc, 'sendToControllerConfirmTitle')),
        content: Text(
          messageOverride ?? StringLookup.t(loc, 'sendToControllerConfirmMessage'),
        ),
        actions: <Widget>[
          TextButton(
            onPressed: () => Navigator.of(ctx).pop(false),
            child: Text(StringLookup.t(loc, 'cancel')),
          ),
          FilledButton(
            onPressed: () => Navigator.of(ctx).pop(true),
            child: Text(StringLookup.t(loc, 'confirmButton')),
          ),
        ],
      ),
    );
    return confirmed == true;
  }

  Future<void> _onSendToControllerPress(PickingListItem doc) async {
    final bool online = ref.read(networkOnlineProvider).valueOrNull ?? true;
    // Navbatga yuborish tarmoqsiz ishlamaydi (to'liq ham, sababli ham).
    if (!online) {
      final AppLocale loc = ref.read(appLocaleProvider);
      showAppSnackBar(
        context,
        SnackBar(content: Text(StringLookup.t(loc, 'loadError'))),
      );
      return;
    }
    final bool fully =
        doc.linesTotal > 0 && doc.linesDone >= doc.linesTotal;
    if (fully) {
      if (await _askSendConfirmation()) {
        await _sendToControllerConfirm(doc);
      }
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
                  // Sabab tanlangan — bu tasdiq hisoblanadi, hujjat navbatga yuboriladi.
                  await _sendToControllerConfirm(doc, alreadyCompleted: true);
                } on Exception catch (e) {
                  if (ctx.mounted) {
                    showAppLocalizedError(ctx, ref.read(appLocaleProvider), e);
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

  Future<void> _sendSingleDocumentToControllerForBulk(
    PickingListItem doc, {
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
    await ref.read(pickingRepositoryProvider).sendToController(doc.id);
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

  Future<void> _bulkSendToQueue(
    List<PickingListItem> docs, {
    String? sharedIncompleteReason,
  }) async {
    final AppLocale loc = ref.read(appLocaleProvider);
    final bool confirmed = await _askSendConfirmation(
      messageOverride: StringLookup.tParams(
        loc,
        'bulkSendConfirmMessage',
        <String, String>{'count': '${docs.length}'},
      ),
    );
    if (!confirmed || !mounted) {
      return;
    }
    int ok = 0;
    int fail = 0;
    for (final PickingListItem doc in docs) {
      try {
        await _sendSingleDocumentToControllerForBulk(
          doc,
          sharedIncompleteReason: sharedIncompleteReason,
        );
        ok++;
      } on Exception catch (e) {
        fail++;
        debugPrint('bulk send ${doc.id}: $e');
      }
    }
    if (!mounted) {
      return;
    }
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
    showAppSnackBar(context, SnackBar(content: Text(msg)));
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
    final bool online = ref.read(networkOnlineProvider).valueOrNull ?? true;
    if (!online) {
      final AppLocale loc = ref.read(appLocaleProvider);
      showAppSnackBar(
        context,
        SnackBar(content: Text(StringLookup.t(loc, 'loadError'))),
      );
      return;
    }
    final bool anyIncomplete = docs.any((PickingListItem d) => !_isFullyPickedLines(d));
    String? sharedIncompleteReason;
    if (anyIncomplete) {
      sharedIncompleteReason = await _showIncompleteReasonPickerForBulk();
      if (!mounted || sharedIncompleteReason == null || sharedIncompleteReason.isEmpty) {
        return;
      }
    }
    await _bulkSendToQueue(docs, sharedIncompleteReason: sharedIncompleteReason);
  }

  Future<void> _sendToControllerConfirm(
    PickingListItem doc, {
    bool alreadyCompleted = false,
  }) async {
    final AppLocale loc = ref.read(appLocaleProvider);
    try {
      if (!alreadyCompleted && doc.status != 'picked') {
        await ref.read(pickingRepositoryProvider).completePickDocument(doc.id);
      }
      await ref.read(pickingRepositoryProvider).sendToController(doc.id);
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
        showAppLocalizedError(context, loc, e);
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
          if (!_showConsolidated && profile == PickerProfileParam.controller) ...<Widget>[
            _SourceGroupTabs(
              loc: loc,
              selected: _controllerSourceGroup,
              cityCount: _countForSourceGroup(tasks, kSourceGroupCity),
              regionCount: _countForSourceGroup(tasks, kSourceGroupRegion),
              onSelected: (String group) =>
                  setState(() => _controllerSourceGroup = group),
            ),
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
            Padding(
              padding: const EdgeInsets.fromLTRB(16, 0, 16, 8),
              child: SegmentedButton<bool>(
                segments: <ButtonSegment<bool>>[
                  ButtonSegment<bool>(
                    value: false,
                    label: Text(
                      '${StringLookup.t(loc, 'controllerQueueTab')} (${_countForControllerTab(tasks, inQueue: true)})',
                    ),
                    icon: const Icon(Icons.inbox_rounded, size: 18),
                  ),
                  ButtonSegment<bool>(
                    value: true,
                    label: Text(
                      '${StringLookup.t(loc, 'controllerMineTab')} (${_countForControllerTab(tasks, inQueue: false)})',
                    ),
                    icon: const Icon(Icons.assignment_ind_rounded, size: 18),
                  ),
                ],
                selected: <bool>{_controllerShowMine},
                onSelectionChanged: (Set<bool> next) =>
                    setState(() => _controllerShowMine = next.single),
              ),
            ),
          ],
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
                        if (profile != PickerProfileParam.controller) {
                          return Center(
                            child: Text(StringLookup.t(loc, 'openTasksEmpty')),
                          );
                        }
                        return Center(
                          child: Padding(
                            padding: const EdgeInsets.all(24),
                            child: Text(
                              StringLookup.tParams(
                                loc,
                                _controllerShowMine
                                    ? 'controllerMineEmptyIn'
                                    : 'controllerQueueEmptyIn',
                                <String, String>{
                                  'group': StringLookup.t(
                                    loc,
                                    _controllerSourceGroup == kSourceGroupRegion
                                        ? 'sourceGroupRegion'
                                        : 'sourceGroupCity',
                                  ),
                                },
                              ),
                              textAlign: TextAlign.center,
                            ),
                          ),
                        );
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
                                  onOpen: () {
                                    if (profile == PickerProfileParam.controller &&
                                        controllerDocIsInQueue(item)) {
                                      unawaited(_openQueueDocument(item));
                                      return;
                                    }
                                    unawaited(
                                      context.pushNamed(
                                        'pickTaskDetail',
                                        pathParameters: <String, String>{
                                          'taskId': item.id,
                                        },
                                        queryParameters: <String, String>{
                                          'profile': profileToQuery(profile),
                                        },
                                      ),
                                    );
                                  },
                                  onSendToController: profile == PickerProfileParam.picker
                                      ? () => _onSendToControllerPress(item)
                                      : null,
                                  onReleaseToQueue: profile ==
                                              PickerProfileParam.controller &&
                                          controllerCanReleaseToQueue(item)
                                      ? () => unawaited(_releaseToQueue(item))
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

/// Controller ro'yxatining yuqori darajasi: manba guruhi tablari.
class _SourceGroupTabs extends StatelessWidget {
  const _SourceGroupTabs({
    required this.loc,
    required this.selected,
    required this.cityCount,
    required this.regionCount,
    required this.onSelected,
  });

  final AppLocale loc;
  final String selected;
  final int cityCount;
  final int regionCount;
  final void Function(String group) onSelected;

  @override
  Widget build(BuildContext context) {
    final ColorScheme cs = Theme.of(context).colorScheme;
    return Container(
      decoration: BoxDecoration(
        border: Border(
          bottom: BorderSide(color: cs.outlineVariant.withValues(alpha: 0.5)),
        ),
      ),
      child: Row(
        children: <Widget>[
          _tab(
            context,
            group: kSourceGroupCity,
            label: StringLookup.t(loc, 'sourceGroupCity'),
            count: cityCount,
          ),
          _tab(
            context,
            group: kSourceGroupRegion,
            label: StringLookup.t(loc, 'sourceGroupRegion'),
            count: regionCount,
          ),
        ],
      ),
    );
  }

  Widget _tab(
    BuildContext context, {
    required String group,
    required String label,
    required int count,
  }) {
    final ColorScheme cs = Theme.of(context).colorScheme;
    final bool active = selected == group;
    return Expanded(
      child: InkWell(
        onTap: () => onSelected(group),
        child: Container(
          padding: const EdgeInsets.symmetric(vertical: 12),
          decoration: BoxDecoration(
            border: Border(
              bottom: BorderSide(
                color: active ? cs.primary : Colors.transparent,
                width: 2.5,
              ),
            ),
          ),
          child: Text(
            '$label ($count)',
            textAlign: TextAlign.center,
            style: TextStyle(
              fontWeight: active ? FontWeight.w700 : FontWeight.w500,
              color: active ? cs.primary : cs.onSurfaceVariant,
            ),
          ),
        ),
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
    this.onReleaseToQueue,
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
  final void Function()? onReleaseToQueue;

  @override
  Widget build(BuildContext context) {
    final bool fully = item.linesTotal > 0 && item.linesDone >= item.linesTotal;
    final bool useGreenListStyle =
        profile != PickerProfileParam.controller && fully;
    final bool showSend = pickerCanSendToController(item, profile);
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
                  Wrap(
                    spacing: 6,
                    runSpacing: 6,
                    children: <Widget>[
                      Container(
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
                      // "Menda" bo'limida ikki guruh aralashadi — manba ko'rinib tursin.
                      if (profile == PickerProfileParam.controller)
                        Container(
                          padding:
                              const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
                          decoration: BoxDecoration(
                            color: cs.secondaryContainer.withValues(alpha: 0.9),
                            borderRadius: BorderRadius.circular(20),
                          ),
                          child: Text(
                            StringLookup.t(
                              loc,
                              item.sourceGroup == kSourceGroupRegion
                                  ? 'sourceGroupRegion'
                                  : 'sourceGroupCity',
                            ),
                            style: TextStyle(
                              fontSize: 12,
                              fontWeight: FontWeight.w600,
                              color: cs.onSecondaryContainer,
                            ),
                          ),
                        ),
                    ],
                  ),
                  if (profile == PickerProfileParam.picker &&
                      item.status == 'picked' &&
                      item.sentToControllerAt != null) ...<Widget>[
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
        if (showSend && onSendToController != null)
          Padding(
            padding: const EdgeInsets.only(top: 8),
            child: FilledButton.tonal(
              onPressed: onSendToController,
              child: Text(StringLookup.t(loc, 'sendToController')),
            ),
          ),
        if (onReleaseToQueue != null)
          Padding(
            padding: const EdgeInsets.only(top: 8),
            child: OutlinedButton.icon(
              onPressed: onReleaseToQueue,
              icon: const Icon(Icons.undo_rounded, size: 18),
              label: Text(StringLookup.t(loc, 'releaseToQueue')),
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


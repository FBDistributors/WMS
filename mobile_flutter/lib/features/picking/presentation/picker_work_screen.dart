import 'dart:async' show unawaited;

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../core/errors/api_error_localization.dart';
import '../../../core/app_state/app_locale.dart';
import '../../../core/app_state/locale_controller.dart';
import '../../../core/app_state/theme_controller.dart';
import '../../../l10n/string_lookup.dart';
import '../../../shared/feedback/app_top_snackbar.dart';
import '../../../shared/input/input_clear_button.dart';
import '../data/picking_models.dart';
import '../picking_providers.dart';

bool _pickerLineVisuallyComplete(PickingLine l) =>
    l.isVipExpiryInformational || l.qtyPicked >= l.qtyRequired;

List<PickingLine> _orderedPickLines(List<PickingLine> lines) {
  final List<PickingLine> incomplete =
      lines.where((PickingLine l) => !_pickerLineVisuallyComplete(l)).toList();
  final List<PickingLine> complete =
      lines.where((PickingLine l) => _pickerLineVisuallyComplete(l)).toList();
  return <PickingLine>[...incomplete, ...complete];
}

String _pickerWorkBarcodeSkuLine(PickingLine line) =>
    '${line.barcode ?? '—'} / ${line.sku ?? '—'}';

/// RN `PickerScreen` — API orqali `pickLine` / `completePickDocument`.
class PickerWorkScreen extends ConsumerStatefulWidget {
  const PickerWorkScreen({super.key, this.taskId});

  final String? taskId;

  @override
  ConsumerState<PickerWorkScreen> createState() => _PickerWorkScreenState();
}

class _PickerWorkScreenState extends ConsumerState<PickerWorkScreen> {
  PickingDocument? _doc;
  List<PickingLine> _lines = const <PickingLine>[];
  bool _loading = true;
  String? _error;
  final TextEditingController _barcode = TextEditingController();
  final TextEditingController _search = TextEditingController();
  bool _completing = false;
  bool _lineBusy = false;

  String _tr(String key) => StringLookup.t(ref.read(appLocaleProvider), key);

  String get _effectiveTaskId =>
      widget.taskId?.trim().isNotEmpty == true ? widget.taskId!.trim() : '';

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) => _load());
  }

  @override
  void dispose() {
    _barcode.dispose();
    _search.dispose();
    super.dispose();
  }

  Future<void> _load() async {
    final String id = _effectiveTaskId;
    if (id.isEmpty) {
      setState(() {
        _loading = false;
        _error = 'taskId yo‘q';
      });
      return;
    }
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final PickingDocument d =
          await ref.read(pickingRepositoryProvider).getTaskById(id);
      if (mounted) {
        setState(() {
          _doc = d;
          _lines = List<PickingLine>.from(d.lines);
          _loading = false;
        });
      }
    } on Exception catch (e) {
      if (mounted) {
        setState(() {
          _error = '$e';
          _loading = false;
        });
      }
    }
  }

  Future<void> _applyDelta(String lineId, int delta) async {
    final String id = _effectiveTaskId;
    if (id.isEmpty || _lineBusy) {
      return;
    }
    PickingLine? line;
    for (final PickingLine l in _lines) {
      if (l.id == lineId) {
        line = l;
        break;
      }
    }
    if (line == null) {
      return;
    }
    if (line.isVipExpiryInformational) {
      _toast(_tr('vipExpiryNotPickedDetail'));
      return;
    }
    if (delta > 0 && line.qtyPicked >= line.qtyRequired) {
      _toast(_tr('pickerQtyExceeded'));
      return;
    }
    if (delta < 0 && line.qtyPicked <= 0) {
      _toast(_tr('pickerQtyBelowZero'));
      return;
    }
    setState(() => _lineBusy = true);
    try {
      final String reqId = 'picker-$id-$lineId-${DateTime.now().millisecondsSinceEpoch}';
      final PickLineResponse res =
          await ref.read(pickingRepositoryProvider).pickLine(lineId, delta, reqId);
      if (!mounted) {
        return;
      }
      setState(() {
        _lines = _lines
            .map((PickingLine l) => l.id == res.line.id ? res.line : l)
            .toList(growable: false);
        if (_doc != null) {
          _doc = PickingDocument(
            id: _doc!.id,
            referenceNumber: _doc!.referenceNumber,
            status: res.documentStatus,
            lines: _lines,
            progress: res.progress,
            incompleteReason: _doc!.incompleteReason,
            assignedToUserId: _doc!.assignedToUserId,
            assignedToUserName: _doc!.assignedToUserName,
            orderNumber: _doc!.orderNumber,
            orderWmsStatus: _doc!.orderWmsStatus,
            safeCancelReturnSessionId: _doc!.safeCancelReturnSessionId,
          );
        }
      });
    } on Exception catch (e) {
      if (mounted) {
        _toast(localizeApiErrorMessage(ref.read(appLocaleProvider), e));
      }
    } finally {
      if (mounted) {
        setState(() => _lineBusy = false);
      }
    }
  }

  void _toast(String msg) {
    showAppSnackBar(context, SnackBar(content: Text(msg)));
  }

  void _onBarcodeSubmit() {
    final String value = _barcode.text.trim();
    if (value.isEmpty) {
      return;
    }
    final String q = value.toLowerCase();
    PickingLine? matched;
    for (final PickingLine l in _lines) {
      final bool byBarcode =
          l.barcode != null && l.barcode!.toLowerCase() == q;
      final bool bySku = l.sku != null && l.sku!.toLowerCase() == q;
      final bool byName = l.productName.toLowerCase().contains(q);
      if (byBarcode || bySku || byName) {
        matched = l;
        break;
      }
    }
    if (matched == null) {
      _toast(_tr('pickerNotFound'));
      _barcode.clear();
      return;
    }
    if (matched.isVipExpiryInformational) {
      _toast(_tr('vipExpiryNotPickedDetail'));
      _barcode.clear();
      return;
    }
    if (matched.qtyPicked >= matched.qtyRequired) {
      _toast(_tr('pickerLineAlreadyFilled'));
      _barcode.clear();
      return;
    }
    unawaited(_applyDelta(matched.id, 1));
    _barcode.clear();
  }

  Future<void> _complete() async {
    final PickingDocument? d = _doc;
    final String id = _effectiveTaskId;
    if (d == null || id.isEmpty || _completing) {
      return;
    }
    setState(() => _completing = true);
    try {
      await ref.read(pickingRepositoryProvider).completePickDocument(id);
      if (mounted) {
        context.pop();
      }
    } on Exception catch (e) {
      if (mounted) {
        _toast(localizeApiErrorMessage(ref.read(appLocaleProvider), e));
      }
    } finally {
      if (mounted) {
        setState(() => _completing = false);
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final AppLocale loc = ref.watch(appLocaleProvider);
    final bool isDark = ref.watch(appThemeModeProvider) == ThemeMode.dark;

    if (_loading) {
      return Scaffold(
        appBar: AppBar(title: Text(StringLookup.t(loc, 'openTasks'))),
        body: const Center(child: CircularProgressIndicator()),
      );
    }
    if (_error != null) {
      return Scaffold(
        appBar: AppBar(title: const Text('Picker')),
        body: Center(
          child: Column(
            mainAxisAlignment: MainAxisAlignment.center,
            children: <Widget>[
              Text(_error!),
              FilledButton(onPressed: _load, child: Text(StringLookup.t(loc, 'retry'))),
            ],
          ),
        ),
      );
    }

    final PickingDocument? d = _doc;
    final String sq = _search.text.trim().toLowerCase();
    final List<PickingLine> filtered = sq.isEmpty
        ? _lines
        : _lines
            .where(
              (PickingLine l) =>
                  l.productName.toLowerCase().contains(sq) ||
                  (l.sku != null && l.sku!.toLowerCase().contains(sq)) ||
                  (l.barcode != null && l.barcode!.toLowerCase().contains(sq)),
            )
            .toList();
    final List<PickingLine> shown = _orderedPickLines(filtered);

    final double picked = d?.progress.picked ??
        _lines.fold<double>(0, (double s, PickingLine l) => s + l.qtyPicked);
    final double required = d?.progress.required ??
        _lines.fold<double>(0, (double s, PickingLine l) => s + l.qtyRequired);

    return Scaffold(
      backgroundColor: isDark ? const Color(0xFF0F172A) : const Color(0xFFF5F5F5),
      appBar: AppBar(
        title: Text(d?.referenceNumber ?? 'Picker'),
        leading: IconButton(
          icon: const Icon(Icons.arrow_back),
          onPressed: () => context.pop(),
        ),
      ),
      body: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: <Widget>[
          Padding(
            padding: const EdgeInsets.all(12),
            child: Text(
              '${formatPickQty(picked)} / ${formatPickQty(required)} · ${d?.status ?? ''}',
              style: Theme.of(context).textTheme.titleMedium,
            ),
          ),
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: 12),
            child: TextField(
              controller: _search,
              decoration: InputDecoration(
                labelText: 'Qidiruv',
                border: const OutlineInputBorder(),
                suffixIcon: buildInputClearButton(
                  visible: _search.text.trim().isNotEmpty,
                  onPressed: () => setState(() => _search.clear()),
                ),
              ),
              onChanged: (_) => setState(() {}),
            ),
          ),
          const SizedBox(height: 8),
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: 12),
            child: Row(
              children: <Widget>[
                Expanded(
                  child: TextField(
                    controller: _barcode,
                    decoration: InputDecoration(
                      labelText: StringLookup.t(loc, 'barcodeOrSku'),
                      border: const OutlineInputBorder(),
                      suffixIcon: buildInputClearButton(
                        visible: _barcode.text.trim().isNotEmpty,
                        onPressed: () => setState(() => _barcode.clear()),
                      ),
                    ),
                    onChanged: (_) => setState(() {}),
                    onSubmitted: (_) => _onBarcodeSubmit(),
                  ),
                ),
                const SizedBox(width: 8),
                FilledButton(
                  onPressed: _lineBusy ? null : _onBarcodeSubmit,
                  child: Text(StringLookup.t(loc, 'submit')),
                ),
              ],
            ),
          ),
          Expanded(
            child: ListView.builder(
              padding: const EdgeInsets.all(12),
              itemCount: shown.length,
              itemBuilder: (BuildContext context, int i) {
                final PickingLine line = shown[i];
                final bool lineComplete = _pickerLineVisuallyComplete(line);
                final ColorScheme cs = Theme.of(context).colorScheme;
                final bool buildDark =
                    Theme.of(context).brightness == Brightness.dark;
                final Color? cardColor = line.isVipExpiryInformational
                    ? Colors.red.withValues(alpha: buildDark ? 0.22 : 0.12)
                    : lineComplete
                        ? Colors.green.withValues(alpha: buildDark ? 0.20 : 0.14)
                        : null;
                return Card(
                  color: cardColor,
                  child: Padding(
                    padding: const EdgeInsets.all(8),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: <Widget>[
                        Row(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: <Widget>[
                            Expanded(
                              child: Text(
                                line.productName,
                                style: const TextStyle(fontWeight: FontWeight.w600),
                              ),
                            ),
                            if (lineComplete)
                              Icon(
                                Icons.check_circle_rounded,
                                color: Colors.green.shade700,
                                size: 22,
                              ),
                          ],
                        ),
                        const SizedBox(height: 4),
                        Text(
                          _pickerWorkBarcodeSkuLine(line),
                          style: TextStyle(
                            fontSize: 13,
                            color: cs.onSurfaceVariant,
                            fontFamily: 'monospace',
                          ),
                          maxLines: 2,
                          overflow: TextOverflow.ellipsis,
                        ),
                        Text(
                          line.isVipExpiryInformational
                              ? '${StringLookup.t(loc, 'vipExpiryNotPickedDetail')} · ${formatPickQty(line.qtyRequired)}'
                              : '${line.locationCode} · ${formatPickQty(line.qtyPicked)}/${formatPickQty(line.qtyRequired)}',
                          style: TextStyle(
                            color: line.isVipExpiryInformational
                                ? Colors.red.shade800
                                : lineComplete
                                    ? Colors.green.shade700
                                    : cs.onSurfaceVariant,
                          ),
                        ),
                        if (!line.isVipExpiryInformational)
                          Row(
                            children: <Widget>[
                              IconButton(
                                onPressed: _lineBusy ? null : () => _applyDelta(line.id, -1),
                                icon: const Icon(Icons.remove_circle_outline),
                              ),
                              IconButton(
                                onPressed: _lineBusy ? null : () => _applyDelta(line.id, 1),
                                icon: const Icon(Icons.add_circle_outline),
                              ),
                            ],
                          ),
                      ],
                    ),
                  ),
                );
              },
            ),
          ),
          SafeArea(
            child: Padding(
              padding: const EdgeInsets.all(12),
              child: FilledButton(
                onPressed: _completing ? null : _complete,
                child: _completing
                    ? const SizedBox(
                        height: 22,
                        width: 22,
                        child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white),
                      )
                    : const Text('Yakunlash'),
              ),
            ),
          ),
        ],
      ),
    );
  }
}

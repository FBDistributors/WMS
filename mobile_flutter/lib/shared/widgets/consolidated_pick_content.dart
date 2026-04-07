import 'dart:math' show max;

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../core/app_state/app_locale.dart';
import '../../core/app_state/locale_controller.dart';
import '../../core/app_state/network_status_provider.dart';
import '../../core/router/scanner_args.dart';
import '../../features/picking/data/picking_models.dart';
import '../../features/picking/domain/profile_type_param.dart';
import '../../features/picking/picking_providers.dart';
import '../../l10n/string_lookup.dart';

/// RN `ConsolidatedPickContent` — mahsulotlar ro‘yxati, pozitsiya bosilganda modal + skaner.
class ConsolidatedPickContent extends ConsumerStatefulWidget {
  const ConsolidatedPickContent({
    super.key,
    this.refreshVersion = 0,
    this.pendingScannedBarcode,
    this.restoreConsolidatedProductKey,
    this.onClearPendingScan,
    this.onAfterSuccessfulPick,
  });

  final int refreshVersion;
  final String? pendingScannedBarcode;
  final String? restoreConsolidatedProductKey;
  final VoidCallback? onClearPendingScan;
  final VoidCallback? onAfterSuccessfulPick;

  @override
  ConsumerState<ConsolidatedPickContent> createState() =>
      _ConsolidatedPickContentState();
}

class _ConsolidatedPickContentState extends ConsumerState<ConsolidatedPickContent> {
  String? _lastRestoreSig;

  @override
  void didUpdateWidget(covariant ConsolidatedPickContent oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.refreshVersion != widget.refreshVersion) {
      ref.invalidate(consolidatedViewProvider);
    }
    if (widget.restoreConsolidatedProductKey == null &&
        widget.pendingScannedBarcode == null) {
      _lastRestoreSig = null;
    }
  }

  void _tryApplyRouteRestore(ConsolidatedViewResponse v) {
    final String? key = widget.restoreConsolidatedProductKey;
    if (key == null || key.isEmpty) {
      return;
    }
    final String? pending = widget.pendingScannedBarcode;
    final String sig = '$key|${pending ?? ''}';
    if (_lastRestoreSig == sig) {
      return;
    }

    ConsolidatedProduct? prod;
    for (final ConsolidatedProduct p in v.products) {
      if (consolidatedProductKey(p) == key) {
        prod = p;
        break;
      }
    }

    if (prod == null) {
      _lastRestoreSig = sig;
      widget.onClearPendingScan?.call();
      return;
    }

    if (pending != null && pending.isNotEmpty) {
      if (!consolidatedScanMatchesProduct(pending, prod)) {
        _lastRestoreSig = sig;
        widget.onClearPendingScan?.call();
        WidgetsBinding.instance.addPostFrameCallback((_) {
          if (!mounted) {
            return;
          }
          final AppLocale loc = ref.read(appLocaleProvider);
          ScaffoldMessenger.of(context).showSnackBar(
            SnackBar(content: Text(StringLookup.t(loc, 'consolidatedScanMismatch'))),
          );
        });
        return;
      }
    }

    _lastRestoreSig = sig;
    widget.onClearPendingScan?.call();
    final ConsolidatedProduct openProd = prod;
    final String? pre = pending != null && pending.trim().isNotEmpty ? pending.trim() : null;
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (!mounted) {
        return;
      }
      _openPickSheet(context, openProd, verifiedBarcode: pre);
    });
  }

  Future<void> _openPickSheet(
    BuildContext host,
    ConsolidatedProduct product, {
    String? verifiedBarcode,
  }) async {
    final bool online = ref.read(networkOnlineProvider).valueOrNull ?? true;
    if (!online) {
      final AppLocale loc = ref.read(appLocaleProvider);
      ScaffoldMessenger.of(host).showSnackBar(
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

    final AppLocale loc = ref.read(appLocaleProvider);
    final TextEditingController bc = TextEditingController();
    final TextEditingController qty = TextEditingController();
    String? scannedForQty = verifiedBarcode;
    if (scannedForQty != null) {
      qty.text = '${max(1, product.totalRequired - product.totalPicked)}';
    }

    await showModalBottomSheet<void>(
      context: host,
      isScrollControlled: true,
      builder: (BuildContext ctx) {
        bool sheetBusy = false;
        return StatefulBuilder(
          builder: (BuildContext context, void Function(void Function()) setM) {
            return Padding(
              padding: EdgeInsets.only(bottom: MediaQuery.viewInsetsOf(context).bottom),
              child: SingleChildScrollView(
                padding: const EdgeInsets.all(20),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  mainAxisSize: MainAxisSize.min,
                  children: <Widget>[
                    Row(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: <Widget>[
                        Expanded(
                          child: Text(
                            product.productName,
                            style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 17),
                          ),
                        ),
                        IconButton(
                          icon: const Icon(Icons.close_rounded),
                          onPressed: sheetBusy ? null : () => Navigator.of(ctx).pop(),
                        ),
                      ],
                    ),
                    Text(
                      '${product.barcode ?? '—'} / ${product.sku ?? '—'}',
                      style: TextStyle(
                        fontSize: 13,
                        color: Theme.of(context).colorScheme.onSurfaceVariant,
                        fontFamily: 'monospace',
                      ),
                    ),
                    if (product.alternateLocations.isNotEmpty) ...<Widget>[
                      const SizedBox(height: 12),
                      Text(
                        StringLookup.t(loc, 'alternateLocations'),
                        style: const TextStyle(fontWeight: FontWeight.w600, fontSize: 13),
                      ),
                      const SizedBox(height: 6),
                      ...product.alternateLocations.map(
                        (PickingAlternateLocation a) => ListTile(
                          dense: true,
                          contentPadding: EdgeInsets.zero,
                          title: Text(a.locationCode),
                          subtitle: Text('${a.availableQty}'),
                        ),
                      ),
                    ],
                    const SizedBox(height: 16),
                    if (scannedForQty == null) ...<Widget>[
                      Text(
                        StringLookup.t(loc, 'consolidatedModalScanHint'),
                        style: TextStyle(
                          fontSize: 14,
                          color: Theme.of(context).colorScheme.onSurfaceVariant,
                        ),
                      ),
                      const SizedBox(height: 12),
                      FilledButton.icon(
                        onPressed: sheetBusy
                            ? null
                            : () {
                                Navigator.of(ctx).pop();
                                host.pushNamed(
                                  'scanner',
                                  extra: ScannerArgs(
                                    returnToConsolidated: true,
                                    profileType: PickerProfileParam.picker,
                                    selectedProductKey: consolidatedProductKey(product),
                                  ),
                                );
                              },
                        icon: const Icon(Icons.qr_code_scanner_rounded),
                        label: Text(StringLookup.t(loc, 'scanButton')),
                      ),
                      const SizedBox(height: 8),
                      Text(
                        StringLookup.t(loc, 'orEnterManually'),
                        style: TextStyle(
                          fontSize: 13,
                          color: Theme.of(context).colorScheme.onSurfaceVariant,
                        ),
                      ),
                      const SizedBox(height: 8),
                      TextField(
                        controller: bc,
                        decoration: InputDecoration(
                          labelText: StringLookup.t(loc, 'barcodeOrSku'),
                          border: const OutlineInputBorder(),
                        ),
                        onSubmitted: (String v) {
                          final String t = v.trim();
                          if (t.isEmpty) {
                            return;
                          }
                          if (!consolidatedScanMatchesProduct(t, product)) {
                            ScaffoldMessenger.of(host).showSnackBar(
                              SnackBar(
                                content: Text(StringLookup.t(loc, 'consolidatedScanMismatch')),
                              ),
                            );
                            return;
                          }
                          setM(() {
                            scannedForQty = t;
                            qty.text =
                                '${max(1, product.totalRequired - product.totalPicked)}';
                          });
                        },
                      ),
                      const SizedBox(height: 12),
                      FilledButton(
                        onPressed: sheetBusy
                            ? null
                            : () {
                            final String t = bc.text.trim();
                            if (t.isEmpty) {
                              return;
                            }
                            if (!consolidatedScanMatchesProduct(t, product)) {
                              ScaffoldMessenger.of(host).showSnackBar(
                                SnackBar(
                                  content:
                                      Text(StringLookup.t(loc, 'consolidatedScanMismatch')),
                                ),
                              );
                              return;
                            }
                            setM(() {
                              scannedForQty = t;
                              qty.text =
                                  '${max(1, product.totalRequired - product.totalPicked)}';
                            });
                          },
                        child: Text(StringLookup.t(loc, 'submit')),
                      ),
                    ] else ...<Widget>[
                      Text(
                        StringLookup.tParams(
                          loc,
                          'quantityRemainingLine',
                          <String, String>{
                            'n': '${product.totalRequired - product.totalPicked}',
                          },
                        ),
                        style: TextStyle(
                          fontSize: 14,
                          color: Theme.of(context).colorScheme.onSurfaceVariant,
                        ),
                      ),
                      const SizedBox(height: 12),
                      TextField(
                        controller: qty,
                        keyboardType: TextInputType.number,
                        inputFormatters: <TextInputFormatter>[
                          FilteringTextInputFormatter.digitsOnly,
                        ],
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
                            final int q = int.tryParse(qty.text.trim()) ?? 0;
                            final int rem = product.totalRequired - product.totalPicked;
                            if (q < 1 || q > rem) {
                              ScaffoldMessenger.of(host).showSnackBar(
                                SnackBar(
                                  content: Text(
                                    StringLookup.tParams(
                                      loc,
                                      'qtyRangeError',
                                      <String, String>{'max': '$rem'},
                                    ),
                                  ),
                                ),
                              );
                              return;
                            }
                            setM(() => sheetBusy = true);
                            try {
                              await ref.read(pickingRepositoryProvider).consolidatedPick(
                                    barcode: scannedForQty!,
                                    qty: q,
                                    requestId:
                                        'consolidated-${DateTime.now().millisecondsSinceEpoch}',
                                  );
                              ref.invalidate(consolidatedViewProvider);
                              widget.onAfterSuccessfulPick?.call();
                              if (ctx.mounted) {
                                Navigator.of(ctx).pop();
                              }
                            } on Exception catch (e) {
                              if (ctx.mounted) {
                                ScaffoldMessenger.of(host).showSnackBar(
                                  SnackBar(content: Text('$e')),
                                );
                              }
                            } finally {
                              if (context.mounted) {
                                setM(() => sheetBusy = false);
                              }
                            }
                          },
                        child: Text(StringLookup.t(loc, 'confirmButton')),
                      ),
                    ],
                  ],
                ),
              ),
            );
          },
        );
      },
    );

    bc.dispose();
    qty.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final AppLocale loc = ref.watch(appLocaleProvider);
    final AsyncValue<ConsolidatedViewResponse> view =
        ref.watch(consolidatedViewProvider);
    final ColorScheme cs = Theme.of(context).colorScheme;

    return view.when(
      data: (ConsolidatedViewResponse v) {
        final String? rk = widget.restoreConsolidatedProductKey;
        if (rk != null && rk.isNotEmpty) {
          WidgetsBinding.instance.addPostFrameCallback((_) {
            if (mounted) {
              _tryApplyRouteRestore(v);
            }
          });
        }

        if (v.products.isEmpty) {
          return Center(
            child: Padding(
              padding: const EdgeInsets.all(24),
              child: Text(
                StringLookup.t(loc, 'consolidatedEmptyRows'),
                textAlign: TextAlign.center,
                style: TextStyle(color: cs.onSurfaceVariant, fontSize: 15),
              ),
            ),
          );
        }
        return ListView.separated(
          padding: const EdgeInsets.fromLTRB(12, 4, 12, 16),
          itemCount: v.products.length,
          separatorBuilder: (_, __) => const SizedBox(height: 8),
          itemBuilder: (BuildContext context, int i) {
            final ConsolidatedProduct p = v.products[i];
            final int req = p.totalRequired;
            final int done = p.totalPicked;
            final double ratio = req > 0 ? (done / req).clamp(0.0, 1.0) : 0.0;
            final String code = p.barcode ?? p.sku ?? '—';
            return Material(
              color: cs.surfaceContainerHighest.withValues(alpha: 0.35),
              borderRadius: BorderRadius.circular(12),
              child: InkWell(
                borderRadius: BorderRadius.circular(12),
                onTap: () => _openPickSheet(context, p),
                child: Padding(
                  padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: <Widget>[
                      Text(
                        p.productName,
                        style: const TextStyle(
                          fontWeight: FontWeight.w600,
                          fontSize: 15,
                        ),
                      ),
                      const SizedBox(height: 4),
                      Text(
                        code,
                        style: TextStyle(
                          fontSize: 13,
                          color: cs.onSurfaceVariant,
                          fontFamily: 'monospace',
                        ),
                      ),
                      const SizedBox(height: 10),
                      Row(
                        children: <Widget>[
                          Expanded(
                            child: ClipRRect(
                              borderRadius: BorderRadius.circular(4),
                              child: LinearProgressIndicator(
                                value: req > 0 ? ratio : null,
                                minHeight: 6,
                                backgroundColor:
                                    cs.surfaceContainerHighest.withValues(alpha: 0.8),
                              ),
                            ),
                          ),
                          const SizedBox(width: 10),
                          Text(
                            '$done / $req',
                            style: TextStyle(
                              fontWeight: FontWeight.w600,
                              color: cs.primary,
                              fontSize: 14,
                            ),
                          ),
                        ],
                      ),
                    ],
                  ),
                ),
              ),
            );
          },
        );
      },
      loading: () => const Center(
        child: Padding(
          padding: EdgeInsets.all(24),
          child: CircularProgressIndicator(),
        ),
      ),
      error: (Object e, _) => Center(
        child: Padding(
          padding: const EdgeInsets.all(16),
          child: Text('$e', textAlign: TextAlign.center),
        ),
      ),
    );
  }
}

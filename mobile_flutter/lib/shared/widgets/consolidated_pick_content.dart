import 'dart:async';
import 'dart:math' show min;

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/app_state/app_locale.dart';
import '../../core/app_state/locale_controller.dart';
import '../../core/errors/api_error_localization.dart';
import '../../core/app_state/network_status_provider.dart';
import '../../features/picking/alternate_location_menu_label.dart'
    show mergeAlternateLocationsForDisplay, MergedAlternateLocationRow;
import '../../features/picking/data/picking_models.dart';
import '../../features/scanner/data/scanner_repository.dart';
import '../../features/scanner/scanner_providers.dart';
import '../../features/picking/picking_providers.dart';
import '../../features/product_boxes/product_box_providers.dart';
import '../../l10n/string_lookup.dart';
import '../feedback/app_top_snackbar.dart';
import '../layout/sheet_bottom_inset.dart';
import 'consolidated_pick_success_snackbar.dart';
import 'pick_box_qty_fields.dart';
import 'pick_hybrid_submit.dart';

/// Takrorlanmas joy kodlari, `lines` tartibida birinchi uchragan tartibda.
String _consolidatedUniqueLocationsLine(ConsolidatedProduct p) {
  if (p.lines.isEmpty) {
    return '—';
  }
  final List<String> ordered = <String>[];
  final Set<String> seen = <String>{};
  for (final ConsolidatedLineItem l in p.lines) {
    final String c = l.locationCode.trim();
    if (c.isEmpty || seen.contains(c)) {
      continue;
    }
    seen.add(c);
    ordered.add(c);
  }
  if (ordered.isEmpty) {
    return '—';
  }
  return ordered.join(', ');
}

String _alternateLocationDropdownValue(PickingAlternateLocation a) =>
    '${a.locationId}\u001f${a.lotId}';

PickingAlternateLocation? _alternateLocationForDropdownValue(
  ConsolidatedProduct product,
  String value,
) {
  for (final PickingAlternateLocation a in product.alternateLocations) {
    if (_alternateLocationDropdownValue(a) == value) {
      return a;
    }
  }
  return null;
}

/// RN `ConsolidatedPickContent` — mahsulotlar ro‘yxati, pozitsiya bosilganda modal + skaner.
class ConsolidatedPickContent extends ConsumerStatefulWidget {
  const ConsolidatedPickContent({
    super.key,
    this.refreshVersion = 0,
    this.onPullRefresh,
    this.pendingScannedBarcode,
    this.restoreConsolidatedProductKey,
    this.onClearPendingScan,
    this.onAfterSuccessfulPick,
  });

  final int refreshVersion;
  /// Pastga tortib yangilash (masalan topshiriqlar ro‘yxati umumiy yig‘ish rejimi).
  final Future<void> Function()? onPullRefresh;
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
      unawaited(ref.read(consolidatedViewProvider.notifier).refreshFromNetwork());
    }
    if (widget.restoreConsolidatedProductKey == null &&
        widget.pendingScannedBarcode == null) {
      _lastRestoreSig = null;
    }
  }

  Future<bool> _consolidatedPendingMatchesProduct(
    String pending,
    ConsolidatedProduct prod,
  ) async {
    if (consolidatedScanMatchesProduct(pending, prod)) {
      return true;
    }
    try {
      final ScannerResolveOut out =
          await ref.read(scannerRepositoryProvider).resolveBarcode(pending);
      if (out.type == ScannerResolveType.product && out.productId != null) {
        return consolidatedScanMatchesResolvedProduct(
          p: prod,
          resolvedProductId: out.productId,
          rawBarcode: pending,
        );
      }
    } on Object {
      /* offline */
    }
    return false;
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
      final ConsolidatedProduct matched = prod;
      unawaited(() async {
        final bool ok = await _consolidatedPendingMatchesProduct(pending, matched);
        if (!mounted) {
          return;
        }
        if (!ok) {
          _lastRestoreSig = sig;
          widget.onClearPendingScan?.call();
          final AppLocale loc = ref.read(appLocaleProvider);
          showAppSnackBar(
            context,
            SnackBar(content: Text(StringLookup.t(loc, 'consolidatedScanMismatch'))),
          );
          return;
        }
        _lastRestoreSig = sig;
        widget.onClearPendingScan?.call();
        final String? pre = pending.trim().isNotEmpty ? pending.trim() : null;
        await _openPickSheet(context, matched, verifiedBarcode: pre);
      }());
      return;
    }

    _lastRestoreSig = sig;
    widget.onClearPendingScan?.call();
    final ConsolidatedProduct openProd = prod;
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (!mounted) {
        return;
      }
      unawaited(_openPickSheet(context, openProd));
    });
  }

  Future<void> _switchConsolidatedPickToAlternate({
    required BuildContext host,
    required BuildContext modalCtx,
    required BuildContext sheetBodyContext,
    required ConsolidatedProduct product,
    required PickingAlternateLocation alternate,
    required AppLocale loc,
    required void Function(bool busy) setSheetBusy,
  }) async {
    final bool online = ref.read(networkOnlineProvider).valueOrNull ?? true;
    if (!online) {
      showAppSnackBar(
        host,
        SnackBar(content: Text(StringLookup.t(loc, 'pickSwitchSourceOffline'))),
      );
      return;
    }
    final List<ConsolidatedLineItem> targets = product.lines
        .where((ConsolidatedLineItem l) => l.qtyPicked < l.qtyRequired)
        .toList();
    if (targets.isEmpty) {
      showAppSnackBar(
        host,
        SnackBar(
          content: Text(StringLookup.t(loc, 'consolidatedNoOpenLinesForSwitch')),
        ),
      );
      return;
    }
    setSheetBusy(true);
    try {
      for (final ConsolidatedLineItem l in targets) {
        await ref.read(pickingRepositoryProvider).changePickSource(
              l.lineId,
              locationId: alternate.locationId,
              lotId: alternate.lotId,
            );
      }
      await ref.read(consolidatedViewProvider.notifier).refreshFromNetwork();
      widget.onAfterSuccessfulPick?.call();
      if (modalCtx.mounted) {
        showAppSnackBar(
        host,
          SnackBar(content: Text(StringLookup.t(loc, 'pickSwitchSourceDone'))),
        );
        Navigator.of(modalCtx).pop();
      }
    } on Exception catch (e) {
      if (modalCtx.mounted) {
        showAppSnackBar(host, SnackBar(content: Text(localizeApiErrorMessage(loc, e))));
      }
    } finally {
      if (sheetBodyContext.mounted) {
        setSheetBusy(false);
      }
    }
  }

  Future<void> _openPickSheet(
    BuildContext host,
    ConsolidatedProduct product, {
    String? verifiedBarcode,
  }) async {
    final bool online = ref.read(networkOnlineProvider).valueOrNull ?? true;
    if (!online) {
      final AppLocale loc = ref.read(appLocaleProvider);
      showAppSnackBar(
        host,
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
    final double rem = product.totalRequired - product.totalPicked;
    int? unitsPerBox = hybridUnitsPerBoxHint(
      unitsPerBox: null,
      alternates: product.alternateLocations,
    );
    final List<ConsolidatedLineItem> openPickLines = product.lines
        .where((ConsolidatedLineItem l) => l.qtyPicked < l.qtyRequired)
        .toList();
    final String pickLocationCode =
        openPickLines.isNotEmpty ? openPickLines.first.locationCode : '';
    final ({int? looseUnits, int? boxCount}) locationAltHint =
        alternateBoxHintForLocation(
      product.alternateLocations,
      pickLocationCode,
    );
    final TextEditingController boxCountCtrl = TextEditingController();
    final TextEditingController looseQtyCtrl = TextEditingController();
    final TextEditingController boxBarcodeCtrl = TextEditingController();
    final TextEditingController productBarcodeCtrl = TextEditingController();
    applyConsolidatedHybridQtyDefaults(
      boxCount: boxCountCtrl,
      looseQty: looseQtyCtrl,
      unitsPerBox: unitsPerBox,
      maxUnits: rem,
      lines: product.lines,
      suggestedBoxCount: product.suggestedBoxCount,
      suggestedLooseQty: product.suggestedLooseQty,
      stockBoxCount: locationAltHint.boxCount,
      stockLooseUnits: locationAltHint.looseUnits,
    );
    if (verifiedBarcode != null && verifiedBarcode.trim().isNotEmpty) {
      final String raw = verifiedBarcode.trim();
      try {
        final HybridScanApplyResult scanRes = await applyHybridProductScan(
          scanner: ref.read(scannerRepositoryProvider),
          raw: raw,
          boxCount: boxCountCtrl,
          looseQty: looseQtyCtrl,
          boxBarcode: boxBarcodeCtrl,
          productBarcode: productBarcodeCtrl,
          unitsPerBox: unitsPerBox,
          maxUnits: rem,
        );
        unitsPerBox = scanRes.unitsPerBox ?? unitsPerBox;
      } on Object {
        productBarcodeCtrl.text = raw;
      }
    }
    if (unitsPerBox == null || unitsPerBox < 1) {
      final String? productId = product.productId;
      if (productId != null && productId.trim().isNotEmpty) {
        final ({int? unitsPerBox, String? boxBarcode}) boxHint =
            await loadHybridProductBoxHint(
          ref.read(productBoxRepositoryProvider),
          productId,
        );
        if (boxHint.unitsPerBox != null && boxHint.unitsPerBox! >= 1) {
          unitsPerBox = boxHint.unitsPerBox;
          applyConsolidatedHybridQtyDefaults(
            boxCount: boxCountCtrl,
            looseQty: looseQtyCtrl,
            unitsPerBox: unitsPerBox,
            maxUnits: rem,
            lines: product.lines,
            suggestedBoxCount: product.suggestedBoxCount,
            suggestedLooseQty: product.suggestedLooseQty,
            stockBoxCount: locationAltHint.boxCount,
            stockLooseUnits: locationAltHint.looseUnits,
          );
        }
      }
    }

    await showModalBottomSheet<void>(
      context: host,
      isScrollControlled: true,
      builder: (BuildContext ctx) {
        bool sheetBusy = false;
        int? sheetUnitsPerBox = unitsPerBox;
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
                      DropdownButtonFormField<String>(
                        isExpanded: true,
                        initialValue: null,
                        decoration: InputDecoration(
                          labelText: StringLookup.t(loc, 'alternateLocations'),
                          hintText: StringLookup.t(loc, 'alternateLocationHint'),
                          border: const OutlineInputBorder(),
                        ),
                        menuMaxHeight: min(
                          320,
                          MediaQuery.sizeOf(context).height * 0.45,
                        ),
                        items: mergeAlternateLocationsForDisplay(product.alternateLocations)
                            .map(
                              (MergedAlternateLocationRow row) => DropdownMenuItem<String>(
                                value: _alternateLocationDropdownValue(row.representative),
                                child: Text(
                                  row.menuLabel,
                                  maxLines: 1,
                                  overflow: TextOverflow.ellipsis,
                                ),
                              ),
                            )
                            .toList(),
                        onChanged: sheetBusy
                            ? null
                            : (String? key) async {
                                if (key == null) {
                                  return;
                                }
                                final PickingAlternateLocation? alt =
                                    _alternateLocationForDropdownValue(product, key);
                                if (alt == null) {
                                  return;
                                }
                                await _switchConsolidatedPickToAlternate(
                                  host: host,
                                  modalCtx: ctx,
                                  sheetBodyContext: context,
                                  product: product,
                                  alternate: alt,
                                  loc: loc,
                                  setSheetBusy: (bool busy) => setM(() => sheetBusy = busy),
                                );
                              },
                      ),
                    ],
                    const SizedBox(height: 16),
                    Text(
                      StringLookup.tParams(
                        loc,
                        'quantityRemainingLine',
                        <String, String>{'n': formatPickQty(rem)},
                      ),
                      style: TextStyle(
                        fontSize: 14,
                        color: Theme.of(context).colorScheme.onSurfaceVariant,
                      ),
                    ),
                    const SizedBox(height: 12),
                    ConsolidatedPickPlanBanner(
                      loc: loc,
                      product: product,
                      unitsPerBox: sheetUnitsPerBox,
                    ),
                    PickHybridQtyFields(
                      loc: loc,
                      boxCount: boxCountCtrl,
                      looseQty: looseQtyCtrl,
                      unitsPerBox: sheetUnitsPerBox,
                      maxUnits: rem,
                      looseUnits: locationAltHint.looseUnits,
                      stockBoxCount: locationAltHint.boxCount,
                      onFieldsChanged: () => setM(() {}),
                      boxBarcode: boxBarcodeCtrl,
                      productBarcode: productBarcodeCtrl,
                      busy: sheetBusy,
                      onBoxBarcodeChanged: () => setM(() {
                        if (boxBarcodeCtrl.text.trim().isEmpty) {
                          sheetUnitsPerBox = unitsPerBoxFromAlternateLocations(
                            product.alternateLocations,
                          );
                          boxCountCtrl.text = '0';
                        }
                      }),
                      onProductBarcodeChanged: () => setM(() {}),
                      onBoxBarcodeSubmitted: (String code) async {
                        final HybridScanApplyResult result = await applyHybridBoxScan(
                          scanner: ref.read(scannerRepositoryProvider),
                          raw: code,
                          boxCount: boxCountCtrl,
                          looseQty: looseQtyCtrl,
                          boxBarcode: boxBarcodeCtrl,
                          unitsPerBox: sheetUnitsPerBox,
                          maxUnits: rem,
                        );
                        setM(() {
                          if (result.unitsPerBox != null) {
                            sheetUnitsPerBox = result.unitsPerBox;
                          }
                        });
                      },
                      onProductBarcodeSubmitted: (String code) async {
                        final HybridScanApplyResult result =
                            await applyHybridProductScan(
                          scanner: ref.read(scannerRepositoryProvider),
                          raw: code,
                          boxCount: boxCountCtrl,
                          looseQty: looseQtyCtrl,
                          boxBarcode: boxBarcodeCtrl,
                          productBarcode: productBarcodeCtrl,
                          unitsPerBox: sheetUnitsPerBox,
                          maxUnits: rem,
                        );
                        setM(() {
                          if (result.unitsPerBox != null) {
                            sheetUnitsPerBox = result.unitsPerBox;
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
                            boxCount: boxCountCtrl,
                            looseQty: looseQtyCtrl,
                            boxBarcode: boxBarcodeCtrl,
                            unitsPerBox: sheetUnitsPerBox,
                            maxUnits: rem,
                          );
                          setM(() {
                            if (result.unitsPerBox != null) {
                              sheetUnitsPerBox = result.unitsPerBox;
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
                            boxCount: boxCountCtrl,
                            looseQty: looseQtyCtrl,
                            boxBarcode: boxBarcodeCtrl,
                            productBarcode: productBarcodeCtrl,
                            unitsPerBox: sheetUnitsPerBox,
                            maxUnits: rem,
                          );
                          setM(() {
                            if (result.unitsPerBox != null) {
                              sheetUnitsPerBox = result.unitsPerBox;
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
                              if ((sheetUnitsPerBox == null || sheetUnitsPerBox! < 1) &&
                                  product.productId != null) {
                                final ({int? unitsPerBox, String? boxBarcode}) boxHint =
                                    await loadHybridProductBoxHint(
                                  ref.read(productBoxRepositoryProvider),
                                  product.productId,
                                );
                                if (boxHint.unitsPerBox != null &&
                                    boxHint.unitsPerBox! >= 1) {
                                  sheetUnitsPerBox = boxHint.unitsPerBox;
                                }
                              }
                              syncHybridBoxBarcodeWithQty(
                                boxCount: boxCountCtrl,
                                boxBarcode: boxBarcodeCtrl,
                              );
                              final PickHybridQty submitHybrid =
                                  pickHybridQtyFromControllers(
                                boxCount: boxCountCtrl,
                                looseQty: looseQtyCtrl,
                                unitsPerBox: sheetUnitsPerBox,
                                maxUnits: rem,
                              );
                              final String? boxOnlyValidation =
                                  hybridBoxOnlyStockValidationMessage(
                                loc: loc,
                                hybrid: submitHybrid,
                                primaryLooseUnits: locationAltHint.looseUnits,
                                primaryBoxCount: locationAltHint.boxCount,
                              );
                              if (boxOnlyValidation != null) {
                                showAppSnackBar(
                                  host,
                                  SnackBar(content: Text(boxOnlyValidation)),
                                );
                                return;
                              }
                              final String? validation = hybridPickValidationMessage(
                                loc: loc,
                                hybrid: submitHybrid,
                                boxBarcode: boxBarcodeCtrl.text,
                                productBarcode: productBarcodeCtrl.text,
                                maxUnits: rem,
                              );
                              if (validation != null) {
                                showAppSnackBar(
                                  host,
                                  SnackBar(content: Text(validation)),
                                );
                                return;
                              }
                              setM(() => sheetBusy = true);
                              try {
                                await submitHybridPick(
                                  hybrid: submitHybrid,
                                  boxBarcode: boxBarcodeCtrl.text,
                                  productBarcode: productBarcodeCtrl.text,
                                  pickBox: ({
                                    required int qty,
                                    required int boxCount,
                                    required String barcode,
                                  }) async {
                                    await ref.read(pickingRepositoryProvider).consolidatedPick(
                                          barcode: barcode,
                                          qty: qty,
                                          requestId:
                                              'consolidated-${DateTime.now().millisecondsSinceEpoch}',
                                          boxCount: boxCount,
                                        );
                                  },
                                  pickUnit: ({
                                    required int qty,
                                    required String barcode,
                                  }) async {
                                    await ref.read(pickingRepositoryProvider).consolidatedPick(
                                          barcode: barcode,
                                          qty: qty,
                                          requestId:
                                              'consolidated-${DateTime.now().millisecondsSinceEpoch}',
                                        );
                                  },
                                  pickCombined: ({
                                    required int totalQty,
                                    required int boxCount,
                                    required String productBarcode,
                                    required String boxBarcode,
                                  }) async {
                                    await ref.read(pickingRepositoryProvider).consolidatedPick(
                                          barcode: productBarcode,
                                          qty: totalQty,
                                          requestId:
                                              'consolidated-${DateTime.now().millisecondsSinceEpoch}',
                                          boxCount: boxCount,
                                          boxBarcode: boxBarcode,
                                        );
                                  },
                                );
                                await ref
                                    .read(consolidatedViewProvider.notifier)
                                    .refreshFromNetwork();
                                widget.onAfterSuccessfulPick?.call();
                                if (ctx.mounted) {
                                  Navigator.of(ctx).pop();
                                }
                                if (host.mounted) {
                                  showConsolidatedPickSuccessSnackBar(host, loc);
                                }
                              } on HybridPickPartialFailure catch (e) {
                                if (host.mounted) {
                                  showAppSnackBar(
                                    host,
                                    SnackBar(
                                      content: Text(
                                        StringLookup.tParams(
                                          loc,
                                          'pickHybridPartialProgress',
                                          <String, String>{
                                            'picked': '${e.boxUnitsPicked}',
                                            'total': '${submitHybrid.total}',
                                          },
                                        ),
                                      ),
                                    ),
                                  );
                                }
                                await ref
                                    .read(consolidatedViewProvider.notifier)
                                    .refreshFromNetwork();
                              } on Exception catch (e) {
                                if (ctx.mounted) {
                                  showAppSnackBar(host, SnackBar(content: Text(localizeApiErrorMessage(loc, e))));
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
                ),
              ),
            );
          },
        );
      },
    );

    boxCountCtrl.dispose();
    looseQtyCtrl.dispose();
    boxBarcodeCtrl.dispose();
    productBarcodeCtrl.dispose();
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
          final Widget emptyBody = Center(
            child: Padding(
              padding: const EdgeInsets.all(24),
              child: Text(
                StringLookup.t(loc, 'consolidatedEmptyRows'),
                textAlign: TextAlign.center,
                style: TextStyle(color: cs.onSurfaceVariant, fontSize: 15),
              ),
            ),
          );
          final Future<void> Function()? pull = widget.onPullRefresh;
          if (pull == null) {
            return emptyBody;
          }
          return LayoutBuilder(
            builder: (BuildContext context, BoxConstraints constraints) {
              return RefreshIndicator(
                onRefresh: pull,
                child: SingleChildScrollView(
                  physics: const AlwaysScrollableScrollPhysics(),
                  child: ConstrainedBox(
                    constraints: BoxConstraints(minHeight: constraints.maxHeight),
                    child: emptyBody,
                  ),
                ),
              );
            },
          );
        }
        final List<ConsolidatedProduct> incomplete = v.products
            .where((ConsolidatedProduct p) => p.totalPicked < p.totalRequired)
            .toList();
        final List<ConsolidatedProduct> complete = v.products
            .where((ConsolidatedProduct p) => p.totalPicked >= p.totalRequired)
            .toList();
        final List<ConsolidatedProduct> orderedProducts =
            <ConsolidatedProduct>[...incomplete, ...complete];
        final bool isDark = Theme.of(context).brightness == Brightness.dark;

        final ListView separatedList = ListView.separated(
          physics: widget.onPullRefresh != null
              ? const AlwaysScrollableScrollPhysics()
              : null,
          padding: const EdgeInsets.fromLTRB(12, 4, 12, 16),
          itemCount: orderedProducts.length,
          separatorBuilder: (_, __) => const SizedBox(height: 8),
          itemBuilder: (BuildContext context, int i) {
            final ConsolidatedProduct p = orderedProducts[i];
            final double req = p.totalRequired;
            final double done = p.totalPicked;
            final double ratio = req > 0 ? (done / req).clamp(0.0, 1.0) : 0.0;
            final String barcodeSku = '${p.barcode ?? '—'} / ${p.sku ?? '—'}';
            final String locationsLine = _consolidatedUniqueLocationsLine(p);
            final bool rowComplete = done >= req;
            final Color cardBg = rowComplete
                ? Colors.green.withValues(alpha: isDark ? 0.20 : 0.14)
                : cs.surfaceContainerHighest.withValues(alpha: 0.35);
            final Color qtyColor =
                rowComplete ? Colors.green.shade700 : cs.primary;
            return Material(
              color: cardBg,
              borderRadius: BorderRadius.circular(12),
              child: InkWell(
                borderRadius: BorderRadius.circular(12),
                onTap: () => _openPickSheet(context, p),
                child: Padding(
                  padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: <Widget>[
                      Row(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: <Widget>[
                          Expanded(
                            child: Text(
                              p.productName,
                              style: const TextStyle(
                                fontWeight: FontWeight.w600,
                                fontSize: 15,
                              ),
                            ),
                          ),
                          if (rowComplete)
                            Icon(
                              Icons.check_circle_rounded,
                              color: Colors.green.shade700,
                              size: 22,
                            ),
                        ],
                      ),
                      const SizedBox(height: 4),
                      Text(
                        barcodeSku,
                        style: TextStyle(
                          fontSize: 13,
                          color: cs.onSurfaceVariant,
                          fontFamily: 'monospace',
                        ),
                      ),
                      const SizedBox(height: 2),
                      Text(
                        locationsLine,
                        style: TextStyle(
                          fontSize: 13,
                          color: cs.onSurfaceVariant,
                        ),
                        maxLines: 3,
                        overflow: TextOverflow.ellipsis,
                      ),
                      if (p.lines.where((ConsolidatedLineItem l) => l.qtyPicked < l.qtyRequired).length >=
                          2) ...<Widget>[
                        const SizedBox(height: 4),
                        Text(
                          '${StringLookup.t(loc, 'consolidatedProductByOrder')}: ${consolidatedOpenLinesByOrderText(lines: p.lines, countTaLabel: StringLookup.t(loc, 'countTa').trim())}',
                          style: TextStyle(
                            fontSize: 12,
                            color: cs.onSurfaceVariant,
                          ),
                          maxLines: 2,
                          overflow: TextOverflow.ellipsis,
                        ),
                      ],
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
                                color: rowComplete ? Colors.green.shade600 : cs.primary,
                              ),
                            ),
                          ),
                          const SizedBox(width: 10),
                          Text(
                            '${formatPickQty(done)} / ${formatPickQty(req)}',
                            style: TextStyle(
                              fontWeight: FontWeight.w600,
                              color: qtyColor,
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
        final Future<void> Function()? pull = widget.onPullRefresh;
        if (pull == null) {
          return separatedList;
        }
        return RefreshIndicator(
          onRefresh: pull,
          child: separatedList,
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

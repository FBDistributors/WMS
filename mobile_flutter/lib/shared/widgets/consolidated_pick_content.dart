import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/app_state/app_locale.dart';
import '../../core/app_state/locale_controller.dart';
import '../../features/picking/data/picking_models.dart';
import '../../features/picking/picking_providers.dart';
import '../../l10n/string_lookup.dart';

/// RN `ConsolidatedPickContent` — mahsulotlar ro‘yxati; [refreshVersion] o‘zgarganda qayta yuklanadi.
class ConsolidatedPickContent extends ConsumerStatefulWidget {
  const ConsolidatedPickContent({super.key, this.refreshVersion = 0});

  final int refreshVersion;

  @override
  ConsumerState<ConsolidatedPickContent> createState() =>
      _ConsolidatedPickContentState();
}

class _ConsolidatedPickContentState extends ConsumerState<ConsolidatedPickContent> {
  @override
  void didUpdateWidget(ConsolidatedPickContent oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.refreshVersion != widget.refreshVersion) {
      ref.invalidate(consolidatedViewProvider);
    }
  }

  @override
  Widget build(BuildContext context) {
    final AppLocale loc = ref.watch(appLocaleProvider);
    final AsyncValue<ConsolidatedViewResponse> view =
        ref.watch(consolidatedViewProvider);
    final ColorScheme cs = Theme.of(context).colorScheme;

    return view.when(
      data: (ConsolidatedViewResponse v) {
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
            return DecoratedBox(
              decoration: BoxDecoration(
                color: cs.surfaceContainerHighest.withValues(alpha: 0.35),
                borderRadius: BorderRadius.circular(12),
                border: Border.all(color: cs.outlineVariant.withValues(alpha: 0.5)),
              ),
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

import 'dart:async' show unawaited;

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../core/app_state/app_locale.dart';
import '../../../core/app_state/locale_controller.dart';
import '../../../core/errors/api_error_localization.dart';
import '../../../core/offline/offline_database.dart';
import '../../../core/offline/offline_providers.dart';
import '../../../l10n/string_lookup.dart';
import '../../../shared/feedback/app_top_snackbar.dart';
import '../data/dealer_counts_models.dart';
import '../dealer_counts_providers.dart';

/// Diller sanovi: web'da yaratilgan faol sanovlar (har dillerda bitta) — faqat serverdan.
/// Telefon sanov yaratmaydi va nusxa saqlamaydi; sanash onlayn (inventarizatsiya kabi).
class DealerCountsListScreen extends ConsumerStatefulWidget {
  const DealerCountsListScreen({super.key});

  @override
  ConsumerState<DealerCountsListScreen> createState() => _DealerCountsListScreenState();
}

/// Eski (1.0.49 gacha) nusxalarni ko'chirish — ilova ishlaguncha bir marta.
bool _legacyChecked = false;

class _DealerCountsListScreenState extends ConsumerState<DealerCountsListScreen> {
  @override
  void initState() {
    super.initState();
    unawaited(_migrateLegacy());
  }

  Future<void> _migrateLegacy() async {
    if (_legacyChecked) {
      return;
    }
    final OfflineDatabase? db = await ref.read(offlineDatabaseProvider.future);
    if (db == null) {
      return;
    }
    final int dropped = await migrateLegacyDealerDrafts(db, ref.read(dealerCountsRepositoryProvider));
    final bool anyLeft = (await db.dealerDraftsAll()).isNotEmpty;
    // Internet yo'q bo'lsa nusxalar qoladi — keyingi ochilishda yana urinadi.
    _legacyChecked = !anyLeft;
    if (dropped > 0 && mounted) {
      showAppSnackBar(
        context,
        SnackBar(content: Text(StringLookup.tParams(ref.read(appLocaleProvider), 'dealerLegacyDropped', <String, String>{'n': '$dropped'}))),
        type: AppToastType.warning,
      );
    }
    if (mounted) {
      ref.invalidate(dealerActiveCountsProvider);
    }
  }

  @override
  Widget build(BuildContext context) {
    final AppLocale loc = ref.watch(appLocaleProvider);
    final AsyncValue<List<DealerCount>> counts = ref.watch(dealerActiveCountsProvider);
    final ColorScheme cs = Theme.of(context).colorScheme;

    return Scaffold(
      appBar: AppBar(
        title: Text(StringLookup.t(loc, 'dealerCountsTitle')),
        leading: IconButton(icon: const Icon(Icons.arrow_back), onPressed: () => context.pop()),
      ),
      body: RefreshIndicator(
        onRefresh: () async => ref.invalidate(dealerActiveCountsProvider),
        child: ListView(
          padding: const EdgeInsets.fromLTRB(12, 12, 12, 24),
          children: <Widget>[
            Padding(
              padding: const EdgeInsets.fromLTRB(4, 0, 4, 8),
              child: Text(StringLookup.t(loc, 'dealerSheetsHint'), style: TextStyle(fontSize: 12, color: cs.onSurfaceVariant)),
            ),
            ...counts.when(
              data: (List<DealerCount> list) => list.isEmpty
                  ? <Widget>[_Empty(StringLookup.t(loc, 'dealerSheetsEmpty'))]
                  : list
                      .map(
                        (DealerCount c) => Card(
                          child: ListTile(
                            leading: Icon(Icons.list_alt, color: cs.primary),
                            title: Text(c.dealerName ?? c.dealerOrgId),
                            subtitle: Text(
                              StringLookup.tParams(
                                loc,
                                'dealerSheetProgress',
                                <String, String>{'done': '${c.countedLines}', 'total': '${c.sheetLines}'},
                              ),
                            ),
                            trailing: const Icon(Icons.chevron_right),
                            onTap: () async {
                              await context.pushNamed('dealerSheet', pathParameters: <String, String>{'countId': c.id});
                              // Qaytganda progress yangilansin.
                              ref.invalidate(dealerActiveCountsProvider);
                            },
                          ),
                        ),
                      )
                      .toList(growable: false),
              loading: () => const <Widget>[
                Padding(padding: EdgeInsets.all(16), child: Center(child: CircularProgressIndicator())),
              ],
              error: (Object e, _) => <Widget>[_Empty(localizeApiErrorMessage(loc, e))],
            ),
          ],
        ),
      ),
    );
  }
}

class _Empty extends StatelessWidget {
  const _Empty(this.text);
  final String text;

  @override
  Widget build(BuildContext context) => Padding(
        padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 12),
        child: Text(text, style: TextStyle(color: Theme.of(context).colorScheme.onSurfaceVariant)),
      );
}

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:uuid/uuid.dart';

import '../../../core/app_state/app_locale.dart';
import '../../../core/app_state/locale_controller.dart';
import '../../../core/errors/api_error_localization.dart';
import '../../../core/offline/offline_database.dart';
import '../../../core/offline/offline_providers.dart';
import '../../../l10n/string_lookup.dart';
import '../../../shared/feedback/app_top_snackbar.dart';
import '../../customer_returns/data/customer_return_display_datetime.dart';
import '../../picking/data/picking_models.dart' show formatPickQty;
import '../data/dealer_counts_models.dart';
import '../dealer_counts_providers.dart';

/// Diller sanovi: telefondagi draftlar + serverga yuborilganlarim.
class DealerCountsListScreen extends ConsumerWidget {
  const DealerCountsListScreen({super.key});

  Future<void> _startNew(BuildContext context, WidgetRef ref, AppLocale loc) async {
    final Dealer? dealer = await showModalBottomSheet<Dealer>(
      context: context,
      isScrollControlled: true,
      builder: (BuildContext ctx) => _DealerPickerSheet(loc: loc),
    );
    if (dealer == null || !context.mounted) {
      return;
    }
    // Rejim: bo'sh ro'yxat (skan bilan noldan) yoki serverdan tayyor ro'yxat
    // (Smartup qoldig'i, ombor kodi bo'lmasa jo'natilgan tovarlar).
    final bool? withSheet = await showDialog<bool>(
      context: context,
      builder: (BuildContext ctx) => SimpleDialog(
        title: Text(StringLookup.t(loc, 'dealerNewModeTitle')),
        children: <Widget>[
          SimpleDialogOption(
            onPressed: () => Navigator.of(ctx).pop(true),
            child: ListTile(
              leading: const Icon(Icons.list_alt),
              title: Text(StringLookup.t(loc, 'dealerNewModeSheet')),
              subtitle: Text(StringLookup.t(loc, 'dealerNewModeSheetHint')),
              contentPadding: EdgeInsets.zero,
            ),
          ),
          SimpleDialogOption(
            onPressed: () => Navigator.of(ctx).pop(false),
            child: ListTile(
              leading: const Icon(Icons.qr_code_scanner),
              title: Text(StringLookup.t(loc, 'dealerNewModeBlank')),
              subtitle: Text(StringLookup.t(loc, 'dealerNewModeBlankHint')),
              contentPadding: EdgeInsets.zero,
            ),
          ),
        ],
      ),
    );
    if (withSheet == null || !context.mounted) {
      return;
    }
    final OfflineDatabase? db = await ref.read(offlineDatabaseProvider.future);
    if (db == null) {
      return;
    }
    if (withSheet) {
      await _startSheet(context, ref, loc, dealer, db);
      return;
    }
    final DealerCountDraft draft = DealerCountDraft(
      clientUuid: const Uuid().v4(),
      dealerOrgId: dealer.orgId,
      dealerName: dealer.name,
      startedAt: DateTime.now().toUtc().toIso8601String(),
      lines: <DealerCountDraftLine>[],
    );
    await db.dealerDraftSave(draft.clientUuid, draft.toJson());
    ref.invalidate(dealerCountDraftsProvider);
    if (context.mounted) {
      context.pushNamed('dealerCountDraft', pathParameters: <String, String>{'draftId': draft.clientUuid});
    }
  }

  /// Serverda ro'yxat yaratib to'ldiradi, oladi (claim) va telefonga yuklaydi.
  Future<void> _startSheet(
    BuildContext context,
    WidgetRef ref,
    AppLocale loc,
    Dealer dealer,
    OfflineDatabase db,
  ) async {
    showAppSnackBar(context, SnackBar(content: Text(StringLookup.t(loc, 'dealerSheetPreparing'))));
    try {
      final repo = ref.read(dealerCountsRepositoryProvider);
      final DealerCount created = await repo.createSheet(dealerOrgId: dealer.orgId, clientUuid: const Uuid().v4());
      final int added = await repo.prefill(created.id);
      final DealerCount claimed = await repo.claim(created.id);
      final DealerSheetDraft sheet = DealerSheetDraft.fromCount(claimed);
      await db.dealerDraftSave(DealerSheetDraft.storageKey(sheet.countId), sheet.toJson());
      ref.invalidate(dealerSheetDraftsProvider);
      ref.invalidate(dealerSheetsProvider);
      if (!context.mounted) {
        return;
      }
      showAppSnackBar(
        context,
        SnackBar(
          content: Text(
            added > 0
                ? StringLookup.tParams(loc, 'dealerSheetPrepared', <String, String>{'n': '$added'})
                : StringLookup.t(loc, 'dealerSheetPrepareEmpty'),
          ),
        ),
        type: added > 0 ? AppToastType.success : AppToastType.warning,
      );
      context.pushNamed('dealerSheet', pathParameters: <String, String>{'countId': sheet.countId});
    } on Exception catch (e) {
      if (context.mounted) {
        showAppSnackBar(context, SnackBar(content: Text(localizeApiErrorMessage(loc, e))), type: AppToastType.error);
      }
    }
  }

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final AppLocale loc = ref.watch(appLocaleProvider);
    final AsyncValue<List<DealerCountDraft>> drafts = ref.watch(dealerCountDraftsProvider);
    final AsyncValue<List<DealerCount>> sent = ref.watch(myDealerCountsProvider);
    final AsyncValue<List<DealerCount>> sheets = ref.watch(dealerSheetsProvider);
    final ColorScheme cs = Theme.of(context).colorScheme;

    return Scaffold(
      appBar: AppBar(
        title: Text(StringLookup.t(loc, 'dealerCountsTitle')),
        leading: IconButton(icon: const Icon(Icons.arrow_back), onPressed: () => context.pop()),
      ),
      floatingActionButton: FloatingActionButton.extended(
        onPressed: () => _startNew(context, ref, loc),
        icon: const Icon(Icons.add),
        label: Text(StringLookup.t(loc, 'dealerCountsNew')),
      ),
      body: RefreshIndicator(
        onRefresh: () async {
          ref.invalidate(dealerCountDraftsProvider);
          ref.invalidate(myDealerCountsProvider);
          ref.invalidate(dealerSheetsProvider);
        },
        child: ListView(
          padding: const EdgeInsets.fromLTRB(12, 12, 12, 96),
          children: <Widget>[
            _SectionTitle(StringLookup.t(loc, 'dealerCountsDrafts')),
            drafts.when(
              data: (List<DealerCountDraft> list) => list.isEmpty
                  ? _Empty(StringLookup.t(loc, 'dealerCountsEmpty'))
                  : Column(
                      children: list
                          .map(
                            (DealerCountDraft d) => Card(
                              child: ListTile(
                                leading: Icon(Icons.edit_note, color: cs.primary),
                                title: Text(d.dealerName),
                                subtitle: Text(
                                  '${StringLookup.t(loc, 'dealerCountStartedAt')}: ${formatCustomerReturnApiDateTime(d.startedAt)}\n'
                                  '${StringLookup.t(loc, 'dealerCountLines')}: ${d.lines.length} · '
                                  '${StringLookup.t(loc, 'dealerCountTotalUnits')}: ${formatPickQty(d.totalUnits)}',
                                ),
                                isThreeLine: true,
                                trailing: const Icon(Icons.chevron_right),
                                onTap: () => context.pushNamed(
                                  'dealerCountDraft',
                                  pathParameters: <String, String>{'draftId': d.clientUuid},
                                ),
                              ),
                            ),
                          )
                          .toList(growable: false),
                    ),
              loading: () => const Padding(
                padding: EdgeInsets.all(16),
                child: Center(child: CircularProgressIndicator()),
              ),
              error: (Object e, _) => _Empty(localizeApiErrorMessage(loc, e)),
            ),
            const SizedBox(height: 16),
            // Serverda tayyorlangan ro'yxatlar (web'da to'ldirilgan) — ochilganda telefonga
            // yuklanadi va qulflanadi; boshqa xodim olgan bo'lsa kim olgani ko'rinadi.
            _SectionTitle(StringLookup.t(loc, 'dealerSheetsTitle')),
            sheets.when(
              data: (List<DealerCount> list) => list.isEmpty
                  ? _Empty(StringLookup.t(loc, 'dealerCountsEmpty'))
                  : Column(
                      children: list
                          .map(
                            (DealerCount c) => Card(
                              child: ListTile(
                                leading: Icon(
                                  c.status == 'in_progress' ? Icons.phone_android : Icons.list_alt,
                                  color: c.status == 'in_progress' ? Colors.orange : cs.primary,
                                ),
                                title: Text(c.dealerName ?? c.dealerOrgId),
                                subtitle: Text(
                                  '${StringLookup.tParams(loc, 'dealerSheetProgress', <String, String>{'done': '${c.countedLines}', 'total': '${c.sheetLines}'})}'
                                  '${c.status == 'in_progress' && c.assignedToName != null ? '\n${StringLookup.tParams(loc, 'dealerSheetLockedBy', <String, String>{'name': c.assignedToName!})}' : ''}',
                                ),
                                isThreeLine: c.status == 'in_progress' && c.assignedToName != null,
                                trailing: const Icon(Icons.chevron_right),
                                onTap: () => context.pushNamed(
                                  'dealerSheet',
                                  pathParameters: <String, String>{'countId': c.id},
                                ),
                              ),
                            ),
                          )
                          .toList(growable: false),
                    ),
              loading: () => const Padding(
                padding: EdgeInsets.all(16),
                child: Center(child: CircularProgressIndicator()),
              ),
              error: (Object e, _) => _Empty(localizeApiErrorMessage(loc, e)),
            ),
            const SizedBox(height: 16),
            _SectionTitle(StringLookup.t(loc, 'dealerCountsSent')),
            sent.when(
              data: (List<DealerCount> list) => list.isEmpty
                  ? _Empty(StringLookup.t(loc, 'dealerCountsEmpty'))
                  : Column(
                      children: list
                          .map(
                            (DealerCount c) => Card(
                              child: ListTile(
                                leading: Icon(
                                  c.status == 'submitted' ? Icons.check_circle_outline : Icons.pending_outlined,
                                  color: c.status == 'submitted' ? Colors.green : cs.onSurfaceVariant,
                                ),
                                title: Text(c.dealerName ?? c.dealerOrgId),
                                subtitle: Text(
                                  '${formatCustomerReturnApiDateTime(c.submittedAt ?? c.startedAt)}\n'
                                  '${StringLookup.t(loc, 'dealerCountLines')}: ${c.linesCount} · '
                                  '${StringLookup.t(loc, 'dealerCountTotalUnits')}: ${formatPickQty(c.totalUnits)}',
                                ),
                                isThreeLine: true,
                                trailing: const Icon(Icons.chevron_right),
                                onTap: () => context.pushNamed(
                                  'dealerCountView',
                                  pathParameters: <String, String>{'countId': c.id},
                                ),
                              ),
                            ),
                          )
                          .toList(growable: false),
                    ),
              loading: () => const Padding(
                padding: EdgeInsets.all(16),
                child: Center(child: CircularProgressIndicator()),
              ),
              // Internet yo'q bo'lsa server ro'yxati ochilmaydi — draftlar baribir ishlaydi.
              error: (Object e, _) => _Empty(localizeApiErrorMessage(loc, e)),
            ),
          ],
        ),
      ),
    );
  }
}

class _SectionTitle extends StatelessWidget {
  const _SectionTitle(this.text);
  final String text;

  @override
  Widget build(BuildContext context) => Padding(
        padding: const EdgeInsets.fromLTRB(4, 4, 4, 8),
        child: Text(text, style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 15)),
      );
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

/// Diller tanlash — qidiruv bilan ro'yxat. Ro'yxat provayderda keshlanadi,
/// shuning uchun bir marta ochilgach internet bo'lmasa ham ishlaydi.
class _DealerPickerSheet extends ConsumerStatefulWidget {
  const _DealerPickerSheet({required this.loc});
  final AppLocale loc;

  @override
  ConsumerState<_DealerPickerSheet> createState() => _DealerPickerSheetState();
}

class _DealerPickerSheetState extends ConsumerState<_DealerPickerSheet> {
  String _q = '';

  @override
  Widget build(BuildContext context) {
    final AsyncValue<List<Dealer>> dealers = ref.watch(dealersProvider);
    final AppLocale loc = widget.loc;
    return SafeArea(
      child: Padding(
        padding: EdgeInsets.only(bottom: MediaQuery.viewInsetsOf(context).bottom),
        child: SizedBox(
          height: MediaQuery.sizeOf(context).height * 0.75,
          child: Column(
            children: <Widget>[
              Padding(
                padding: const EdgeInsets.fromLTRB(16, 16, 16, 8),
                child: Text(
                  StringLookup.t(loc, 'dealerSelectTitle'),
                  style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 17),
                ),
              ),
              Padding(
                padding: const EdgeInsets.symmetric(horizontal: 16),
                child: TextField(
                  autofocus: true,
                  decoration: InputDecoration(
                    prefixIcon: const Icon(Icons.search),
                    hintText: StringLookup.t(loc, 'dealerSearchHint'),
                    border: const OutlineInputBorder(),
                  ),
                  onChanged: (String v) => setState(() => _q = v.trim().toLowerCase()),
                ),
              ),
              const SizedBox(height: 8),
              Expanded(
                child: dealers.when(
                  data: (List<Dealer> list) {
                    final List<Dealer> shown = list
                        .where((Dealer d) =>
                            _q.isEmpty ||
                            d.name.toLowerCase().contains(_q) ||
                            d.orgId.toLowerCase().contains(_q))
                        .toList(growable: false);
                    if (shown.isEmpty) {
                      return Center(child: Text(StringLookup.t(loc, 'notFound')));
                    }
                    return ListView.builder(
                      itemCount: shown.length,
                      itemBuilder: (BuildContext ctx, int i) => ListTile(
                        title: Text(shown[i].name),
                        subtitle: Text(shown[i].orgId),
                        onTap: () => Navigator.of(ctx).pop(shown[i]),
                      ),
                    );
                  },
                  loading: () => const Center(child: CircularProgressIndicator()),
                  error: (Object e, _) => Center(
                    child: Padding(
                      padding: const EdgeInsets.all(16),
                      child: Text(localizeApiErrorMessage(loc, e)),
                    ),
                  ),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

/// Ro'yxat ekranidan tashqarida ham ishlatiladi (draft ekrani yuborgach).
void showDealerCountToast(BuildContext context, String text, {AppToastType type = AppToastType.info}) {
  showAppSnackBar(context, SnackBar(content: Text(text)), type: type);
}

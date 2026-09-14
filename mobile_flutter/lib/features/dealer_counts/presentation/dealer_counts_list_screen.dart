import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../core/app_state/app_locale.dart';
import '../../../core/app_state/locale_controller.dart';
import '../../../core/errors/api_error_localization.dart';
import '../../../l10n/string_lookup.dart';
import '../../../shared/feedback/app_top_snackbar.dart';
import '../../customer_returns/data/customer_return_display_datetime.dart';
import '../../picking/data/picking_models.dart' show formatPickQty;
import '../data/dealer_counts_models.dart';
import '../dealer_counts_providers.dart';

/// Diller sanovi: web'da tayyorlangan ro'yxatlar + yuborilganlarim.
///
/// Telefon hujjat yaratmaydi — ro'yxat faqat web'da tuziladi, bu yerda xodim
/// uni ochib (telefonga yuklab) skanerlab sanaydi.
class DealerCountsListScreen extends ConsumerWidget {
  const DealerCountsListScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final AppLocale loc = ref.watch(appLocaleProvider);
    final AsyncValue<List<DealerCountDraft>> drafts = ref.watch(dealerCountDraftsProvider);
    final AsyncValue<List<DealerCount>> sent = ref.watch(myDealerCountsProvider);
    final AsyncValue<List<DealerCount>> sheets = ref.watch(dealerSheetsProvider);
    final List<DealerSheetDraft> local = ref.watch(dealerSheetDraftsProvider).valueOrNull ?? const <DealerSheetDraft>[];
    final ColorScheme cs = Theme.of(context).colorScheme;
    // O'tish davri: yangi versiyadan oldin telefonda boshlangan bo'sh draftlar.
    final List<DealerCountDraft> legacy = drafts.valueOrNull ?? const <DealerCountDraft>[];

    return Scaffold(
      appBar: AppBar(
        title: Text(StringLookup.t(loc, 'dealerCountsTitle')),
        leading: IconButton(icon: const Icon(Icons.arrow_back), onPressed: () => context.pop()),
      ),
      body: RefreshIndicator(
        onRefresh: () async {
          ref.invalidate(dealerCountDraftsProvider);
          ref.invalidate(dealerSheetDraftsProvider);
          ref.invalidate(myDealerCountsProvider);
          ref.invalidate(dealerSheetsProvider);
        },
        child: ListView(
          padding: const EdgeInsets.fromLTRB(12, 12, 12, 24),
          children: <Widget>[
            _SectionTitle(StringLookup.t(loc, 'dealerSheetsTitle')),
            _Hint(StringLookup.t(loc, 'dealerSheetsHint')),
            ..._sheetTiles(context, loc, cs, sheets, local),
            if (legacy.isNotEmpty) ...<Widget>[
              const SizedBox(height: 16),
              _SectionTitle(StringLookup.t(loc, 'dealerCountsDrafts')),
              ...legacy.map(
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
              ),
            ],
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
              error: (Object e, _) => _Empty(localizeApiErrorMessage(loc, e)),
            ),
          ],
        ),
      ),
    );
  }

  /// Serverdagi ochiq ro'yxatlar + telefonga yuklanganlar. Internet bo'lmasa
  /// server ro'yxati ochilmaydi — dillerda yuklab olingan ro'yxat baribir ochilishi kerak.
  List<Widget> _sheetTiles(
    BuildContext context,
    AppLocale loc,
    ColorScheme cs,
    AsyncValue<List<DealerCount>> sheets,
    List<DealerSheetDraft> local,
  ) {
    final Map<String, DealerSheetDraft> byId = <String, DealerSheetDraft>{
      for (final DealerSheetDraft d in local) d.countId: d,
    };
    Widget localTile(DealerSheetDraft d) => _SheetTile(
          title: d.dealerName,
          progress: StringLookup.tParams(
            loc,
            'dealerSheetProgress',
            <String, String>{'done': '${d.countedCount}', 'total': '${d.lines.length}'},
          ),
          extra: StringLookup.t(loc, 'dealerSheetOnPhone'),
          icon: Icons.download_done,
          color: Colors.green,
          onTap: () => context.pushNamed('dealerSheet', pathParameters: <String, String>{'countId': d.countId}),
        );

    return sheets.when(
      data: (List<DealerCount> list) {
        final Set<String> serverIds = list.map((DealerCount c) => c.id).toSet();
        final List<Widget> tiles = <Widget>[
          for (final DealerCount c in list)
            if (byId[c.id] != null)
              // Telefondagi nusxa — sanalganlar shu yerda, server hali bilmaydi.
              localTile(byId[c.id]!)
            else
              _SheetTile(
                title: c.dealerName ?? c.dealerOrgId,
                progress: StringLookup.tParams(
                  loc,
                  'dealerSheetProgress',
                  <String, String>{'done': '${c.countedLines}', 'total': '${c.sheetLines}'},
                ),
                extra: c.status == 'in_progress' && c.assignedToName != null
                    ? StringLookup.tParams(loc, 'dealerSheetLockedBy', <String, String>{'name': c.assignedToName!})
                    : null,
                icon: c.status == 'in_progress' ? Icons.phone_android : Icons.list_alt,
                color: c.status == 'in_progress' ? Colors.orange : cs.primary,
                onTap: () => context.pushNamed('dealerSheet', pathParameters: <String, String>{'countId': c.id}),
              ),
          // Serverda endi ko'rinmaydi (masalan qulf ochilgan), lekin telefonda sanalganlari bor.
          for (final DealerSheetDraft d in local)
            if (!serverIds.contains(d.countId)) localTile(d),
        ];
        return tiles.isEmpty ? <Widget>[_Empty(StringLookup.t(loc, 'dealerSheetsEmpty'))] : tiles;
      },
      loading: () => <Widget>[
        ...local.map(localTile),
        const Padding(padding: EdgeInsets.all(16), child: Center(child: CircularProgressIndicator())),
      ],
      error: (Object e, _) => <Widget>[
        _Empty(local.isEmpty ? localizeApiErrorMessage(loc, e) : StringLookup.t(loc, 'dealerSheetsOffline')),
        ...local.map(localTile),
      ],
    );
  }
}

class _SheetTile extends StatelessWidget {
  const _SheetTile({
    required this.title,
    required this.progress,
    required this.extra,
    required this.icon,
    required this.color,
    required this.onTap,
  });

  final String title;
  final String progress;
  final String? extra;
  final IconData icon;
  final Color color;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) => Card(
        child: ListTile(
          leading: Icon(icon, color: color),
          title: Text(title),
          subtitle: Text(extra == null ? progress : '$progress\n$extra'),
          isThreeLine: extra != null,
          trailing: const Icon(Icons.chevron_right),
          onTap: onTap,
        ),
      );
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

class _Hint extends StatelessWidget {
  const _Hint(this.text);
  final String text;

  @override
  Widget build(BuildContext context) => Padding(
        padding: const EdgeInsets.fromLTRB(4, 0, 4, 8),
        child: Text(text, style: TextStyle(fontSize: 12, color: Theme.of(context).colorScheme.onSurfaceVariant)),
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

/// Ro'yxat ekranidan tashqarida ham ishlatiladi (draft ekrani yuborgach).
void showDealerCountToast(BuildContext context, String text, {AppToastType type = AppToastType.info}) {
  showAppSnackBar(context, SnackBar(content: Text(text)), type: type);
}

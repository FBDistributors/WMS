import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../core/app_state/app_locale.dart';
import '../../../core/app_state/locale_controller.dart';
import '../../../core/errors/api_error_localization.dart';
import '../../../l10n/string_lookup.dart';
import '../data/dealer_counts_models.dart';
import '../dealer_counts_providers.dart';

/// Diller sanovi: web'da yaratilgan faol sanovlar (har dillerda bitta) — xodim ichiga
/// kirib sanaydi. Telefon sanov yaratmaydi; natija web'da ko'rinadi.
class DealerCountsListScreen extends ConsumerWidget {
  const DealerCountsListScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final AppLocale loc = ref.watch(appLocaleProvider);
    final AsyncValue<DealerSheetsView> view = ref.watch(dealerSheetsViewProvider);
    final ColorScheme cs = Theme.of(context).colorScheme;

    return Scaffold(
      appBar: AppBar(
        title: Text(StringLookup.t(loc, 'dealerCountsTitle')),
        leading: IconButton(icon: const Icon(Icons.arrow_back), onPressed: () => context.pop()),
      ),
      body: RefreshIndicator(
        onRefresh: () async {
          ref.invalidate(dealerSheetDraftsProvider);
          ref.invalidate(dealerSheetsViewProvider);
        },
        child: ListView(
          padding: const EdgeInsets.fromLTRB(12, 12, 12, 24),
          children: <Widget>[
            _Hint(StringLookup.t(loc, 'dealerSheetsHint')),
            ...view.when(
              data: (DealerSheetsView v) => _sheetTiles(context, loc, cs, v),
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

  /// Serverdagi ro'yxatlar + telefonga yuklanganlar. Internet bo'lmasa server
  /// ro'yxati ochilmaydi — dillerda yuklab olingan ro'yxat baribir ochilishi kerak.
  List<Widget> _sheetTiles(BuildContext context, AppLocale loc, ColorScheme cs, DealerSheetsView v) {
    final Map<String, DealerSheetDraft> byId = <String, DealerSheetDraft>{
      for (final DealerSheetDraft d in v.local) d.countId: d,
    };
    void open(String countId) => context.pushNamed('dealerSheet', pathParameters: <String, String>{'countId': countId});
    String progress(int done, int total) =>
        StringLookup.tParams(loc, 'dealerSheetProgress', <String, String>{'done': '$done', 'total': '$total'});
    Widget localTile(DealerSheetDraft d) => _SheetTile(
          title: d.dealerName,
          progress: progress(d.countedCount, d.lines.length),
          extra: d.pendingCount > 0
              ? StringLookup.tParams(loc, 'dealerSheetPending', <String, String>{'n': '${d.pendingCount}'})
              : StringLookup.t(loc, 'dealerSheetOnPhone'),
          icon: d.pendingCount > 0 ? Icons.cloud_upload_outlined : Icons.download_done,
          color: d.pendingCount > 0 ? Colors.orange : Colors.green,
          onTap: () => open(d.countId),
        );

    if (v.error != null) {
      return <Widget>[
        _Empty(v.local.isEmpty ? localizeApiErrorMessage(loc, v.error!) : StringLookup.t(loc, 'dealerSheetsOffline')),
        ...v.local.map(localTile),
      ];
    }
    final Set<String> active = v.server.map((DealerCount c) => c.id).toSet();
    final List<Widget> tiles = <Widget>[
      for (final DealerCount c in v.server)
        if (byId[c.id] != null)
          // Telefondagi nusxa — sanalganlar shu yerda, server hali bilmaydi.
          localTile(byId[c.id]!)
        else
          _SheetTile(
            title: c.dealerName ?? c.dealerOrgId,
            progress: progress(c.countedLines, c.sheetLines),
            extra: null,
            icon: Icons.list_alt,
            color: cs.primary,
            onTap: () => open(c.id),
          ),
      // Sanov yopilgan/o'chirilgan, lekin telefonda yuborilmagan qatorlari bor — ichiga kirilganda yuboriladi.
      for (final DealerSheetDraft d in v.local)
        if (!active.contains(d.countId)) localTile(d),
    ];
    return tiles.isEmpty ? <Widget>[_Empty(StringLookup.t(loc, 'dealerSheetsEmpty'))] : tiles;
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

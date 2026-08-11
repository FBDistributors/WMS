import 'dart:async' show unawaited;

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:shared_preferences/shared_preferences.dart';

import '../../../core/app_state/app_locale.dart';
import '../../../core/app_state/locale_controller.dart';
import '../../../core/app_state/network_status_provider.dart';
import '../../../core/app_state/profile_type.dart';
import '../../../core/app_state/profile_type_controller.dart';
import '../../../core/app_state/theme_controller.dart';
import '../../../core/offline/offline_providers.dart';
import '../../../l10n/string_lookup.dart';
import '../../../shared/widgets/picker_footer.dart';
import '../../../shared/widgets/picker_tab_app_header.dart';
import '../domain/profile_type_param.dart';
import '../picking_providers.dart';
import '../data/picking_models.dart';
import '../data/return_session_storage.dart';

/// RN `PickerHome`.
class PickerHomeScreen extends ConsumerStatefulWidget {
  const PickerHomeScreen({super.key});

  @override
  ConsumerState<PickerHomeScreen> createState() => _PickerHomeScreenState();
}

class _PickerHomeScreenState extends ConsumerState<PickerHomeScreen> {
  bool _refreshing = false;

  /// Kutayotgan qaytimni keshga yozamiz (tarmoq uzilganda ham banner ko'rinsin),
  /// lekin ekranni majburan almashtirmaymiz — yig'uvchi o'zi kirib bajaradi.
  Future<void> _rememberPendingReturn(String? sessionId) async {
    final SharedPreferences sp = await SharedPreferences.getInstance();
    if (sessionId == null || sessionId.isEmpty) {
      await ReturnSessionStorage.clear(sp);
      return;
    }
    if (ReturnSessionStorage.read(sp) != sessionId) {
      await ReturnSessionStorage.save(sp, sessionId);
    }
  }

  @override
  Widget build(BuildContext context) {
    final GoRouterState routerState = GoRouterState.of(context);
    final String? qp = routerState.uri.queryParameters['profile'];
    final PickerProfileParam routeProfile = pickerProfileFromQuery(qp);
    final ProfileType ctxPt = ref.watch(profileTypeProvider);
    final PickerProfileParam effective = ctxPt == ProfileType.controller
        ? PickerProfileParam.controller
        : PickerProfileParam.picker;
    final PickerProfileParam profile = qp != null ? routeProfile : effective;

    final AppLocale loc = ref.watch(appLocaleProvider);
    final bool isDark = ref.watch(appThemeModeProvider) == ThemeMode.dark;
    final AsyncValue<bool> online = ref.watch(networkOnlineProvider);
    final bool isOnline = online.valueOrNull ?? true;
    final AsyncValue<int> pendingQ = ref.watch(pendingQueueCountProvider);

    final String title = profile == PickerProfileParam.controller
        ? StringLookup.t(loc, 'controllerTitle')
        : StringLookup.t(loc, 'pickerTitle');

    final AsyncValue<MyPickerStats> stats = ref.watch(pickerStatsProvider);

    final SafeCancelReturnSession? pendingReturn = profile == PickerProfileParam.picker
        ? ref.watch(myReturnSessionProvider).valueOrNull
        : null;
    ref.listen<AsyncValue<SafeCancelReturnSession?>>(
      myReturnSessionProvider,
      (AsyncValue<SafeCancelReturnSession?>? prev, AsyncValue<SafeCancelReturnSession?> next) {
        next.whenData((SafeCancelReturnSession? s) => unawaited(_rememberPendingReturn(s?.id)));
      },
    );

    return Scaffold(
      backgroundColor: isDark ? const Color(0xFF0F172A) : Colors.white,
      body: Column(
        children: <Widget>[
          PickerTabAppHeader(
            title: title,
            onRefresh: _onRefresh,
            refreshing: _refreshing,
            headerBackgroundColor: isDark ? const Color(0xFF1E293B) : null,
            titleColor: isDark ? const Color(0xFFF1F5F9) : null,
            accentColor: isDark ? const Color(0xFF93C5FD) : null,
            actionsBeforeNotification: <Widget>[
              if (!isOnline)
                Container(
                  padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                  decoration: BoxDecoration(
                    color: Colors.orange.shade400,
                    borderRadius: BorderRadius.circular(6),
                  ),
                  child: const Text(
                    'Offline',
                    style: TextStyle(color: Colors.white, fontSize: 12),
                  ),
                ),
            ],
          ),
          if (!isOnline)
            Container(
              width: double.infinity,
              color: Colors.orange.shade50,
              padding: const EdgeInsets.symmetric(vertical: 8, horizontal: 16),
              child: Text(
                StringLookup.t(loc, 'offlineBanner').replaceAll(
                  '{{count}}',
                  '${pendingQ.valueOrNull ?? 0}',
                ),
                textAlign: TextAlign.center,
                style: TextStyle(color: Colors.orange.shade900, fontWeight: FontWeight.w500),
              ),
            ),
          Expanded(
            child: RefreshIndicator(
              onRefresh: _onRefresh,
              child: CustomScrollView(
                physics: const AlwaysScrollableScrollPhysics(),
                slivers: <Widget>[
                SliverPadding(
                  padding: const EdgeInsets.fromLTRB(20, 16, 20, 12),
                  sliver: SliverList(
                    delegate: SliverChildListDelegate(
                      <Widget>[
                        if (pendingReturn != null)
                          _PendingReturnBanner(
                            session: pendingReturn,
                            isDark: isDark,
                            onTap: () => context.push('/return-items/${pendingReturn.id}'),
                          ),
                        stats.when(
                          data: (MyPickerStats s) =>
                              _StatsBlock(stats: s, loc: loc, isDark: isDark),
                          loading: () => const Padding(
                            padding: EdgeInsets.symmetric(vertical: 24),
                            child: Center(child: CircularProgressIndicator()),
                          ),
                          error: (_, __) => const SizedBox.shrink(),
                        ),
                        _PeriodTable(loc: loc, isDark: isDark),
                        if (profile == PickerProfileParam.picker)
                          _HomeCard(
                            icon: Icons.layers_outlined,
                            title: StringLookup.t(loc, 'consolidatedPickTitle'),
                            subtitle: StringLookup.t(loc, 'myPickTasks'),
                            isDark: isDark,
                            onTap: () => context.pushNamed('consolidatedPick'),
                          ),
                        if (profile == PickerProfileParam.picker)
                          _HomeCard(
                            icon: Icons.fact_check_outlined,
                            title: StringLookup.t(loc, 'kirimReturnsQueueCard'),
                            subtitle: StringLookup.t(loc, 'kirimCardReturnsQueueSubtitle'),
                            isDark: isDark,
                            onTap: () => context.pushNamed('customerReturnsQueue'),
                          ),
                        // Navbat "Boshqalar" bo'limiga ko'chdi — bu yerda faqat
                        // kutayotgan yozuv bo'lsa ko'rinadi.
                        if ((pendingQ.valueOrNull ?? 0) > 0)
                          _HomeCard(
                            icon: Icons.cloud_off_outlined,
                            title:
                                '${StringLookup.t(loc, 'queue')} (${pendingQ.valueOrNull ?? 0})',
                            subtitle: StringLookup.t(loc, 'syncPending'),
                            isDark: isDark,
                            onTap: () => context.pushNamed('queue'),
                          ),
                      ],
                    ),
                  ),
                ),
                const SliverFillRemaining(
                  hasScrollBody: false,
                  child: SizedBox.shrink(),
                ),
              ],
            ),
            ),
          ),
          const PickerFooter(current: PickerFooterRoute.pickerHome),
        ],
      ),
    );
  }

  Future<void> _onRefresh() async {
    setState(() => _refreshing = true);
    ref.invalidate(pickerStatsProvider);
    ref.invalidate(myReturnSessionProvider);
    await ref.read(openPickTasksProvider.notifier).refreshFromNetwork();
    ref.invalidate(pendingQueueCountProvider);
    await Future<void>.delayed(const Duration(milliseconds: 400));
    if (mounted) {
      setState(() => _refreshing = false);
    }
  }
}

/// Hafta kunlarining qisqartmasi — sana yorlig'i sifatida (0 = Dushanba).
const Map<String, List<String>> _weekdayShort = <String, List<String>>{
  'uz': <String>['Du', 'Se', 'Ch', 'Pa', 'Ju', 'Sh', 'Ya'],
  'ru': <String>['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'],
  'en': <String>['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'],
};

class _StatsBlock extends StatelessWidget {
  const _StatsBlock({
    required this.stats,
    required this.loc,
    required this.isDark,
  });

  final MyPickerStats stats;
  final AppLocale loc;
  final bool isDark;

  @override
  Widget build(BuildContext context) {
    if (stats.byDay.isEmpty) {
      return const SizedBox.shrink();
    }
    final Color accent = isDark ? const Color(0xFF93C5FD) : const Color(0xFF1A237E);
    return Container(
      margin: const EdgeInsets.only(bottom: 12),
      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
      decoration: BoxDecoration(
        color: isDark ? const Color(0xFF334155) : const Color(0xFFF0F0F0),
        borderRadius: BorderRadius.circular(12),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: <Widget>[
          Text(
            StringLookup.t(loc, 'statsWeekChartTitle'),
            style: TextStyle(
              fontSize: 12,
              fontWeight: FontWeight.w600,
              color: isDark ? Colors.white70 : Colors.black54,
            ),
          ),
          const SizedBox(height: 8),
          _WeekChart(days: stats.byDay, loc: loc, isDark: isDark, accent: accent),
        ],
      ),
    );
  }
}

/// Kunlik ustunlar. Tashqi kutubxonasiz — 7 ta ustun uchun paket ortiqcha.
class _WeekChart extends StatelessWidget {
  const _WeekChart({
    required this.days,
    required this.loc,
    required this.isDark,
    required this.accent,
  });

  final List<MyPickerStatsDay> days;
  final AppLocale loc;
  final bool isDark;
  final Color accent;

  static const double _maxBarHeight = 64;

  @override
  Widget build(BuildContext context) {
    final int peak = days.fold<int>(0, (int m, MyPickerStatsDay d) => d.count > m ? d.count : m);
    final List<String> names = _weekdayShort[loc.code] ?? _weekdayShort['en']!;
    final String todayIso = DateTime.now().toIso8601String().substring(0, 10);

    return Row(
      crossAxisAlignment: CrossAxisAlignment.end,
      children: days.map((MyPickerStatsDay d) {
        final bool isToday = d.date == todayIso;
        // Nol bo'lmagan kun ko'rinib tursin: eng past ustun ham 4px.
        final double h = peak <= 0 ? 0 : (d.count / peak) * _maxBarHeight;
        final DateTime parsed = DateTime.tryParse(d.date) ?? DateTime.now();
        final Color barColor = isToday
            ? accent
            : (isDark ? const Color(0xFF64748B) : const Color(0xFFB0BEC5));
        return Expanded(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: <Widget>[
              Text(
                d.count > 0 ? '${d.count}' : '',
                style: TextStyle(
                  fontSize: 11,
                  fontWeight: FontWeight.w700,
                  color: isDark ? Colors.white70 : Colors.black87,
                ),
              ),
              const SizedBox(height: 2),
              Container(
                height: d.count > 0 ? (h < 4 ? 4 : h) : 2,
                margin: const EdgeInsets.symmetric(horizontal: 3),
                decoration: BoxDecoration(
                  color: d.count > 0
                      ? barColor
                      : (isDark ? const Color(0xFF475569) : const Color(0xFFD7DDE2)),
                  borderRadius: BorderRadius.circular(4),
                ),
              ),
              const SizedBox(height: 4),
              Text(
                names[(parsed.weekday - 1) % 7],
                style: TextStyle(
                  fontSize: 10,
                  fontWeight: isToday ? FontWeight.w700 : FontWeight.w400,
                  color: isToday ? accent : (isDark ? Colors.white60 : Colors.black45),
                ),
              ),
            ],
          ),
        );
      }).toList(growable: false),
    );
  }
}

/// Ish haqi davri (26 -> keyingi oy 25) bo'yicha kunma-kun jadval.
/// Faqat ish bo'lgan kunlar — bo'sh qatorlar telefonda kerakli raqamni ko'madi.
class _PeriodTable extends ConsumerStatefulWidget {
  const _PeriodTable({required this.loc, required this.isDark});

  final AppLocale loc;
  final bool isDark;

  @override
  ConsumerState<_PeriodTable> createState() => _PeriodTableState();
}

class _PeriodTableState extends ConsumerState<_PeriodTable> {
  int _offset = 0;

  static String _dm(String iso) {
    final List<String> p = iso.split('-');
    return p.length == 3 ? '${p[2]}.${p[1]}' : iso;
  }

  static String _money(double v) {
    final String digits = v.round().abs().toString();
    final StringBuffer out = StringBuffer();
    for (int i = 0; i < digits.length; i++) {
      if (i > 0 && (digits.length - i) % 3 == 0) {
        out.write(' ');
      }
      out.write(digits[i]);
    }
    return (v < 0 ? '-' : '') + out.toString();
  }

  static String _dmy(String iso) {
    final List<String> p = iso.split('-');
    return p.length == 3 ? '${p[2]}.${p[1]}.${p[0]}' : iso;
  }

  @override
  Widget build(BuildContext context) {
    final AsyncValue<MyPeriodStats> async = ref.watch(myPeriodStatsProvider(_offset));
    final bool isDark = widget.isDark;
    final Color accent = isDark ? const Color(0xFF93C5FD) : const Color(0xFF1A237E);
    final Color faded = isDark ? Colors.white60 : Colors.black54;
    final MyPeriodStats? data = async.valueOrNull;

    return Container(
      margin: const EdgeInsets.only(bottom: 12),
      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
      decoration: BoxDecoration(
        color: isDark ? const Color(0xFF334155) : const Color(0xFFF0F0F0),
        borderRadius: BorderRadius.circular(12),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: <Widget>[
          Row(
            children: <Widget>[
              IconButton(
                visualDensity: VisualDensity.compact,
                onPressed: () => setState(() => _offset -= 1),
                icon: Icon(Icons.chevron_left, color: accent),
                tooltip: StringLookup.t(widget.loc, 'periodPrev'),
              ),
              Expanded(
                child: Text(
                  data == null
                      ? StringLookup.t(widget.loc, 'periodTitle')
                      : '${_dmy(data.periodFrom)} – ${_dmy(data.periodTo)}',
                  textAlign: TextAlign.center,
                  style: TextStyle(
                    fontSize: 13,
                    fontWeight: FontWeight.w700,
                    color: isDark ? Colors.white : Colors.black87,
                  ),
                ),
              ),
              IconButton(
                visualDensity: VisualDensity.compact,
                onPressed: _offset >= 0 ? null : () => setState(() => _offset += 1),
                icon: Icon(
                  Icons.chevron_right,
                  color: _offset >= 0 ? faded.withValues(alpha: 0.4) : accent,
                ),
                tooltip: StringLookup.t(widget.loc, 'periodNext'),
              ),
            ],
          ),
          const SizedBox(height: 4),
          if (async.isLoading && data == null)
            const Padding(
              padding: EdgeInsets.symmetric(vertical: 20),
              child: Center(child: CircularProgressIndicator()),
            )
          else if (data == null || data.days.isEmpty)
            Padding(
              padding: const EdgeInsets.symmetric(vertical: 16),
              child: Text(
                StringLookup.t(widget.loc, 'periodEmpty'),
                textAlign: TextAlign.center,
                style: TextStyle(fontSize: 12, color: faded),
              ),
            )
          else ...<Widget>[
            _row(
              StringLookup.t(widget.loc, 'periodColDate'),
              StringLookup.t(widget.loc, 'periodColCity'),
              StringLookup.t(widget.loc, 'periodColRegion'),
              StringLookup.t(widget.loc, 'periodColAmount'),
              isHeader: true,
              color: faded,
            ),
            const SizedBox(height: 2),
            ...data.days.map(
              (MyPeriodStatsDay d) => _row(
                _dm(d.date),
                '${d.shahar.positions}',
                '${d.region.positions}',
                _money(d.amount),
                color: isDark ? Colors.white : Colors.black87,
              ),
            ),
            Divider(height: 14, color: isDark ? Colors.white24 : Colors.black26),
            _row(
              StringLookup.t(widget.loc, 'periodTotal'),
              '${data.totalShahar.positions}',
              '${data.totalRegion.positions}',
              _money(data.totalAmount),
              isTotal: true,
              color: accent,
            ),
            const SizedBox(height: 8),
            // Tarif serverdan keladi — o'zgarsa ilovani yangilash shart emas.
            Text(
              '${StringLookup.t(widget.loc, 'periodColCity')}: ${_money(data.rateShahar)} · '
              '${StringLookup.t(widget.loc, 'periodColRegion')}: ${_money(data.rateRegion)}',
              textAlign: TextAlign.center,
              style: TextStyle(fontSize: 11, color: faded),
            ),
          ],
        ],
      ),
    );
  }

  Widget _row(
    String date,
    String orders,
    String positions,
    String qty, {
    bool isHeader = false,
    bool isTotal = false,
    required Color color,
  }) {
    final TextStyle style = TextStyle(
      fontSize: isHeader ? 11 : 12.5,
      fontWeight: (isHeader || isTotal) ? FontWeight.w700 : FontWeight.w400,
      color: color,
    );
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 3),
      child: Row(
        children: <Widget>[
          Expanded(flex: 3, child: Text(date, style: style)),
          Expanded(flex: 2, child: Text(orders, textAlign: TextAlign.right, style: style)),
          Expanded(flex: 3, child: Text(positions, textAlign: TextAlign.right, style: style)),
          Expanded(flex: 3, child: Text(qty, textAlign: TextAlign.right, style: style)),
        ],
      ),
    );
  }
}

/// Kutayotgan qaytim — bloklovchi ekran emas, navbatdagi ustuvor vazifa.
class _PendingReturnBanner extends StatelessWidget {
  const _PendingReturnBanner({
    required this.session,
    required this.isDark,
    required this.onTap,
  });

  final SafeCancelReturnSession session;
  final bool isDark;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final int remaining = session.lines.where((SafeCancelReturnLine l) => !l.productConfirmed).length;
    final String order = (session.orderNumber ?? '').trim().isNotEmpty
        ? '№ ${session.orderNumber}'
        : session.referenceNumber;
    final Color accent = isDark ? const Color(0xFFFDBA74) : Colors.orange.shade900;

    return Card(
      color: isDark ? const Color(0xFF4A2C0B) : Colors.orange.shade50,
      margin: const EdgeInsets.only(bottom: 10),
      elevation: 0,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(12),
        side: BorderSide(color: isDark ? const Color(0xFF9A5B12) : Colors.orange.shade200),
      ),
      child: ListTile(
        visualDensity: VisualDensity.compact,
        contentPadding: const EdgeInsets.symmetric(horizontal: 14, vertical: 6),
        minLeadingWidth: 32,
        leading: Icon(Icons.assignment_return_outlined, size: 28, color: accent),
        title: Text(
          'Qaytim kutilmoqda',
          style: TextStyle(fontWeight: FontWeight.w700, fontSize: 15, color: accent),
        ),
        subtitle: Text(
          '$order — qaytariladigan pozitsiya: $remaining',
          style: TextStyle(fontSize: 13, color: isDark ? Colors.white70 : Colors.black54),
        ),
        trailing: Icon(Icons.chevron_right, color: accent),
        onTap: onTap,
      ),
    );
  }
}

class _HomeCard extends StatelessWidget {
  const _HomeCard({
    required this.icon,
    required this.title,
    required this.subtitle,
    required this.isDark,
    required this.onTap,
  });

  final IconData icon;
  final String title;
  final String subtitle;
  final bool isDark;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return Card(
      color: isDark ? const Color(0xFF334155) : const Color(0xFFF0F0F0),
      margin: const EdgeInsets.only(bottom: 10),
      elevation: 0,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
      child: ListTile(
        visualDensity: VisualDensity.compact,
        contentPadding: const EdgeInsets.symmetric(horizontal: 14, vertical: 6),
        minLeadingWidth: 32,
        leading: Icon(icon, size: 28, color: isDark ? const Color(0xFF93C5FD) : const Color(0xFF1A237E)),
        title: Text(title, style: const TextStyle(fontWeight: FontWeight.w600, fontSize: 15)),
        subtitle: Text(subtitle, style: TextStyle(fontSize: 13, color: isDark ? Colors.white70 : Colors.black54)),
        trailing: Icon(Icons.chevron_right, color: isDark ? Colors.white54 : Colors.black45),
        onTap: onTap,
      ),
    );
  }
}

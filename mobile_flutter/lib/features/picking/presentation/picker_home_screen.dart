import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../core/app_state/app_locale.dart';
import '../../../core/app_state/locale_controller.dart';
import '../../../core/app_state/network_status_provider.dart';
import '../../../core/app_state/profile_type.dart';
import '../../../core/app_state/profile_type_controller.dart';
import '../../../core/app_state/task_count_provider.dart';
import '../../../core/app_state/theme_controller.dart';
import '../../../core/offline/offline_providers.dart';
import '../../../l10n/string_lookup.dart';
import '../../../shared/widgets/app_header.dart';
import '../../../shared/widgets/picker_footer.dart';
import '../domain/profile_type_param.dart';
import '../picking_providers.dart';
import '../data/picking_models.dart';

/// RN `PickerHome`.
class PickerHomeScreen extends ConsumerStatefulWidget {
  const PickerHomeScreen({super.key});

  @override
  ConsumerState<PickerHomeScreen> createState() => _PickerHomeScreenState();
}

class _PickerHomeScreenState extends ConsumerState<PickerHomeScreen> {
  bool _refreshing = false;
  String? _consumedCompletedMessage;

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    final String? msg = GoRouterState.of(context).uri.queryParameters['completedMessage'];
    if (msg == null || msg.isEmpty || msg == _consumedCompletedMessage) {
      return;
    }
    _consumedCompletedMessage = msg;
    final String profileQ =
        GoRouterState.of(context).uri.queryParameters['profile'] ?? 'picker';
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (!mounted) {
        return;
      }
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(Uri.decodeComponent(msg))),
      );
      context.goNamed(
        'pickerHome',
        queryParameters: <String, String>{'profile': profileQ},
      );
    });
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
    ref.listen(openPickTasksProvider, (_, AsyncValue<List<PickingListItem>> next) {
      next.whenData((List<PickingListItem> list) {
        ref.read(taskCountProvider.notifier).state = list.length;
      });
    });

    return Scaffold(
      backgroundColor: isDark ? const Color(0xFF0F172A) : Colors.white,
      body: Column(
        children: <Widget>[
          AppHeader(
            title: title,
            showLogo: true,
            onRefresh: _onRefresh,
            refreshing: _refreshing,
            headerBackgroundColor: isDark ? const Color(0xFF1E293B) : Colors.white,
            titleColor: isDark ? const Color(0xFFF1F5F9) : const Color(0xFF333333),
            accentColor: isDark ? const Color(0xFF93C5FD) : const Color(0xFF1A237E),
            leading: IconButton(
              icon: const Icon(Icons.person_outline),
              onPressed: () => context.pushNamed('account'),
              tooltip: StringLookup.t(loc, 'tabAccount'),
            ),
            trailing: !isOnline
                ? Container(
                    padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                    decoration: BoxDecoration(
                      color: Colors.orange.shade400,
                      borderRadius: BorderRadius.circular(6),
                    ),
                    child: const Text('Offline', style: TextStyle(color: Colors.white, fontSize: 12)),
                  )
                : null,
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
            child: CustomScrollView(
              slivers: <Widget>[
                SliverPadding(
                  padding: const EdgeInsets.fromLTRB(20, 16, 20, 12),
                  sliver: SliverList(
                    delegate: SliverChildListDelegate(
                      <Widget>[
                        stats.when(
                          data: (MyPickerStats s) =>
                              _StatsBlock(stats: s, loc: loc, isDark: isDark),
                          loading: () => const Padding(
                            padding: EdgeInsets.symmetric(vertical: 24),
                            child: Center(child: CircularProgressIndicator()),
                          ),
                          error: (_, __) => const SizedBox.shrink(),
                        ),
                        if (profile == PickerProfileParam.picker)
                          _HomeCard(
                            icon: Icons.layers_outlined,
                            title: StringLookup.t(loc, 'consolidatedPickTitle'),
                            subtitle: StringLookup.t(loc, 'myPickTasks'),
                            isDark: isDark,
                            onTap: () => context.pushNamed('consolidatedPick'),
                          ),
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
          const PickerFooter(current: PickerFooterRoute.pickerHome),
        ],
      ),
    );
  }

  Future<void> _onRefresh() async {
    setState(() => _refreshing = true);
    ref.invalidate(pickerStatsProvider);
    await ref.read(openPickTasksProvider.notifier).refreshFromNetwork();
    ref.invalidate(pendingQueueCountProvider);
    await Future<void>.delayed(const Duration(milliseconds: 400));
    if (mounted) {
      setState(() => _refreshing = false);
    }
  }
}

class _StatsBlock extends StatelessWidget {
  const _StatsBlock({required this.stats, required this.loc, required this.isDark});

  final MyPickerStats stats;
  final AppLocale loc;
  final bool isDark;

  @override
  Widget build(BuildContext context) {
    final Color accent = isDark ? const Color(0xFF93C5FD) : const Color(0xFF1A237E);
    return Container(
      margin: const EdgeInsets.only(bottom: 12),
      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
      decoration: BoxDecoration(
        color: isDark ? const Color(0xFF334155) : const Color(0xFFF0F0F0),
        borderRadius: BorderRadius.circular(12),
      ),
      child: Column(
        children: <Widget>[
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceAround,
            children: <Widget>[
              _statBox('${stats.totalCompleted}', StringLookup.t(loc, 'statsTotalCompleted'), accent, isDark),
              _statBox('${stats.completedToday}', StringLookup.t(loc, 'statsCompletedToday'), accent, isDark),
            ],
          ),
        ],
      ),
    );
  }

  Widget _statBox(String value, String label, Color accent, bool dark) {
    return Column(
      children: <Widget>[
        Text(value, style: TextStyle(fontSize: 26, fontWeight: FontWeight.w700, color: accent)),
        Text(
          label,
          style: TextStyle(fontSize: 12, color: dark ? Colors.white70 : Colors.black54),
          textAlign: TextAlign.center,
        ),
      ],
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

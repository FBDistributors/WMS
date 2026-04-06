import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../shared/widgets/app_header.dart';
import '../../../shared/widgets/picker_footer.dart';
import '../data/models/picker_inventory_models.dart';
import '../data/picker_location_format.dart';
import 'inventory_locale.dart';
import 'inventory_list_controller.dart';
import 'inventory_providers.dart';

/// Migrated from React Native `InventoryScreen.tsx` (picker list, search, location filter, pagination).
class InventoryScreen extends ConsumerWidget {
  const InventoryScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final bool isDark = Theme.of(context).brightness == Brightness.dark;
    final InventoryLocale locale = ref.watch(inventoryLocaleProvider);
    final InventoryViewState vm = ref.watch(inventoryListControllerProvider);
    final AsyncValue<List<PickerLocationOption>> locationsAsync =
        ref.watch(pickerLocationsProvider);
    final String locationId = ref.watch(inventoryLocationIdProvider);

    final Color scaffoldBg =
        isDark ? const Color(0xFF0F172A) : const Color(0xFFF5F5F5);
    final Color toolbarBg = isDark ? const Color(0xFF1E293B) : Colors.white;
    final Color searchWrapBg = isDark ? const Color(0xFF334155) : const Color(0xFFF0F0F0);
    final Color primaryText = isDark ? const Color(0xFFF1F5F9) : const Color(0xFF333333);
    final Color secondaryText = isDark ? const Color(0xFF94A3B8) : const Color(0xFF666666);
    final Color accent = isDark ? const Color(0xFF93C5FD) : const Color(0xFF1A237E);

    return Scaffold(
      backgroundColor: scaffoldBg,
      body: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: <Widget>[
          AppHeader(
            title: InventoryStrings.invTitle(locale),
            showLogo: true,
            onRefresh: () =>
                ref.read(inventoryListControllerProvider.notifier).refreshFromHeader(),
            refreshing: vm.headerRefreshing,
            headerBackgroundColor: toolbarBg,
            titleColor: primaryText,
            accentColor: accent,
          ),
          _SearchToolbar(
            isDark: isDark,
            toolbarBg: toolbarBg,
            searchWrapBg: searchWrapBg,
            primaryText: primaryText,
            secondaryText: secondaryText,
            accent: accent,
            locale: locale,
          ),
          locationsAsync.when(
            data: (List<PickerLocationOption> locations) {
              if (locations.isEmpty) {
                return const SizedBox.shrink();
              }
              return _LocationFilterRow(
                locations: locations,
                locationId: locationId,
                isDark: isDark,
                toolbarBg: toolbarBg,
                secondaryText: secondaryText,
                primaryText: primaryText,
                locale: locale,
              );
            },
            loading: () => const SizedBox.shrink(),
            error: (_, __) => const SizedBox.shrink(),
          ),
          Expanded(
            child: _InventoryBody(
              vm: vm,
              isDark: isDark,
              scaffoldBg: scaffoldBg,
              primaryText: primaryText,
              secondaryText: secondaryText,
              accent: accent,
              locale: locale,
            ),
          ),
          const PickerFooter(current: PickerFooterRoute.inventory),
        ],
      ),
    );
  }
}

class _SearchToolbar extends ConsumerStatefulWidget {
  const _SearchToolbar({
    required this.isDark,
    required this.toolbarBg,
    required this.searchWrapBg,
    required this.primaryText,
    required this.secondaryText,
    required this.accent,
    required this.locale,
  });

  final bool isDark;
  final Color toolbarBg;
  final Color searchWrapBg;
  final Color primaryText;
  final Color secondaryText;
  final Color accent;
  final InventoryLocale locale;

  @override
  ConsumerState<_SearchToolbar> createState() => _SearchToolbarState();
}

class _SearchToolbarState extends ConsumerState<_SearchToolbar> {
  late final TextEditingController _controller;

  @override
  void initState() {
    super.initState();
    _controller = TextEditingController(text: ref.read(inventoryQueryProvider));
  }

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    ref.listen<String>(inventoryQueryProvider, (_, String next) {
      if (_controller.text != next) {
        _controller.text = next;
      }
    });

    return Container(
      color: widget.toolbarBg,
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
      child: Row(
        children: <Widget>[
          Expanded(
            child: Container(
              decoration: BoxDecoration(
                color: widget.searchWrapBg,
                borderRadius: BorderRadius.circular(12),
              ),
              padding: const EdgeInsets.symmetric(horizontal: 12),
              child: Row(
                children: <Widget>[
                  Icon(Icons.search, size: 20, color: widget.secondaryText),
                  const SizedBox(width: 8),
                  Expanded(
                    child: TextField(
                      controller: _controller,
                      style: TextStyle(fontSize: 15, color: widget.primaryText),
                      decoration: InputDecoration(
                        isDense: true,
                        border: InputBorder.none,
                        hintText: InventoryStrings.invSearchPlaceholder(widget.locale),
                        hintStyle: TextStyle(
                          color: widget.isDark
                              ? const Color(0xFF64748B)
                              : const Color(0xFF999999),
                        ),
                      ),
                      textInputAction: TextInputAction.search,
                      onChanged: (String v) {
                        ref.read(inventoryQueryProvider.notifier).state = v;
                      },
                      onSubmitted: (_) {
                        ref.read(inventoryListControllerProvider.notifier).load(reset: true);
                      },
                    ),
                  ),
                ],
              ),
            ),
          ),
          const SizedBox(width: 8),
          TextButton(
            style: TextButton.styleFrom(
              backgroundColor: const Color(0xFF1A237E),
              foregroundColor: Colors.white,
              padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
              shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
            ),
            onPressed: () {
              ref.read(inventoryListControllerProvider.notifier).load(reset: true);
            },
            child: Text(
              InventoryStrings.invSearch(widget.locale),
              style: const TextStyle(fontWeight: FontWeight.w600, fontSize: 14),
            ),
          ),
        ],
      ),
    );
  }
}

class _LocationFilterRow extends ConsumerWidget {
  const _LocationFilterRow({
    required this.locations,
    required this.locationId,
    required this.isDark,
    required this.toolbarBg,
    required this.secondaryText,
    required this.primaryText,
    required this.locale,
  });

  final List<PickerLocationOption> locations;
  final String locationId;
  final bool isDark;
  final Color toolbarBg;
  final Color secondaryText;
  final Color primaryText;
  final InventoryLocale locale;

  String _label() {
    if (locationId.isEmpty) {
      return InventoryStrings.invAllLocations(locale);
    }
    for (final PickerLocationOption l in locations) {
      if (l.id == locationId) {
        return l.code;
      }
    }
    return locationId;
  }

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    return Container(
      color: toolbarBg,
      padding: const EdgeInsets.fromLTRB(16, 0, 16, 8),
      child: Row(
        children: <Widget>[
          Text(
            '${InventoryStrings.invBestLocation(locale)}:',
            style: TextStyle(fontSize: 14, color: secondaryText),
          ),
          const SizedBox(width: 8),
          Expanded(
            child: InkWell(
              onTap: () => _openPicker(context, ref),
              child: Row(
                children: <Widget>[
                  Icon(Icons.location_on_outlined, size: 18, color: secondaryText),
                  const SizedBox(width: 6),
                  Expanded(
                    child: Text(
                      _label(),
                      style: TextStyle(fontSize: 14, color: primaryText),
                      overflow: TextOverflow.ellipsis,
                    ),
                  ),
                  Icon(Icons.expand_more, size: 20, color: secondaryText),
                ],
              ),
            ),
          ),
        ],
      ),
    );
  }

  Future<void> _openPicker(BuildContext context, WidgetRef ref) async {
    final Color modalBg = isDark ? const Color(0xFF1E293B) : Colors.white;
    final Color rowText = isDark ? const Color(0xFFF1F5F9) : const Color(0xFF333333);

    await showDialog<void>(
      context: context,
      barrierDismissible: true,
      builder: (BuildContext ctx) {
        return Material(
          color: Colors.black54,
          child: InkWell(
            onTap: () => Navigator.of(ctx).pop(),
            child: Center(
              child: InkWell(
                onTap: () {},
                child: Container(
                  margin: const EdgeInsets.all(24),
                  constraints: const BoxConstraints(maxHeight: 360),
                  decoration: BoxDecoration(
                    color: modalBg,
                    borderRadius: BorderRadius.circular(12),
                  ),
                  child: ListView(
                    shrinkWrap: true,
                    children: <Widget>[
                      ListTile(
                        title: Text(
                          InventoryStrings.invAllLocations(locale),
                          style: TextStyle(color: rowText, fontSize: 16),
                        ),
                        onTap: () {
                          ref.read(inventoryLocationIdProvider.notifier).state = '';
                          Navigator.of(ctx).pop();
                        },
                      ),
                      ...locations.map((PickerLocationOption loc) {
                        final String line = formatPickerLocationOptionLine(loc);
                        final String suffix =
                            loc.name.isNotEmpty && loc.name != loc.code ? ' — ${loc.name}' : '';
                        return ListTile(
                          title: Text(
                            '$line$suffix',
                            style: TextStyle(color: rowText, fontSize: 16),
                          ),
                          onTap: () {
                            ref.read(inventoryLocationIdProvider.notifier).state = loc.id;
                            Navigator.of(ctx).pop();
                          },
                        );
                      }),
                    ],
                  ),
                ),
              ),
            ),
          ),
        );
      },
    );
  }
}

class _InventoryBody extends ConsumerWidget {
  const _InventoryBody({
    required this.vm,
    required this.isDark,
    required this.scaffoldBg,
    required this.primaryText,
    required this.secondaryText,
    required this.accent,
    required this.locale,
  });

  final InventoryViewState vm;
  final bool isDark;
  final Color scaffoldBg;
  final Color primaryText;
  final Color secondaryText;
  final Color accent;
  final InventoryLocale locale;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    if (vm.loading) {
      return ColoredBox(
        color: scaffoldBg,
        child: Center(
          child: CircularProgressIndicator(color: accent),
        ),
      );
    }

    if (vm.error != null) {
      return ColoredBox(
        color: scaffoldBg,
        child: Center(
          child: Padding(
            padding: const EdgeInsets.all(24),
            child: Column(
              mainAxisAlignment: MainAxisAlignment.center,
              children: <Widget>[
                Icon(Icons.error_outline, size: 48, color: Colors.red.shade400),
                const SizedBox(height: 12),
                Text(
                  vm.error!,
                  textAlign: TextAlign.center,
                  style: TextStyle(
                    fontSize: 16,
                    color: isDark ? const Color(0xFFFCA5A5) : primaryText,
                  ),
                ),
                const SizedBox(height: 16),
                FilledButton(
                  style: FilledButton.styleFrom(
                    backgroundColor: const Color(0xFF1A237E),
                    padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 10),
                    shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
                  ),
                  onPressed: () {
                    ref.read(inventoryListControllerProvider.notifier).load(reset: true);
                  },
                  child: Text(InventoryStrings.invRetry(locale)),
                ),
              ],
            ),
          ),
        ),
      );
    }

    if (vm.items.isEmpty) {
      return ColoredBox(
        color: scaffoldBg,
        child: Center(
          child: Padding(
            padding: const EdgeInsets.all(24),
            child: Column(
              mainAxisAlignment: MainAxisAlignment.center,
              children: <Widget>[
                Icon(Icons.inventory_2_outlined, size: 48, color: secondaryText),
                const SizedBox(height: 12),
                Text(
                  InventoryStrings.invNoResults(locale),
                  textAlign: TextAlign.center,
                  style: TextStyle(fontSize: 16, color: secondaryText),
                ),
                const SizedBox(height: 16),
                FilledButton(
                  style: FilledButton.styleFrom(
                    backgroundColor: const Color(0xFF1A237E),
                    padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 10),
                    shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
                  ),
                  onPressed: () {
                    ref.read(inventoryListControllerProvider.notifier).load(reset: true);
                  },
                  child: Text(InventoryStrings.invRetry(locale)),
                ),
              ],
            ),
          ),
        ),
      );
    }

    return ColoredBox(
      color: scaffoldBg,
      child: NotificationListener<ScrollNotification>(
        onNotification: (ScrollNotification n) {
          if (n.metrics.pixels >= n.metrics.maxScrollExtent * 0.7) {
            ref.read(inventoryListControllerProvider.notifier).loadMore();
          }
          return false;
        },
        child: ListView.builder(
          padding: const EdgeInsets.fromLTRB(16, 16, 16, 24),
          itemCount: vm.items.length + (vm.loadingMore ? 1 : 0),
          itemBuilder: (BuildContext context, int index) {
            if (index >= vm.items.length) {
              return Padding(
                padding: const EdgeInsets.symmetric(vertical: 16),
                child: Center(
                  child: SizedBox(
                    width: 24,
                    height: 24,
                    child: CircularProgressIndicator(
                      strokeWidth: 2,
                      color: isDark ? accent : const Color(0xFF1A237E),
                    ),
                  ),
                ),
              );
            }
            final PickerInventoryItem item = vm.items[index];
            return Padding(
              padding: const EdgeInsets.only(bottom: 10),
              child: _InventoryCard(
                item: item,
                isDark: isDark,
                locale: locale,
                onTap: () {
                  context.pushNamed(
                    'inventoryDetail',
                    pathParameters: <String, String>{'productId': item.productId},
                  );
                },
              ),
            );
          },
        ),
      ),
    );
  }
}

class _InventoryCard extends StatelessWidget {
  const _InventoryCard({
    required this.item,
    required this.isDark,
    required this.locale,
    required this.onTap,
  });

  final PickerInventoryItem item;
  final bool isDark;
  final InventoryLocale locale;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final Color cardBg = isDark ? const Color(0xFF1E293B) : Colors.white;
    final Color titleC = isDark ? const Color(0xFFF1F5F9) : const Color(0xFF333333);
    final Color barcodeC = isDark ? const Color(0xFF94A3B8) : const Color(0xFF666666);
    final Color codeC = isDark ? const Color(0xFF93C5FD) : const Color(0xFF1A237E);
    final Color metaC = isDark ? const Color(0xFF94A3B8) : const Color(0xFF666666);
    final Color chevronC = isDark ? const Color(0xFF94A3B8) : const Color(0xFF666666);

    return Material(
      color: cardBg,
      elevation: isDark ? 0 : 2,
      shadowColor: Colors.black26,
      borderRadius: BorderRadius.circular(12),
      child: InkWell(
        borderRadius: BorderRadius.circular(12),
        onTap: onTap,
        child: Padding(
          padding: const EdgeInsets.all(14),
          child: Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: <Widget>[
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: <Widget>[
                    Text(
                      item.name,
                      style: TextStyle(
                        fontSize: 16,
                        fontWeight: FontWeight.w600,
                        color: titleC,
                      ),
                    ),
                    if (item.mainBarcode != null && item.mainBarcode!.isNotEmpty)
                      Padding(
                        padding: const EdgeInsets.only(top: 2),
                        child: Text(
                          item.mainBarcode!,
                          style: TextStyle(fontSize: 12, color: barcodeC),
                        ),
                      ),
                    Padding(
                      padding: const EdgeInsets.only(top: 2),
                      child: Text(
                        item.code,
                        style: TextStyle(
                          fontSize: 13,
                          fontWeight: FontWeight.w600,
                          color: codeC,
                        ),
                      ),
                    ),
                    Padding(
                      padding: const EdgeInsets.only(top: 2),
                      child: Text(
                        '${InventoryStrings.invQoldiq(locale)}: ${item.availableQty.round()}',
                        style: TextStyle(fontSize: 13, color: metaC),
                      ),
                    ),
                  ],
                ),
              ),
              Icon(Icons.chevron_right, size: 22, color: chevronC),
            ],
          ),
        ),
      ),
    );
  }
}

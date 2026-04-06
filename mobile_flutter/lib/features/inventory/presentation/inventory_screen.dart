import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_svg/flutter_svg.dart';
import 'package:go_router/go_router.dart';
import 'package:google_fonts/google_fonts.dart';
import 'package:shimmer/shimmer.dart';

import '../../../shared/widgets/picker_footer.dart';
import '../data/models/picker_inventory_models.dart';
import '../data/picker_location_format.dart';
import 'inventory_locale.dart';
import 'inventory_list_controller.dart';
import 'inventory_providers.dart';

/// Corporate WMS inventory list (cosmetics distribution). Riverpod + routing unchanged.
class InventoryScreen extends ConsumerStatefulWidget {
  const InventoryScreen({super.key});

  @override
  ConsumerState<InventoryScreen> createState() => _InventoryScreenState();
}

class _InventoryScreenState extends ConsumerState<InventoryScreen> {
  late final TextEditingController _searchController;

  static const Color _navy = Color(0xFF0D1B2A);
  static const Color _navyLight = Color(0xFF1B263B);
  static const Color _scaffoldGrey = Color(0xFFF0F2F5);
  static const Color _stockOk = Color(0xFF2E7D32);
  static const Color _stockLow = Color(0xFFC62828);

  /// Minimal inline SVG (package icon) for AppBar accent — uses `flutter_svg`.
  static const String _kBarIconSvg =
      '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none">'
      '<path d="M12 2L8 6h8L12 2z" fill="white" opacity="0.9"/>'
      '<path d="M7 8v10c0 1.1.9 2 2 2h6c1.1 0 2-.9 2-2V8H7z" fill="white" opacity="0.85"/>'
      '</svg>';

  @override
  void initState() {
    super.initState();
    _searchController = TextEditingController(text: ref.read(inventoryQueryProvider));
  }

  @override
  void dispose() {
    _searchController.dispose();
    super.dispose();
  }

  String _warehouseLocationLine(PickerInventoryItem item) {
    if (item.bestLocation != null && item.bestLocation!.trim().isNotEmpty) {
      return item.bestLocation!.trim();
    }
    if (item.topLocations.isNotEmpty) {
      return item.topLocations.first.locationCode;
    }
    return '—';
  }

  @override
  Widget build(BuildContext context) {
    final bool isDark = Theme.of(context).brightness == Brightness.dark;
    final InventoryLocale locale = ref.watch(inventoryLocaleProvider);
    final InventoryViewState vm = ref.watch(inventoryListControllerProvider);
    final AsyncValue<List<PickerLocationOption>> locationsAsync =
        ref.watch(pickerLocationsProvider);
    final String locationId = ref.watch(inventoryLocationIdProvider);

    ref.listen<String>(inventoryQueryProvider, (_, String next) {
      if (_searchController.text != next) {
        _searchController.text = next;
      }
    });

    final Color scaffoldBg = isDark ? const Color(0xFF0F172A) : _scaffoldGrey;
    final Color cardBg = isDark ? _navyLight : Colors.white;
    final Color primaryText = isDark ? const Color(0xFFF1F5F9) : const Color(0xFF1A1A1A);
    final Color secondaryText = isDark ? const Color(0xFF94A3B8) : const Color(0xFF6B7280);
    final Color searchFill = isDark ? const Color(0xFF334155) : Colors.white;
    final Color searchBorder = isDark ? const Color(0xFF475569) : const Color(0xFFE5E7EB);

    final TextTheme baseText = Theme.of(context).textTheme;
    final TextTheme textTheme = GoogleFonts.interTextTheme(baseText);

    return Theme(
      data: Theme.of(context).copyWith(textTheme: textTheme),
      child: AnnotatedRegion<SystemUiOverlayStyle>(
        value: SystemUiOverlayStyle.light,
        child: Scaffold(
          backgroundColor: scaffoldBg,
          body: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: <Widget>[
              Material(
                color: _navy,
                elevation: 2,
                shadowColor: Colors.black26,
                child: SafeArea(
                  bottom: false,
                  child: Padding(
                    padding: const EdgeInsets.fromLTRB(8, 4, 8, 12),
                    child: Row(
                      children: <Widget>[
                        Padding(
                          padding: const EdgeInsets.only(left: 8, right: 10),
                          child: SvgPicture.string(
                            _kBarIconSvg,
                            width: 26,
                            height: 26,
                          ),
                        ),
                        Expanded(
                          child: Text(
                            InventoryStrings.invTitle(locale),
                            style: GoogleFonts.inter(
                              fontSize: 19,
                              fontWeight: FontWeight.w600,
                              color: Colors.white,
                              letterSpacing: -0.3,
                            ),
                          ),
                        ),
                        if (vm.headerRefreshing)
                          const Padding(
                            padding: EdgeInsets.all(12),
                            child: SizedBox(
                              width: 22,
                              height: 22,
                              child: CircularProgressIndicator(
                                strokeWidth: 2.2,
                                color: Colors.white,
                              ),
                            ),
                          )
                        else
                          IconButton(
                            tooltip: 'Yangilash',
                            onPressed: () =>
                                ref.read(inventoryListControllerProvider.notifier).refreshFromHeader(),
                            icon: const Icon(Icons.refresh_rounded, color: Colors.white),
                          ),
                      ],
                    ),
                  ),
                ),
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
                    cardBg: cardBg,
                    secondaryText: secondaryText,
                    primaryText: primaryText,
                    locale: locale,
                  );
                },
                loading: () => const SizedBox.shrink(),
                error: (_, __) => const SizedBox.shrink(),
              ),
              Expanded(
                child: _InventoryScrollContent(
                  vm: vm,
                  isDark: isDark,
                  scaffoldBg: scaffoldBg,
                  cardBg: cardBg,
                  primaryText: primaryText,
                  secondaryText: secondaryText,
                  searchFill: searchFill,
                  searchBorder: searchBorder,
                  locale: locale,
                  searchController: _searchController,
                  warehouseLocationLine: _warehouseLocationLine,
                  stockLowColor: _stockLow,
                  stockOkColor: _stockOk,
                ),
              ),
              const PickerFooter(current: PickerFooterRoute.inventory),
            ],
          ),
        ),
      ),
    );
  }
}

class _StickySearchDelegate extends SliverPersistentHeaderDelegate {
  _StickySearchDelegate({
    required this.isDark,
    required this.scaffoldBg,
    required this.searchFill,
    required this.searchBorder,
    required this.primaryText,
    required this.secondaryText,
    required this.locale,
    required this.controller,
    required this.onChanged,
    required this.onClear,
  });

  final bool isDark;
  final Color scaffoldBg;
  final Color searchFill;
  final Color searchBorder;
  final Color primaryText;
  final Color secondaryText;
  final InventoryLocale locale;
  final TextEditingController controller;
  final ValueChanged<String> onChanged;
  final VoidCallback onClear;

  static const double _height = 68;

  @override
  double get minExtent => _height;

  @override
  double get maxExtent => _height;

  @override
  Widget build(
    BuildContext context,
    double shrinkOffset,
    bool overlapsContent,
  ) {
    return Material(
      color: scaffoldBg,
      elevation: overlapsContent ? 1 : 0,
      shadowColor: Colors.black12,
      child: Padding(
        padding: const EdgeInsets.fromLTRB(16, 10, 16, 10),
        child: _StickySearchField(
          controller: controller,
          isDark: isDark,
          searchFill: searchFill,
          searchBorder: searchBorder,
          primaryText: primaryText,
          secondaryText: secondaryText,
          locale: locale,
          onChanged: onChanged,
          onClear: onClear,
        ),
      ),
    );
  }

  @override
  bool shouldRebuild(covariant _StickySearchDelegate oldDelegate) {
    return isDark != oldDelegate.isDark ||
        scaffoldBg != oldDelegate.scaffoldBg ||
        searchFill != oldDelegate.searchFill ||
        searchBorder != oldDelegate.searchBorder ||
        primaryText != oldDelegate.primaryText ||
        secondaryText != oldDelegate.secondaryText ||
        locale != oldDelegate.locale;
  }
}

class _StickySearchField extends StatefulWidget {
  const _StickySearchField({
    required this.controller,
    required this.isDark,
    required this.searchFill,
    required this.searchBorder,
    required this.primaryText,
    required this.secondaryText,
    required this.locale,
    required this.onChanged,
    required this.onClear,
  });

  final TextEditingController controller;
  final bool isDark;
  final Color searchFill;
  final Color searchBorder;
  final Color primaryText;
  final Color secondaryText;
  final InventoryLocale locale;
  final ValueChanged<String> onChanged;
  final VoidCallback onClear;

  @override
  State<_StickySearchField> createState() => _StickySearchFieldState();
}

class _StickySearchFieldState extends State<_StickySearchField> {
  @override
  void initState() {
    super.initState();
    widget.controller.addListener(_onText);
  }

  @override
  void didUpdateWidget(covariant _StickySearchField oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.controller != widget.controller) {
      oldWidget.controller.removeListener(_onText);
      widget.controller.addListener(_onText);
    }
  }

  @override
  void dispose() {
    widget.controller.removeListener(_onText);
    super.dispose();
  }

  void _onText() => setState(() {});

  @override
  Widget build(BuildContext context) {
    return TextField(
      controller: widget.controller,
      style: GoogleFonts.inter(fontSize: 15, color: widget.primaryText),
      decoration: InputDecoration(
        filled: true,
        fillColor: widget.searchFill,
        contentPadding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
        prefixIcon: Icon(Icons.search_rounded, color: widget.secondaryText, size: 22),
        suffixIcon: widget.controller.text.isNotEmpty
            ? IconButton(
                tooltip: 'Tozalash',
                onPressed: () {
                  widget.onClear();
                  setState(() {});
                },
                icon: Icon(Icons.clear_rounded, color: widget.secondaryText),
              )
            : null,
        hintText: InventoryStrings.invSearchPlaceholder(widget.locale),
        hintStyle: GoogleFonts.inter(
          fontSize: 15,
          color: widget.isDark ? const Color(0xFF64748B) : const Color(0xFF9CA3AF),
        ),
        border: OutlineInputBorder(
          borderRadius: BorderRadius.circular(12),
          borderSide: BorderSide(color: widget.searchBorder),
        ),
        enabledBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(12),
          borderSide: BorderSide(color: widget.searchBorder),
        ),
        focusedBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(12),
          borderSide: const BorderSide(color: Color(0xFF3B82F6), width: 1.4),
        ),
      ),
      textInputAction: TextInputAction.search,
      onChanged: widget.onChanged,
    );
  }
}

class _InventoryScrollContent extends ConsumerWidget {
  const _InventoryScrollContent({
    required this.vm,
    required this.isDark,
    required this.scaffoldBg,
    required this.cardBg,
    required this.primaryText,
    required this.secondaryText,
    required this.searchFill,
    required this.searchBorder,
    required this.locale,
    required this.searchController,
    required this.warehouseLocationLine,
    required this.stockLowColor,
    required this.stockOkColor,
  });

  final InventoryViewState vm;
  final bool isDark;
  final Color scaffoldBg;
  final Color cardBg;
  final Color primaryText;
  final Color secondaryText;
  final Color searchFill;
  final Color searchBorder;
  final InventoryLocale locale;
  final TextEditingController searchController;
  final String Function(PickerInventoryItem) warehouseLocationLine;
  final Color stockLowColor;
  final Color stockOkColor;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    void syncQueryFromField(String v) {
      ref.read(inventoryQueryProvider.notifier).state = v;
    }

    void clearSearch() {
      searchController.clear();
      ref.read(inventoryQueryProvider.notifier).state = '';
    }

    final Widget searchHeader = SliverPersistentHeader(
      pinned: true,
      delegate: _StickySearchDelegate(
        isDark: isDark,
        scaffoldBg: scaffoldBg,
        searchFill: searchFill,
        searchBorder: searchBorder,
        primaryText: primaryText,
        secondaryText: secondaryText,
        locale: locale,
        controller: searchController,
        onChanged: syncQueryFromField,
        onClear: clearSearch,
      ),
    );

    if (vm.loading && vm.items.isEmpty) {
      return CustomScrollView(
        slivers: <Widget>[
          searchHeader,
          SliverPadding(
            padding: const EdgeInsets.fromLTRB(16, 8, 16, 24),
            sliver: SliverList(
              delegate: SliverChildBuilderDelegate(
                (BuildContext context, int index) {
                  return Padding(
                    padding: const EdgeInsets.only(bottom: 12),
                    child: _ShimmerInventoryCard(isDark: isDark),
                  );
                },
                childCount: 8,
              ),
            ),
          ),
        ],
      );
    }

    if (vm.error != null) {
      return CustomScrollView(
        slivers: <Widget>[
          searchHeader,
          SliverFillRemaining(
            hasScrollBody: false,
            child: Center(
              child: Padding(
                padding: const EdgeInsets.all(24),
                child: Column(
                  mainAxisAlignment: MainAxisAlignment.center,
                  children: <Widget>[
                    Icon(Icons.error_outline_rounded, size: 52, color: Colors.red.shade400),
                    const SizedBox(height: 14),
                    Text(
                      vm.error!,
                      textAlign: TextAlign.center,
                      style: GoogleFonts.inter(
                        fontSize: 16,
                        color: isDark ? const Color(0xFFFCA5A5) : primaryText,
                      ),
                    ),
                    const SizedBox(height: 20),
                    FilledButton.icon(
                      style: FilledButton.styleFrom(
                        backgroundColor: _InventoryScreenState._navy,
                        padding: const EdgeInsets.symmetric(horizontal: 22, vertical: 12),
                        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
                      ),
                      onPressed: () {
                        ref.read(inventoryListControllerProvider.notifier).load(reset: true);
                      },
                      icon: const Icon(Icons.refresh_rounded),
                      label: Text(InventoryStrings.invRetry(locale), style: GoogleFonts.inter(fontWeight: FontWeight.w600)),
                    ),
                  ],
                ),
              ),
            ),
          ),
        ],
      );
    }

    if (vm.items.isEmpty) {
      return CustomScrollView(
        slivers: <Widget>[
          searchHeader,
          SliverFillRemaining(
            hasScrollBody: false,
            child: Center(
              child: Padding(
                padding: const EdgeInsets.all(24),
                child: Column(
                  mainAxisAlignment: MainAxisAlignment.center,
                  children: <Widget>[
                    Icon(Icons.inventory_2_outlined, size: 52, color: secondaryText),
                    const SizedBox(height: 14),
                    Text(
                      InventoryStrings.invNoResults(locale),
                      textAlign: TextAlign.center,
                      style: GoogleFonts.inter(fontSize: 16, color: secondaryText),
                    ),
                    const SizedBox(height: 20),
                    FilledButton.icon(
                      style: FilledButton.styleFrom(
                        backgroundColor: _InventoryScreenState._navy,
                        padding: const EdgeInsets.symmetric(horizontal: 22, vertical: 12),
                        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
                      ),
                      onPressed: () {
                        ref.read(inventoryListControllerProvider.notifier).load(reset: true);
                      },
                      icon: const Icon(Icons.refresh_rounded),
                      label: Text(InventoryStrings.invRetry(locale), style: GoogleFonts.inter(fontWeight: FontWeight.w600)),
                    ),
                  ],
                ),
              ),
            ),
          ),
        ],
      );
    }

    return NotificationListener<ScrollNotification>(
      onNotification: (ScrollNotification n) {
        if (n.metrics.pixels >= n.metrics.maxScrollExtent * 0.7) {
          ref.read(inventoryListControllerProvider.notifier).loadMore();
        }
        return false;
      },
      child: CustomScrollView(
        slivers: <Widget>[
          searchHeader,
          SliverPadding(
            padding: const EdgeInsets.fromLTRB(16, 8, 16, 24),
            sliver: SliverList(
              delegate: SliverChildBuilderDelegate(
                (BuildContext context, int index) {
                  if (index >= vm.items.length) {
                    return Padding(
                      padding: const EdgeInsets.symmetric(vertical: 20),
                      child: Center(
                        child: vm.loadingMore
                            ? const SizedBox(
                                width: 26,
                                height: 26,
                                child: CircularProgressIndicator(strokeWidth: 2.5),
                              )
                            : const SizedBox.shrink(),
                      ),
                    );
                  }
                  final PickerInventoryItem item = vm.items[index];
                  return Padding(
                    padding: const EdgeInsets.only(bottom: 12),
                    child: _CorporateInventoryCard(
                      item: item,
                      cardBg: cardBg,
                      primaryText: primaryText,
                      secondaryText: secondaryText,
                      stockLowColor: stockLowColor,
                      stockOkColor: stockOkColor,
                      warehouseLocation: warehouseLocationLine(item),
                      onTap: () {
                        context.pushNamed(
                          'inventoryDetail',
                          pathParameters: <String, String>{'productId': item.productId},
                        );
                      },
                    ),
                  );
                },
                childCount: vm.items.length + (vm.loadingMore ? 1 : 0),
              ),
            ),
          ),
        ],
      ),
    );
  }
}

class _ShimmerInventoryCard extends StatelessWidget {
  const _ShimmerInventoryCard({required this.isDark});

  final bool isDark;

  @override
  Widget build(BuildContext context) {
    final Color base = isDark ? const Color(0xFF334155) : const Color(0xFFE5E7EB);
    final Color highlight = isDark ? const Color(0xFF475569) : const Color(0xFFF3F4F6);

    return Shimmer.fromColors(
      baseColor: base,
      highlightColor: highlight,
      period: const Duration(milliseconds: 1200),
      child: Container(
        height: 108,
        decoration: BoxDecoration(
          color: isDark ? const Color(0xFF1E293B) : Colors.white,
          borderRadius: BorderRadius.circular(12),
        ),
        padding: const EdgeInsets.all(16),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: <Widget>[
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: <Widget>[
                  Container(height: 16, width: double.infinity, color: Colors.white),
                  const SizedBox(height: 10),
                  Container(height: 12, width: 120, color: Colors.white),
                  const SizedBox(height: 8),
                  Container(height: 12, width: 180, color: Colors.white),
                ],
              ),
            ),
            const SizedBox(width: 12),
            Container(width: 48, height: 28, color: Colors.white),
          ],
        ),
      ),
    );
  }
}

class _CorporateInventoryCard extends StatelessWidget {
  const _CorporateInventoryCard({
    required this.item,
    required this.cardBg,
    required this.primaryText,
    required this.secondaryText,
    required this.stockLowColor,
    required this.stockOkColor,
    required this.warehouseLocation,
    required this.onTap,
  });

  final PickerInventoryItem item;
  final Color cardBg;
  final Color primaryText;
  final Color secondaryText;
  final Color stockLowColor;
  final Color stockOkColor;
  final String warehouseLocation;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final int stockQty = item.availableQty.round();
    final bool lowStock = stockQty < 10;
    final Color qtyColor = lowStock ? stockLowColor : stockOkColor;

    return Material(
      color: cardBg,
      elevation: 0,
      borderRadius: BorderRadius.circular(12),
      shadowColor: Colors.transparent,
      child: InkWell(
        borderRadius: BorderRadius.circular(12),
        onTap: onTap,
        child: Container(
          decoration: BoxDecoration(
            borderRadius: BorderRadius.circular(12),
            color: cardBg,
            boxShadow: <BoxShadow>[
              BoxShadow(
                color: Colors.black.withValues(alpha: 0.06),
                blurRadius: 12,
                offset: const Offset(0, 4),
              ),
            ],
            border: Border.all(color: Colors.black.withValues(alpha: 0.04)),
          ),
          padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 14),
          child: Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: <Widget>[
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: <Widget>[
                    Text(
                      item.name,
                      maxLines: 2,
                      overflow: TextOverflow.ellipsis,
                      style: GoogleFonts.inter(
                        fontSize: 16,
                        fontWeight: FontWeight.w700,
                        color: primaryText,
                        height: 1.25,
                      ),
                    ),
                    const SizedBox(height: 6),
                    Text(
                      'SKU: ${item.code}',
                      style: GoogleFonts.inter(
                        fontSize: 13,
                        fontWeight: FontWeight.w500,
                        color: secondaryText,
                      ),
                    ),
                    const SizedBox(height: 4),
                    Row(
                      children: <Widget>[
                        Icon(Icons.warehouse_outlined, size: 16, color: secondaryText),
                        const SizedBox(width: 6),
                        Expanded(
                          child: Text(
                            warehouseLocation,
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                            style: GoogleFonts.inter(
                              fontSize: 13,
                              color: secondaryText,
                            ),
                          ),
                        ),
                      ],
                    ),
                  ],
                ),
              ),
              const SizedBox(width: 12),
              Column(
                crossAxisAlignment: CrossAxisAlignment.end,
                children: <Widget>[
                  Row(
                    mainAxisSize: MainAxisSize.min,
                    children: <Widget>[
                      Text(
                        '$stockQty',
                        style: GoogleFonts.inter(
                          fontSize: 20,
                          fontWeight: FontWeight.w800,
                          color: qtyColor,
                          height: 1,
                        ),
                      ),
                      if (lowStock) ...<Widget>[
                        const SizedBox(width: 4),
                        Icon(Icons.warning_amber_rounded, size: 22, color: stockLowColor),
                      ],
                    ],
                  ),
                  const SizedBox(height: 4),
                  Icon(Icons.chevron_right_rounded, size: 22, color: secondaryText.withValues(alpha: 0.7)),
                ],
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _LocationFilterRow extends ConsumerWidget {
  const _LocationFilterRow({
    required this.locations,
    required this.locationId,
    required this.isDark,
    required this.cardBg,
    required this.secondaryText,
    required this.primaryText,
    required this.locale,
  });

  final List<PickerLocationOption> locations;
  final String locationId;
  final bool isDark;
  final Color cardBg;
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
    return Padding(
      padding: const EdgeInsets.fromLTRB(16, 10, 16, 6),
      child: Material(
        color: cardBg,
        borderRadius: BorderRadius.circular(12),
        elevation: 0,
        child: InkWell(
          borderRadius: BorderRadius.circular(12),
          onTap: () => _openPicker(context, ref),
          child: Container(
            padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
            decoration: BoxDecoration(
              borderRadius: BorderRadius.circular(12),
              border: Border.all(color: Colors.black.withValues(alpha: 0.06)),
            ),
            child: Row(
              children: <Widget>[
                Text(
                  '${InventoryStrings.invBestLocation(locale)}:',
                  style: GoogleFonts.inter(fontSize: 13, color: secondaryText, fontWeight: FontWeight.w500),
                ),
                const SizedBox(width: 8),
                Icon(Icons.location_on_outlined, size: 18, color: secondaryText),
                const SizedBox(width: 6),
                Expanded(
                  child: Text(
                    _label(),
                    style: GoogleFonts.inter(fontSize: 14, fontWeight: FontWeight.w600, color: primaryText),
                    overflow: TextOverflow.ellipsis,
                  ),
                ),
                Icon(Icons.expand_more_rounded, size: 22, color: secondaryText),
              ],
            ),
          ),
        ),
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
                          style: GoogleFonts.inter(color: rowText, fontSize: 16),
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
                            style: GoogleFonts.inter(color: rowText, fontSize: 16),
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

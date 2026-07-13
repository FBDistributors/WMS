import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:google_fonts/google_fonts.dart';

import '../../../shared/input/input_clear_button.dart';
import '../data/models/picker_inventory_models.dart';
import '../data/picker_location_format.dart';
import 'inventory_locale.dart';
import 'inventory_providers.dart';

/// Bottom sheet with the inventory filters (location, brand, warehouse).
/// Edits a local draft and commits to the providers only on "Apply".
Future<void> showInventoryFilterSheet(BuildContext context) {
  return showModalBottomSheet<void>(
    context: context,
    isScrollControlled: true,
    backgroundColor: Colors.transparent,
    builder: (BuildContext ctx) => const _InventoryFilterSheet(),
  );
}

class _InventoryFilterSheet extends ConsumerStatefulWidget {
  const _InventoryFilterSheet();

  @override
  ConsumerState<_InventoryFilterSheet> createState() => _InventoryFilterSheetState();
}

class _InventoryFilterSheetState extends ConsumerState<_InventoryFilterSheet> {
  late String _location;
  late String _brand;
  late String _warehouse;

  @override
  void initState() {
    super.initState();
    _location = ref.read(inventoryLocationIdProvider);
    _brand = ref.read(inventoryBrandProvider);
    _warehouse = ref.read(inventoryWarehouseProvider);
  }

  @override
  Widget build(BuildContext context) {
    final bool isDark = Theme.of(context).brightness == Brightness.dark;
    final InventoryLocale locale = ref.watch(inventoryLocaleProvider);
    final AsyncValue<List<PickerLocationOption>> locationsAsync =
        ref.watch(pickerLocationsProvider);
    final AsyncValue<List<String>> brandsAsync = ref.watch(pickerBrandsProvider);

    final Color sheetBg = isDark ? const Color(0xFF1E293B) : Colors.white;
    final Color primaryText = isDark ? const Color(0xFFF1F5F9) : const Color(0xFF1A1A1A);
    final Color secondaryText = isDark ? const Color(0xFF94A3B8) : const Color(0xFF6B7280);
    final Color navy = const Color(0xFF1A237E);

    final List<PickerLocationOption> locations =
        locationsAsync.valueOrNull ?? const <PickerLocationOption>[];
    final List<String> brands = brandsAsync.valueOrNull ?? const <String>[];

    String locationLabel() {
      if (_location.isEmpty) {
        return InventoryStrings.invAllLocations(locale);
      }
      for (final PickerLocationOption l in locations) {
        if (l.id == _location) {
          return formatPickerLocationOptionLine(l);
        }
      }
      return _location;
    }

    String brandLabel() => _brand.isEmpty ? InventoryStrings.invAllBrands(locale) : _brand;

    return SafeArea(
      top: false,
      child: Padding(
        padding: EdgeInsets.only(bottom: MediaQuery.of(context).viewInsets.bottom),
        child: Container(
          decoration: BoxDecoration(
            color: sheetBg,
            borderRadius: const BorderRadius.vertical(top: Radius.circular(20)),
          ),
          padding: const EdgeInsets.fromLTRB(20, 12, 20, 20),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: <Widget>[
              Center(
                child: Container(
                  width: 40,
                  height: 4,
                  decoration: BoxDecoration(
                    color: secondaryText.withValues(alpha: 0.35),
                    borderRadius: BorderRadius.circular(2),
                  ),
                ),
              ),
              const SizedBox(height: 16),
              Text(
                InventoryStrings.invFilters(locale),
                style: GoogleFonts.inter(
                  fontSize: 18,
                  fontWeight: FontWeight.w800,
                  color: primaryText,
                ),
              ),
              const SizedBox(height: 18),

              // Warehouse — segmented
              _sectionLabel(InventoryStrings.invWarehouse(locale), secondaryText),
              const SizedBox(height: 8),
              _WarehouseSegment(
                value: _warehouse,
                isDark: isDark,
                navy: navy,
                primaryText: primaryText,
                secondaryText: secondaryText,
                locale: locale,
                onChanged: (String v) => setState(() => _warehouse = v),
              ),
              const SizedBox(height: 18),

              // Brand
              _sectionLabel(InventoryStrings.invBrand(locale), secondaryText),
              const SizedBox(height: 8),
              _selectRow(
                icon: Icons.sell_outlined,
                label: brandLabel(),
                enabled: brands.isNotEmpty,
                isDark: isDark,
                primaryText: primaryText,
                secondaryText: secondaryText,
                onTap: () async {
                  final String? picked = await _pickFromList(
                    context: context,
                    title: InventoryStrings.invBrand(locale),
                    allLabel: InventoryStrings.invAllBrands(locale),
                    options: <_PickOption>[
                      for (final String b in brands) _PickOption(value: b, label: b),
                    ],
                    isDark: isDark,
                    locale: locale,
                  );
                  if (picked != null) {
                    setState(() => _brand = picked);
                  }
                },
              ),
              const SizedBox(height: 18),

              // Location
              _sectionLabel(InventoryStrings.invBestLocation(locale), secondaryText),
              const SizedBox(height: 8),
              _selectRow(
                icon: Icons.location_on_outlined,
                label: locationLabel(),
                enabled: locations.isNotEmpty,
                isDark: isDark,
                primaryText: primaryText,
                secondaryText: secondaryText,
                onTap: () async {
                  final String? picked = await _pickFromList(
                    context: context,
                    title: InventoryStrings.invBestLocation(locale),
                    allLabel: InventoryStrings.invAllLocations(locale),
                    options: <_PickOption>[
                      for (final PickerLocationOption l in locations)
                        _PickOption(
                          value: l.id,
                          label: formatPickerLocationOptionLine(l) +
                              (l.name.isNotEmpty && l.name != l.code ? ' — ${l.name}' : ''),
                          searchText: '${l.code} ${l.name}',
                        ),
                    ],
                    isDark: isDark,
                    locale: locale,
                  );
                  if (picked != null) {
                    setState(() => _location = picked);
                  }
                },
              ),
              const SizedBox(height: 24),

              Row(
                children: <Widget>[
                  Expanded(
                    child: OutlinedButton(
                      onPressed: () {
                        setState(() {
                          _location = '';
                          _brand = '';
                          _warehouse = '';
                        });
                      },
                      style: OutlinedButton.styleFrom(
                        padding: const EdgeInsets.symmetric(vertical: 14),
                        side: BorderSide(color: secondaryText.withValues(alpha: 0.5)),
                        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
                      ),
                      child: Text(
                        InventoryStrings.invClearFilters(locale),
                        style: GoogleFonts.inter(
                          fontWeight: FontWeight.w600,
                          color: primaryText,
                        ),
                      ),
                    ),
                  ),
                  const SizedBox(width: 12),
                  Expanded(
                    child: FilledButton(
                      onPressed: () {
                        ref.read(inventoryLocationIdProvider.notifier).state = _location;
                        ref.read(inventoryBrandProvider.notifier).state = _brand;
                        ref.read(inventoryWarehouseProvider.notifier).state = _warehouse;
                        Navigator.of(context).pop();
                      },
                      style: FilledButton.styleFrom(
                        backgroundColor: isDark ? const Color(0xFF3B82F6) : navy,
                        padding: const EdgeInsets.symmetric(vertical: 14),
                        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
                      ),
                      child: Text(
                        InventoryStrings.invApply(locale),
                        style: GoogleFonts.inter(fontWeight: FontWeight.w700),
                      ),
                    ),
                  ),
                ],
              ),
            ],
          ),
        ),
      ),
    );
  }

  Widget _sectionLabel(String text, Color color) {
    return Text(
      text,
      style: GoogleFonts.inter(fontSize: 13, fontWeight: FontWeight.w600, color: color),
    );
  }

  Widget _selectRow({
    required IconData icon,
    required String label,
    required bool enabled,
    required bool isDark,
    required Color primaryText,
    required Color secondaryText,
    required VoidCallback onTap,
  }) {
    final Color border = isDark ? const Color(0xFF475569) : const Color(0xFFE5E7EB);
    final Color fill = isDark ? const Color(0xFF334155) : const Color(0xFFF8FAFC);
    return Material(
      color: fill,
      borderRadius: BorderRadius.circular(12),
      child: InkWell(
        borderRadius: BorderRadius.circular(12),
        onTap: enabled ? onTap : null,
        child: Container(
          padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 14),
          decoration: BoxDecoration(
            borderRadius: BorderRadius.circular(12),
            border: Border.all(color: border),
          ),
          child: Row(
            children: <Widget>[
              Icon(icon, size: 20, color: secondaryText),
              const SizedBox(width: 10),
              Expanded(
                child: Text(
                  label,
                  overflow: TextOverflow.ellipsis,
                  style: GoogleFonts.inter(
                    fontSize: 15,
                    fontWeight: FontWeight.w600,
                    color: enabled ? primaryText : secondaryText,
                  ),
                ),
              ),
              Icon(Icons.expand_more_rounded, size: 22, color: secondaryText),
            ],
          ),
        ),
      ),
    );
  }
}

class _WarehouseSegment extends StatelessWidget {
  const _WarehouseSegment({
    required this.value,
    required this.isDark,
    required this.navy,
    required this.primaryText,
    required this.secondaryText,
    required this.locale,
    required this.onChanged,
  });

  final String value;
  final bool isDark;
  final Color navy;
  final Color primaryText;
  final Color secondaryText;
  final InventoryLocale locale;
  final ValueChanged<String> onChanged;

  @override
  Widget build(BuildContext context) {
    final List<(String, String)> options = <(String, String)>[
      ('', InventoryStrings.invWarehouseAll(locale)),
      ('main', InventoryStrings.invWarehouseMain(locale)),
      ('showroom', InventoryStrings.invWarehouseShowroom(locale)),
    ];
    final Color border = isDark ? const Color(0xFF475569) : const Color(0xFFE5E7EB);
    final Color activeBg = isDark ? const Color(0xFF3B82F6) : navy;
    return Container(
      decoration: BoxDecoration(
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: border),
      ),
      padding: const EdgeInsets.all(4),
      child: Row(
        children: <Widget>[
          for (final (String v, String label) in options)
            Expanded(
              child: Material(
                color: v == value ? activeBg : Colors.transparent,
                borderRadius: BorderRadius.circular(9),
                child: InkWell(
                  borderRadius: BorderRadius.circular(9),
                  onTap: () => onChanged(v),
                  child: Padding(
                    padding: const EdgeInsets.symmetric(vertical: 10),
                    child: Text(
                      label,
                      textAlign: TextAlign.center,
                      style: GoogleFonts.inter(
                        fontSize: 14,
                        fontWeight: FontWeight.w600,
                        color: v == value ? Colors.white : secondaryText,
                      ),
                    ),
                  ),
                ),
              ),
            ),
        ],
      ),
    );
  }
}

class _PickOption {
  const _PickOption({required this.value, required this.label, this.searchText});

  final String value;
  final String label;
  final String? searchText;

  String get _haystack => (searchText ?? label).toLowerCase();
}

/// Searchable single-select dialog. Returns the chosen value ('' for "all"),
/// or null if dismissed without choosing.
Future<String?> _pickFromList({
  required BuildContext context,
  required String title,
  required String allLabel,
  required List<_PickOption> options,
  required bool isDark,
  required InventoryLocale locale,
}) {
  final Color modalBg = isDark ? const Color(0xFF1E293B) : Colors.white;
  final Color rowText = isDark ? const Color(0xFFF1F5F9) : const Color(0xFF333333);
  final Color searchFill = isDark ? const Color(0xFF334155) : const Color(0xFFF8FAFC);
  final Color searchBorder = isDark ? const Color(0xFF475569) : const Color(0xFFE2E8F0);
  final TextEditingController searchController = TextEditingController();

  return showDialog<String>(
    context: context,
    barrierDismissible: true,
    builder: (BuildContext ctx) {
      return StatefulBuilder(
        builder: (BuildContext context, void Function(void Function()) setM) {
          final String q = searchController.text.trim().toLowerCase();
          final List<_PickOption> filtered = q.isEmpty
              ? options
              : options.where((_PickOption o) => o._haystack.contains(q)).toList(growable: false);
          return Material(
            color: Colors.black54,
            child: InkWell(
              onTap: () => Navigator.of(ctx).pop(),
              child: Center(
                child: InkWell(
                  onTap: () {},
                  child: Container(
                    margin: const EdgeInsets.all(24),
                    constraints: const BoxConstraints(maxHeight: 460),
                    decoration: BoxDecoration(
                      color: modalBg,
                      borderRadius: BorderRadius.circular(12),
                    ),
                    child: Column(
                      mainAxisSize: MainAxisSize.min,
                      children: <Widget>[
                        Padding(
                          padding: const EdgeInsets.fromLTRB(14, 14, 14, 10),
                          child: TextField(
                            controller: searchController,
                            onChanged: (_) => setM(() {}),
                            style: GoogleFonts.inter(color: rowText, fontSize: 14),
                            decoration: InputDecoration(
                              hintText: '${InventoryStrings.invSearch(locale)} ${title.toLowerCase()}',
                              prefixIcon: Icon(Icons.search_rounded, color: rowText.withValues(alpha: 0.7)),
                              suffixIcon: searchController.text.isNotEmpty
                                  ? buildInputClearButton(
                                      visible: true,
                                      onPressed: () {
                                        searchController.clear();
                                        setM(() {});
                                      },
                                    )
                                  : null,
                              filled: true,
                              fillColor: searchFill,
                              border: OutlineInputBorder(
                                borderRadius: BorderRadius.circular(12),
                                borderSide: BorderSide(color: searchBorder),
                              ),
                              enabledBorder: OutlineInputBorder(
                                borderRadius: BorderRadius.circular(12),
                                borderSide: BorderSide(color: searchBorder),
                              ),
                              focusedBorder: OutlineInputBorder(
                                borderRadius: BorderRadius.circular(12),
                                borderSide: const BorderSide(color: Color(0xFF3B82F6), width: 1.4),
                              ),
                            ),
                          ),
                        ),
                        Flexible(
                          child: ListView(
                            shrinkWrap: true,
                            children: <Widget>[
                              if (q.isEmpty)
                                ListTile(
                                  title: Text(
                                    allLabel,
                                    style: GoogleFonts.inter(color: rowText, fontSize: 16),
                                  ),
                                  onTap: () => Navigator.of(ctx).pop(''),
                                ),
                              if (filtered.isEmpty)
                                Padding(
                                  padding: const EdgeInsets.fromLTRB(16, 18, 16, 20),
                                  child: Text(
                                    InventoryStrings.invNoResults(locale),
                                    textAlign: TextAlign.center,
                                    style: GoogleFonts.inter(
                                      color: rowText.withValues(alpha: 0.75),
                                      fontSize: 14,
                                    ),
                                  ),
                                ),
                              ...filtered.map((_PickOption o) {
                                return ListTile(
                                  title: Text(
                                    o.label,
                                    style: GoogleFonts.inter(color: rowText, fontSize: 16),
                                  ),
                                  onTap: () => Navigator.of(ctx).pop(o.value),
                                );
                              }),
                            ],
                          ),
                        ),
                      ],
                    ),
                  ),
                ),
              ),
            ),
          );
        },
      );
    },
  ).whenComplete(searchController.dispose);
}

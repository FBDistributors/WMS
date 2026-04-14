import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../features/inventory/data/models/picker_inventory_models.dart';
import '../../features/inventory/presentation/inventory_providers.dart';

/// RN `BarcodeSearchInput` bilan bir xil: `listPickerInventory(q)` — ilike SKU/nom/shtrix.
class BarcodeSearchInput extends ConsumerStatefulWidget {
  const BarcodeSearchInput({
    super.key,
    required this.onSelectProduct,
    this.label,
    this.hint,
    this.onProductScanPressed,
    this.showClearButton = false,
  });

  final void Function(String productId) onSelectProduct;
  final String? label;
  final String? hint;

  /// Mahsulot shtrixini skanerlash (masalan kirim `flow=new`).
  final VoidCallback? onProductScanPressed;
  final bool showClearButton;

  @override
  ConsumerState<BarcodeSearchInput> createState() => _BarcodeSearchInputState();
}

class _BarcodeSearchInputState extends ConsumerState<BarcodeSearchInput> {
  static const Duration _debounce = Duration(milliseconds: 300);
  static const int _limit = 20;

  final TextEditingController _c = TextEditingController();
  Timer? _debounceTimer;
  int _suggestSeq = 0;

  bool _loading = false;
  bool _suggestionsLoading = false;
  String? _error;
  List<PickerInventoryItem> _suggestions = const <PickerInventoryItem>[];

  @override
  void dispose() {
    _debounceTimer?.cancel();
    _c.dispose();
    super.dispose();
  }

  void _onTextChanged(String _) {
    _debounceTimer?.cancel();
    final String q = _c.text.trim();
    if (q.isEmpty) {
      setState(() {
        _suggestions = const <PickerInventoryItem>[];
        _suggestionsLoading = false;
        _error = null;
      });
      return;
    }
    if (_error != null) {
      setState(() => _error = null);
    }
    _debounceTimer = Timer(_debounce, () => _loadSuggestions(q));
  }

  Future<void> _loadSuggestions(String q) async {
    final int seq = ++_suggestSeq;
    if (mounted) {
      setState(() => _suggestionsLoading = true);
    }
    try {
      final PickerInventoryListResponse res =
          await ref.read(inventoryRepositoryProvider).listPickerInventory(
                q: q,
                limit: _limit,
              );
      if (!mounted || seq != _suggestSeq) {
        return;
      }
      setState(() {
        _suggestions = res.items;
        _suggestionsLoading = false;
      });
    } on Exception {
      if (!mounted || seq != _suggestSeq) {
        return;
      }
      setState(() {
        _suggestions = const <PickerInventoryItem>[];
        _suggestionsLoading = false;
      });
    }
  }

  void _select(PickerInventoryItem item) {
    widget.onSelectProduct(item.productId);
    _c.clear();
    _debounceTimer?.cancel();
    setState(() {
      _suggestions = const <PickerInventoryItem>[];
      _error = null;
      _suggestionsLoading = false;
    });
  }

  void _clearInput() {
    _c.clear();
    _debounceTimer?.cancel();
    setState(() {
      _suggestions = const <PickerInventoryItem>[];
      _error = null;
      _suggestionsLoading = false;
    });
  }

  Future<void> _resolve() async {
    final String q = _c.text.trim();
    if (q.isEmpty) {
      return;
    }
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final PickerInventoryListResponse res =
          await ref.read(inventoryRepositoryProvider).listPickerInventory(
                q: q,
                limit: _limit,
              );
      if (!mounted) {
        return;
      }
      final List<PickerInventoryItem> items = res.items;
      if (items.isEmpty) {
        setState(() => _error = "Natija yo'q");
      } else if (items.length == 1) {
        _select(items.first);
      } else {
        final PickerInventoryItem? chosen = await _showPickSheet(items);
        if (chosen != null && mounted) {
          _select(chosen);
        }
      }
    } on Exception catch (e) {
      if (mounted) {
        setState(() => _error = '$e');
      }
    } finally {
      if (mounted) {
        setState(() => _loading = false);
      }
    }
  }

  Future<PickerInventoryItem?> _showPickSheet(List<PickerInventoryItem> items) {
    return showModalBottomSheet<PickerInventoryItem>(
      context: context,
      isScrollControlled: true,
      builder: (BuildContext ctx) {
        return SafeArea(
          child: ConstrainedBox(
            constraints: BoxConstraints(
              maxHeight: MediaQuery.sizeOf(ctx).height * 0.55,
            ),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: <Widget>[
                Padding(
                  padding: const EdgeInsets.fromLTRB(16, 12, 8, 8),
                  child: Row(
                    children: <Widget>[
                      const Expanded(
                        child: Text(
                          'Mahsulotni tanlang',
                          style: TextStyle(fontSize: 16, fontWeight: FontWeight.w600),
                        ),
                      ),
                      IconButton(
                        icon: const Icon(Icons.close),
                        onPressed: () => Navigator.pop(ctx),
                      ),
                    ],
                  ),
                ),
                const Divider(height: 1),
                Expanded(
                  child: ListView.builder(
                    itemCount: items.length,
                    itemBuilder: (BuildContext _, int i) {
                      final PickerInventoryItem it = items[i];
                      final String? b = it.mainBarcode;
                      final String sub = b != null && b.isNotEmpty ? '${it.code} · $b' : it.code;
                      return ListTile(
                        title: Text(it.name, maxLines: 2, overflow: TextOverflow.ellipsis),
                        subtitle: Text(sub, maxLines: 1, overflow: TextOverflow.ellipsis),
                        onTap: () => Navigator.pop(ctx, it),
                      );
                    },
                  ),
                ),
              ],
            ),
          ),
        );
      },
    );
  }

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: <Widget>[
        TextField(
          controller: _c,
          onChanged: _onTextChanged,
          decoration: InputDecoration(
            labelText: widget.label ?? 'Barcode',
            hintText: widget.hint,
            border: const OutlineInputBorder(),
            prefixIcon: widget.onProductScanPressed != null
                ? IconButton(
                    icon: const Icon(Icons.camera_alt),
                    onPressed: widget.onProductScanPressed,
                  )
                : null,
            suffixIconConstraints: const BoxConstraints(minWidth: 96, minHeight: 48),
            suffixIcon: _loading
                ? const Padding(
                    padding: EdgeInsets.all(12),
                    child: SizedBox(
                      width: 20,
                      height: 20,
                      child: CircularProgressIndicator(strokeWidth: 2),
                    ),
                  )
                : widget.onProductScanPressed != null
                    ? Row(
                        mainAxisSize: MainAxisSize.min,
                        children: <Widget>[
                          if (widget.showClearButton && _c.text.trim().isNotEmpty)
                            IconButton(
                              icon: const Icon(Icons.close),
                              onPressed: _clearInput,
                            ),
                          IconButton(
                            icon: const Icon(Icons.search),
                            onPressed: _resolve,
                          ),
                        ],
                      )
                    : Row(
                        mainAxisSize: MainAxisSize.min,
                        children: <Widget>[
                          if (widget.showClearButton && _c.text.trim().isNotEmpty)
                            IconButton(
                              icon: const Icon(Icons.close),
                              onPressed: _clearInput,
                            ),
                          IconButton(
                            icon: const Icon(Icons.search),
                            onPressed: _resolve,
                          ),
                        ],
                      ),
          ),
          onSubmitted: (_) => _resolve(),
        ),
        if (_error != null)
          Padding(
            padding: const EdgeInsets.only(top: 8),
            child: Text(_error!, style: TextStyle(color: Theme.of(context).colorScheme.error)),
          ),
        if (_suggestionsLoading)
          const Padding(
            padding: EdgeInsets.only(top: 12),
            child: Center(
              child: SizedBox(
                width: 22,
                height: 22,
                child: CircularProgressIndicator(strokeWidth: 2),
              ),
            ),
          )
        else if (_suggestions.isNotEmpty)
          Padding(
            padding: const EdgeInsets.only(top: 8),
            child: Material(
              elevation: 1,
              borderRadius: BorderRadius.circular(8),
              clipBehavior: Clip.antiAlias,
              child: ConstrainedBox(
                constraints: const BoxConstraints(maxHeight: 220),
                child: ListView.builder(
                  shrinkWrap: true,
                  padding: EdgeInsets.zero,
                  itemCount: _suggestions.length,
                  itemBuilder: (BuildContext _, int i) {
                    final PickerInventoryItem it = _suggestions[i];
                    final String? b = it.mainBarcode;
                    final String sub = b != null && b.isNotEmpty ? '${it.code} · $b' : it.code;
                    return ListTile(
                      dense: true,
                      title: Text(it.name, maxLines: 2, overflow: TextOverflow.ellipsis),
                      subtitle: Text(sub, maxLines: 1, overflow: TextOverflow.ellipsis),
                      onTap: () => _select(it),
                    );
                  },
                ),
              ),
            ),
          ),
      ],
    );
  }
}

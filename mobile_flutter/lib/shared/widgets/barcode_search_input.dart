import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../features/inventory/presentation/inventory_providers.dart';

/// RN `BarcodeSearchInput` — soddalashtirilgan: barcode bo‘yicha mahsulot ID qaytaradi.
class BarcodeSearchInput extends ConsumerStatefulWidget {
  const BarcodeSearchInput({
    super.key,
    required this.onSelectProduct,
    this.label,
    this.hint,
  });

  final void Function(String productId) onSelectProduct;
  final String? label;
  final String? hint;

  @override
  ConsumerState<BarcodeSearchInput> createState() => _BarcodeSearchInputState();
}

class _BarcodeSearchInputState extends ConsumerState<BarcodeSearchInput> {
  final TextEditingController _c = TextEditingController();
  bool _loading = false;
  String? _error;

  @override
  void dispose() {
    _c.dispose();
    super.dispose();
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
      final res =
          await ref.read(inventoryRepositoryProvider).getInventoryByBarcode(q);
      if (mounted) {
        widget.onSelectProduct(res.productId);
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

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: <Widget>[
        TextField(
          controller: _c,
          decoration: InputDecoration(
            labelText: widget.label ?? 'Barcode',
            hintText: widget.hint,
            border: const OutlineInputBorder(),
            suffixIcon: _loading
                ? const Padding(
                    padding: EdgeInsets.all(12),
                    child: SizedBox(
                      width: 20,
                      height: 20,
                      child: CircularProgressIndicator(strokeWidth: 2),
                    ),
                  )
                : IconButton(
                    icon: const Icon(Icons.search),
                    onPressed: _loading ? null : _resolve,
                  ),
          ),
          onSubmitted: (_) => _resolve(),
        ),
        if (_error != null)
          Padding(
            padding: const EdgeInsets.only(top: 8),
            child: Text(_error!, style: TextStyle(color: Theme.of(context).colorScheme.error)),
          ),
      ],
    );
  }
}

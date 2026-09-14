import 'package:flutter/material.dart';

import '../../../core/app_state/app_locale.dart';
import '../../../core/formatting/expiry_display_format.dart';
import '../../../l10n/string_lookup.dart';
import '../../picking/data/picking_models.dart' show formatPickQty;
import '../data/dealer_counts_models.dart' show monthStartIso;

/// Diller sanovi — miqdor/muddat kiritish oynasi natijasi.
class DealerQtyResult {
  const DealerQtyResult({required this.qty, required this.expiryIso, this.mode = 'set', this.delete = false});

  /// `set`: jami; `add`: ustiga qo'shiladigan son.
  final double qty;
  final String? expiryIso;
  /// set — birinchi sanash yoki tuzatish; add — qayta skanda qo'shish.
  final String mode;
  final bool delete;
}

/// Miqdor oynasi. Qator hali sanalmagan bo'lsa — bitta "Fakt qoldiq" maydoni. Sanalgan bo'lsa
/// (qayta skan) — oldingi son ko'rinadi va fokus "Qo'shish (+)" maydonida: oldingi son saqlanib,
/// yangisi ustiga qo'shiladi. Oldingi son xato bo'lsa — "Umumiy sonni tuzatish" (jami yoziladi).
class DealerQtySheet extends StatefulWidget {
  const DealerQtySheet({
    super.key,
    required this.loc,
    required this.title,
    required this.subtitle,
    required this.previousQty,
    required this.initialExpiry,
    required this.boxUnits,
    required this.allowDelete,
    this.previousBy,
  });

  final AppLocale loc;
  final String title;
  final String subtitle;
  /// Oldin kiritilgan jami — null bo'lsa qator hali sanalmagan (birinchi sanash).
  final double? previousQty;
  /// "Ali · 14:05" yoki "shu telefonda" — oldingi sonni kim kiritgan.
  final String? previousBy;
  final String? initialExpiry;
  /// Quti kodi skanerlangan bo'lsa — hajm (faqat maslahat tugmasi).
  final int? boxUnits;
  final bool allowDelete;

  @override
  State<DealerQtySheet> createState() => DealerQtySheetState();
}

class DealerQtySheetState extends State<DealerQtySheet> {
  final TextEditingController _qty = TextEditingController();
  late bool _addMode;
  String? _expiry;

  @override
  void initState() {
    super.initState();
    _addMode = widget.previousQty != null;
    _expiry = widget.initialExpiry;
    _qty.addListener(() => setState(() {}));
  }

  double? _parsed() {
    final String t = _qty.text.trim().replaceAll(',', '.');
    return t.isEmpty ? null : double.tryParse(t);
  }

  /// Qo'shishda son musbat bo'lishi kerak (kamaytirish — faqat tuzatish orqali); jamida 0 ham javob.
  bool get _canConfirm {
    final double? v = _parsed();
    return v != null && (_addMode ? v > 0 : v >= 0);
  }

  void _toggleMode() {
    setState(() {
      _addMode = !_addMode;
      _qty.text = _addMode ? '' : formatPickQty(widget.previousQty ?? 0);
      _qty.selection = TextSelection(baseOffset: 0, extentOffset: _qty.text.length);
    });
  }

  @override
  void dispose() {
    _qty.dispose();
    super.dispose();
  }

  Future<void> _pickExpiry() async {
    final DateTime now = DateTime.now();
    final DateTime? picked = await showDatePicker(
      context: context,
      initialDate: _expiry != null ? (DateTime.tryParse(_expiry!) ?? now) : now,
      firstDate: DateTime(now.year - 3),
      lastDate: DateTime(now.year + 6),
      initialDatePickerMode: DatePickerMode.year,
    );
    if (picked != null) {
      setState(() => _expiry = monthStartIso(picked));
    }
  }

  @override
  Widget build(BuildContext context) {
    final AppLocale loc = widget.loc;
    final ColorScheme cs = Theme.of(context).colorScheme;
    final double? prev = widget.previousQty;
    final double? v = _parsed();
    return SafeArea(
      child: Padding(
        padding: EdgeInsets.fromLTRB(16, 16, 16, 16 + MediaQuery.viewInsetsOf(context).bottom),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: <Widget>[
            Text(widget.title, style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 16)),
            const SizedBox(height: 2),
            Text(widget.subtitle, style: TextStyle(color: cs.onSurfaceVariant, fontFamily: 'monospace', fontSize: 13)),
            if (prev != null) ...<Widget>[
              const SizedBox(height: 12),
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
                decoration: BoxDecoration(
                  color: cs.surfaceContainerHighest,
                  borderRadius: BorderRadius.circular(10),
                ),
                child: Row(
                  children: <Widget>[
                    Expanded(child: Text(StringLookup.t(loc, 'dealerQtyPrevious'), style: TextStyle(color: cs.onSurfaceVariant))),
                    Column(
                      crossAxisAlignment: CrossAxisAlignment.end,
                      children: <Widget>[
                        Text(
                          '${formatPickQty(prev)} ${StringLookup.t(loc, 'dealerQtyUnit')}',
                          style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 16),
                        ),
                        if (widget.previousBy != null)
                          Text(widget.previousBy!, style: TextStyle(fontSize: 12, color: cs.onSurfaceVariant)),
                      ],
                    ),
                  ],
                ),
              ),
            ],
            const SizedBox(height: 14),
            TextField(
              controller: _qty,
              autofocus: true,
              keyboardType: const TextInputType.numberWithOptions(decimal: false),
              decoration: InputDecoration(
                labelText: StringLookup.t(loc, _addMode ? 'dealerQtyAddLabel' : (prev != null ? 'dealerQtyTotalLabel' : 'dealerCountQtyTitle')),
                hintText: _addMode ? null : StringLookup.t(loc, 'dealerCountQtyHint'),
                prefixText: _addMode ? '+ ' : null,
                border: const OutlineInputBorder(),
              ),
            ),
            if (_addMode && prev != null) ...<Widget>[
              const SizedBox(height: 6),
              Text(
                StringLookup.tParams(loc, 'dealerQtyWillBe', <String, String>{
                  'prev': formatPickQty(prev),
                  'add': v != null && v > 0 ? formatPickQty(v) : '…',
                  'total': v != null && v > 0 ? formatPickQty(prev + v) : '…',
                }),
                style: TextStyle(fontWeight: FontWeight.w600, color: cs.primary),
              ),
            ],
            if (widget.boxUnits != null) ...<Widget>[
              const SizedBox(height: 8),
              Align(
                alignment: Alignment.centerLeft,
                child: ActionChip(
                  avatar: const Icon(Icons.inventory_2_outlined, size: 16),
                  label: Text(
                    StringLookup.tParams(loc, 'dealerCountBoxHint', <String, String>{'n': '${widget.boxUnits}'}),
                  ),
                  onPressed: () {
                    // Bosilganda: bo'sh bo'lsa hajm qo'yiladi, aks holda hajm qo'shiladi
                    // (2 quti skanerlangan bo'lsa ikki marta bosadi).
                    _qty.text = formatPickQty((v ?? 0) + widget.boxUnits!);
                  },
                ),
              ),
            ],
            const SizedBox(height: 10),
            OutlinedButton.icon(
              onPressed: _pickExpiry,
              icon: const Icon(Icons.event_outlined),
              label: Text(
                _expiry != null
                    ? '${StringLookup.t(loc, 'dealerCountExpiryLabel')}: ${formatExpiryMonthYear(_expiry)}'
                    : StringLookup.t(loc, 'dealerCountExpiryLabel'),
              ),
            ),
            if (_expiry != null)
              TextButton(
                onPressed: () => setState(() => _expiry = null),
                child: Text(StringLookup.t(loc, 'cancel')),
              ),
            if (prev != null)
              Align(
                alignment: Alignment.centerLeft,
                child: TextButton(
                  onPressed: _toggleMode,
                  child: Text(StringLookup.t(loc, _addMode ? 'dealerQtyCorrect' : 'dealerQtyBackToAdd')),
                ),
              ),
            const SizedBox(height: 8),
            Row(
              children: <Widget>[
                if (widget.allowDelete)
                  TextButton.icon(
                    onPressed: () => Navigator.of(context).pop(const DealerQtyResult(qty: 0, expiryIso: null, delete: true)),
                    icon: const Icon(Icons.delete_outline, color: Colors.red),
                    label: Text(StringLookup.t(loc, 'dealerCountRemoveLine'), style: const TextStyle(color: Colors.red)),
                  ),
                const Spacer(),
                FilledButton(
                  onPressed: !_canConfirm
                      ? null
                      : () => Navigator.of(context).pop(
                            DealerQtyResult(qty: v!, expiryIso: _expiry, mode: _addMode ? 'add' : 'set'),
                          ),
                  child: Text(
                    _addMode
                        ? StringLookup.tParams(loc, 'dealerQtyAddButton', <String, String>{'n': v != null && v > 0 ? formatPickQty(v) : ''})
                        : StringLookup.t(loc, 'confirmButton'),
                  ),
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }
}

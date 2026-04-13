import 'package:flutter/services.dart';

/// Qoldiq / miqdor kiritish: musbat butun son (0–9), manfiy va kasr emas.
const TextInputType kStockQtyKeyboardType = TextInputType.numberWithOptions(
  signed: false,
  decimal: false,
);

final List<TextInputFormatter> kStockQtyInputFormatters = <TextInputFormatter>[
  FilteringTextInputFormatter.digitsOnly,
];

package uz.fbwarehouse.android.ui.format

/** Butun son bo'lsa ".0"siz, aks holda o'nlik qismi bilan ko'rsatadi. */
fun formatQty(value: Double): String =
    if (value == value.toLong().toDouble()) value.toLong().toString() else value.toString()

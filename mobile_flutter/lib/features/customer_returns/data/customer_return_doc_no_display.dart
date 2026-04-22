/// Backend `CRET-YYYYMMDD-{6 hex}` ni UI da qisqartirish (token yashirin).
String displayCustomerReturnDocNo(String docNo) {
  final String t = docNo.trim();
  final RegExpMatch? m = RegExp(r'^CRET-(\d{8})-([0-9A-Fa-f]{6})$').firstMatch(t);
  if (m != null) {
    return 'CRET-${m.group(1)}';
  }
  return docNo;
}

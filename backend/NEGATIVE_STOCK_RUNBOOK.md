# Negative Stock Runbook

## Qatiy qoida
- Normal API har qanday `on_hand < 0`, `reserved < 0`, yoki `available < 0` holatga olib boruvchi yozuvni rad etadi (`409`).
- `allocate` faqat `available` yetarli bo'lganda yoziladi.
- `unallocate` faqat mavjud `reserved` doirasida yoziladi.
- Bulk/reset operatsiyalari yakunda invariant verifikatsiyasidan o'tmasa rollback qilinadi.

## Diagnostika bosqichlari
- `GET /api/v1/inventory/negative-balance-check` orqali manfiy lot/locationlarni aniqlang.
- `GET /api/v1/inventory/balance-diagnostic?lot_id=...&location_id=...` bilan root-cause ni tekshiring.
- Agar tarixiy xato bo'lsa, faqat maintenance endpointlar orqali ta'mirlash yozuvlarini kiriting.

## Zero/Reset amaliyoti
- `brand_only`: `available` ni 0 ga keltiradi (reserve saqlanadi).
- `reserve_only`: `reserved` ni 0 ga keltiradi.
- `brand_and_reserve`: ikkalasini ham 0 ga normallashtiradi.
- Operatsiya muvaffaqiyatli bo'lishi uchun post-check invariantlari bajarilgan bo'lishi shart.

## Operatsion tavsiya
- KPI: `negative-balance-check` natijasi doim 0 bo'lishi kerak.
- Har deploydan keyin smoke-test:
  - allocate over available => `409`
  - unallocate over reserved => `409`
  - zero-stockdan keyin manfiy balans yo'q.

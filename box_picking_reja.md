# Quti / Qutisiz Yig'ish — Tahlil va Reja

> Holat: tasdiqlash kutilmoqda. Sana: 2026-06-27.
> Asos: kod tahlili + biznes qarorlari (quyida "Qarorlar" bo'limi).

---

## 1. Tizim modeli (qisqa)

Quti/qutisiz hisobi **"ikki chelak"** modeli orqali ishlaydi:

- **Total** = `stock_movements` yig'indisi (yagona haqiqat manbasi).
- **Sealed chelak** = `location_box_placements` dagi `SEALED` yozuvlar (har biri = 1 fizik yopiq quti).
- **Loose** = `total − qutilardagi_donalar` (hisoblab chiqariladi, saqlanmaydi).

Asosiy fayllar:
- `backend/app/services/box_location_service.py` — quti/loose mantig'i
- `backend/app/services/stock_availability.py` — on_hand / reserved / available
- `backend/app/services/product_scan_resolve.py` — skan resolve (quti vs dona)
- `backend/app/api/v1/endpoints/picking.py` — terish endpointlari

**Invariant (qonun):** har qanday lot/joy uchun `0 ≤ units_in_boxes ≤ total`, va **total'ni o'zgartirgan har bir oqim sealed chelakni ham mos saqlashi shart.**

---

## 2. Qarorlar (biznes qoidalari)

| # | Qaror | Natija |
|---|-------|--------|
| Q1 | **Quti turi = bitta shtrix-kod** (10 quti bir xil kod, almashtiriladigan) | LPN refactor KERAK EMAS. Qutilar fungible — qaysi aniq quti emas, *soni* + lot/joy muhim. |
| Q2 | **Unpick → quti yopiq joyiga qaytadi** | Butun-quti pick qaytarilganda sealed placement **tiklanadi**. Ochilgan quti (`pick_open`) tiklanmaydi. |
| Q3 | **Sanoqda quti + dona alohida** | Inventarizatsiyaga "yopiq quti soni" maydoni qo'shiladi → drift tuzatiladi. |
| Q4 | **Ko'chirishda: quti bo'yicha → quti ko'chadi (ochilmaydi); dona bo'yicha → dona ko'chadi** | Yopiq quti ko'chsa sealed placement yangi joyga ko'chadi; loose ko'chsa faqat total ko'chadi. |
| Q5 | **Rezerv miqdor bo'yicha** (quti-darajasida rezerv yo'q) | Soddaroq va to'g'ri. Hint rezervga moslashadi, sealed-restore rezervdan ajraladi. |

---

## 3. Oqimlar auditi (sealed chelak holati)

| Oqim | Total | Sealed chelak | Holat |
|------|:---:|:---:|------|
| Kirim (receiving) | ✓ | ✓ | To'g'ri |
| Quti terish | ✓ | ✓ | To'g'ri |
| Qutisiz / hybrid terish | ✓ | ✓ | To'g'ri |
| Quti ko'chirish (relocate, box_locations) | ✓ | ✓ | To'g'ri (lot_id bo'sh bo'lsa xato quti — 1.5) |
| **Unpick / Skip** | ✓ | ✗ | ❌ Tuzatish (Q2) |
| **Safe-cancel qaytarish** | ✓ | ✗ | ❌ Tuzatish (Q2 + Q5) |
| **Inventarizatsiya / sanash** | ✓ | ✗ | ❌ Tuzatish (Q3) |
| **Lokatsiyalararo ko'chirish (movements)** | ✓ | ✗ | ❌ Tuzatish (Q4) |
| Mijoz qaytarishi | ✓ | — | Loose deb qoladi (to'g'ri — qaytgan tovar ochiq) |

---

## 4. Aniqlangan xatolar

- **2.1 (kritik):** `unpick_line` / `skip_line` stock'ni qaytaradi, lekin `REMOVED` sealed placement'ni tiklamaydi → quti "loose"ga aylanadi, drift. (`picking.py:2398`)
- **2.2:** Consolidated hybrid'da `box_units_total==0` (qisman quti ochish) → `hybrid_upb=0` → assertion crash 500. (`picking.py:1452`)
- **2.3:** `data_inconsistent` flag terish javobida jim yutiladi (faqat strict `get_breakdown` 409 tashlaydi). Foydalanuvchiga ko'rsatilmaydi.
- **1.5:** `remove_sealed_box` / `relocate_sealed_box` admin yo'llarida `lot_id` ixtiyoriy → noto'g'ri lot qutisini olishi mumkin. (`box_location_service.py:445`)

### Rezerv bilan bog'liq nuqtalar (Q5)
- Hint over-promise: `breakdown_kwargs_for_pick` `max(on_hand, available)` → band qilingan qutini "bor" deb ko'rsatadi → runtime 409. (`box_location_service.py:256`)
- Sealed-restore rezervdan mustaqil bo'lishi: unpick → rezerv tiklanadi; cancel → rezerv bo'shatiladi; quti ikkalasida ham yopiq qaytadi.

---

## 5. Reja (bosqichma-bosqich)

### 0-bosqich — Poydevor: Invariant *(~0.5 kun)*
- `box_location_service`ga invariant tekshiruvchi yordamchi (`units_in_boxes ≤ total`).
- Test-utilita: tranzaksiyadan keyin nomuvofiqlikni aniqlaydi.

### 1-bosqich — Sealed chelak teshiklarini yopish *(~3-4 kun)*
1. **Unpick / Skip** (Q2): `remove_reason="pick"` qaytarilganda sealed tiklash; `pick_open` tiklanmaydi.
2. **Safe-cancel qaytarish** (Q2+Q5): picker qaytarganda sealed tiklash; rezerv **bo'shatiladi** (tiklanmaydi).
3. **Movements ko'chirish** (Q4): quti bo'yicha → `relocate_sealed_box` ulanadi; dona bo'yicha → faqat total.
4. **Consolidated hybrid crash** (2.2): `box_units_total==0` → to'g'ri yo'l yoki aniq 400.

### 2-bosqich — Yagona darvoza *(~2 kun)*
- Barcha stock+quti mutatsiyalari bitta servisdan; har chiqishda invariant tekshiruvi.

### 3-bosqich — Sanoq + Yarashtirish *(~2-3 kun)* (Q3)
- Inventarizatsiya API/UI'ga "yopiq quti soni" maydoni → sealed chelakni to'g'rilaydi.
- Admin hisobot: `units_in_boxes > total` / shubhali drift joylar; controller qayta sanaydi.

### 4-bosqich — Siyosatlar *(~1 kun)*
- Quti ochish tartibi: FEFO (eng yaqin muddat) vs hozirgi FIFO (`placed_at`).
- Hint rezervga moslashtirish (Q5): over-promise o'rniga tushunarli ko'rsatuv.

### Tozalash (parallel, kichik)
- `remove_box_for_pick_if_needed` (o'lik kod) o'chirish.
- `compute_hybrid_pick_plan` dublikat hisobini birlashtirish.

**Taxminiy umumiy: ~10-12 ish kuni.**

---

## 6. Testlar (qo'shilishi shart)
- Unpick-after-box-pick → sealed tiklanishi.
- Cancel-return-after-box-pick → sealed tiklanishi + rezerv bo'shashi.
- Consolidated hybrid partial-open (qty < 1 quti) → crash bo'lmasligi.
- Movements quti ko'chirish → ikkala joyda invariant.
- Inventarizatsiya quti sanog'i → drift tuzatilishi.

# WMS — Ombor boshqaruv tizimi  
## Kompaniya rahbarlari uchun taqdimot hisoboti

---

## 1. WMS nima?

**WMS (Warehouse Management System)** — omboringizdagi barcha jarayonlarni bitta tizimda boshqarish imkonini beradigan dasturiy yechim. Mahsulot qabuli, saqlash, terish (picking), buyurtmalar va hisobotlar bitta platformada birlashtirilgan.

**Qisqacha:** Ombor haqiqiy vaqtda, aniq raqamlarda va barcha harakatlar yozuvda bo‘ladi.

---

## 2. Tizim nimalar qila oladi?

### 📦 Ombor qoldiqlari (Inventar)
- Har bir mahsulotning **haqiqiy vaqtda** qancha mavjudligi ko‘rinadi.
- Partiyalar (batch) va **muddati** kuzatiladi — muddati o‘tgan mahsulot terishda chiqmaydi.
- Bitta ma’lumot manbai — xato va chalkashlik kamayadi.

### 📋 Terish (Picking)
- Terishchi **mobil ilova** orqali vazifalarni oladi va bajaradi.
- **Shtrixkod skaner** orqali mahsulot va joy tasdiqlanadi — noto‘g‘ri terish kamayadi.
- **FEFO** — “muddati avval tugaydigan birinchi” avtomatik tanlanadi (sog‘liq va standartlar uchun muhim).
- **Wave picking** — bir nechta buyurtmani guruhlab terish, ish tezligi oshadi.

### 📥 Qabul qilish (Receiving)
- Kirim hujjatlari tizimda, har bir kirim **lot va muddati** bilan kiritiladi.
- Muddati o‘tgan sana **qabul qilinmaydi** — sifat nazorati qo‘lda qolmaydi.

### 📤 Buyurtmalar va harakatlar
- **SmartUP** bilan integratsiya — buyurtmalar tashqi tizimdan avtomatik keladi.
- **O‘rikzor harakatlari** — filiallar/omborlar o‘rtasidagi harakatlar boshqariladi.
- **Tashkiliy harakatlar** — ombordan omborga ko‘chirish hujjatlashtiriladi.

### 👥 Foydalanuvchilar va xavfsizlik
- **Rollar:** Admin, Controller (ombor nazoratchisi), Picker (terishchi).
- Har bir xodim o‘z ruxsati bo‘yicha ishlaydi; **bitta profil faqat bitta qurilma**da — sessiya xavfsizligi.
- **Audit log** — kim, qachon, qanday harakat qilgani yozuvda (tekshiruv va javobgarlik uchun).

### 📊 Hisobotlar va nazorat
- Dashboard va hisobotlar orqali ombor holati va harakatlar ko‘rinadi.
- Barcha muhim amallar audit daftarida — tekshiruv va standartlarga moslik uchun.

### 📱 Qanday ishlatiladi?
- **Veb-admin (kompyuter):** Admin va Controller — mahsulotlar, buyurtmalar, lokatsiyalar, qoldiq, hisobotlar, foydalanuvchilar.
- **Mobil ilova (telefon/planshet):** Terishchi — terish vazifalari, skaner, qoldiqlar, kirim; **internet bo‘lmasa ham** keyinroq sinxronlash mumkin (offline).
- **Push bildirishnoma:** Yangi terish vazifasi chiqganda terishchiga bildirishnoma keladi, bosish bilan vazifa ochiladi.

---

## 3. Kompaniyaga qanday foyda keltiradi?

| Foyda | Tavsif |
|-------|--------|
| **Aniqlik** | Qoldiq va harakatlar bitta tizimda — “qog‘ozda” va haqiqat farqi kamayadi. |
| **Tezlik** | Terish skaner va vazifalar orqali — xato kamayadi, vaqt tejash. |
| **Sifat** | FEFO va muddati nazorati — muddati o‘tgan mahsulot chiqishiga barrier. |
| **Nazorat** | Audit log va rollar — kim nima qilgani ma’lum, javobgarlik aniq. |
| **Integratsiya** | SmartUP va O‘rikzor — boshqa tizimlar bilan ulash qulay. |
| **Zamonaviy ish** | Mobil va offline — ombor xodimi sahoda telefoni bilan ishlashi mumkin. |

---

## 4. Texnologiya (qisqacha)

- **Server:** FastAPI + PostgreSQL — barqaror va tez API.
- **Veb:** React, til — o‘zbek, rus, ingliz.
- **Mobil:** React Native (Android) va PWA (brauzer/Capacitor) — skaner, push, offline qo‘llab-quvvatlanadi.
- **Tashqi tizimlar:** SmartUP (mahsulotlar va inventory), O‘rikzor harakatlari.

---

## 5. Xulosa — taqdimotda aytish uchun

1. **WMS** — omboringizni raqamlashtirish va boshqarish uchun yagona platforma.
2. **Qabul, saqlash, terish, buyurtmalar, hisobotlar** — barchasi tizimda, audit va rollar bilan.
3. **FEFO va muddati** — sifat va standartlarga moslik.
4. **Mobil + offline + push** — terishchi sahoda qulay ishlaydi.
5. **SmartUP va O‘rikzor** — mavjud biznes tizimlari bilan integratsiya.

**Yakuniy gap:** Tizim ombor jarayonlarini aniqroq, tezroq va nazorat ostida boshqarish imkonini beradi — xato va yo‘qotishlarni kamaytirish, vaqt va resurslarni tejash maqsadida.

---

*Batafsil texnik hisobot: `LOYIHA_HISOBOTI.md`*

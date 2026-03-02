# Single-Device Session Management (Gibrid Yechim)

## Umumiy Ma'lumot

WMS tizimida bir profilga bir vaqtda faqat bitta qurilmadan kirish imkoniyati qo'shildi. Bu gibrid yondashuv xavfsizlik va foydalanuvchi qulayligini muvozanatlaydi.

## Asosiy Xususiyatlar

### 1. Bir Qurilmadan Kirish
- Foydalanuvchi yangi qurilmadan kirganda, oldingi sessiya avtomatik bekor qilinadi
- Eski token bilan API so'rovlari 401 xato qaytaradi
- Foydalanuvchiga tushunarli xabar ko'rsatiladi

### 2. Qulay Qurilma Almashtirish
- Yangi qurilmadan kirish uchun parol kiritish kifoya
- Oldingi qurilmadan chiqish shart emas
- Sessiya avtomatik yangilanadi

### 3. Audit Trail
- Har bir kirish vaqti saqlanadi (`session_started_at`)
- Qurilma ma'lumotlari saqlanadi (`last_device_info`)
- Oxirgi kirish vaqti (`last_login_at`)

## Texnik Implementatsiya

### Database Schema

Yangi ustunlar `users` jadvalida:

```sql
-- Session tracking fields
active_session_token VARCHAR(512)  -- Hozirgi aktiv token
last_device_info VARCHAR(512)      -- User-Agent string
session_started_at TIMESTAMP       -- Sessiya boshlanish vaqti

-- Index for fast session lookup
CREATE INDEX ix_users_active_session ON users(active_session_token) 
WHERE active_session_token IS NOT NULL;
```

### Backend Changes

#### 1. User Model (`app/models/user.py`)
```python
class User(Base):
    # ... existing fields ...
    active_session_token: Mapped[str | None]
    last_device_info: Mapped[str | None]
    session_started_at: Mapped[datetime | None]
```

#### 2. Login Endpoint (`app/api/v1/endpoints/auth.py`)
```python
@router.post("/login")
async def login(payload: LoginRequest, request: Request, db: Session):
    # ... authentication ...
    
    token = create_access_token({"sub": str(user.id), "role": user.role})
    
    # Invalidate previous session
    user.active_session_token = token
    user.session_started_at = datetime.utcnow()
    user.last_device_info = request.headers.get("user-agent", "Unknown")[:500]
    
    db.commit()
    return TokenResponse(access_token=token)
```

#### 3. Session Validation (`app/auth/deps.py`)
```python
def get_current_user(db: Session, credentials: HTTPAuthorizationCredentials):
    # ... token decoding ...
    
    # Check if token is still active
    if user.active_session_token and user.active_session_token != token:
        raise HTTPException(
            status_code=401,
            detail="Session expired: logged in from another device"
        )
    
    return user
```

#### 4. Logout Endpoint
```python
@router.post("/logout")
async def logout(current_user: User, db: Session):
    current_user.active_session_token = None
    current_user.session_started_at = None
    db.commit()
    return {"status": "ok"}
```

### Frontend Changes

#### 1. API Client (`services/apiClient.ts`)
```typescript
// Detect session expired error
if (response.status === 401 && path !== '/api/v1/auth/login') {
  const errorDetail = payload?.detail || ''
  
  if (errorDetail.includes('logged in from another device')) {
    sessionStorage.setItem('session_expired_reason', 'another_device')
  }
  
  clearTokenAndRedirect()
}
```

#### 2. Auth Service (`services/authApi.ts`)
```typescript
export async function logout() {
  try {
    await fetchJSON('/api/v1/auth/logout', { method: 'POST' })
  } catch {
    // Ignore errors, clear token anyway
  }
  clearToken()
}
```

#### 3. Login Page (`pages/LoginPage.tsx`)
```typescript
// Check for session expired message
useEffect(() => {
  const reason = sessionStorage.getItem('session_expired_reason')
  if (reason === 'another_device') {
    setSessionExpiredMessage(t('session_expired_another_device'))
    sessionStorage.removeItem('session_expired_reason')
  }
}, [])

// Display warning message
{sessionExpiredMessage && (
  <div className="rounded-lg bg-amber-50 border border-amber-200 p-3">
    {sessionExpiredMessage}
  </div>
)}
```

#### 4. Translations
```json
// uz/auth.json
{
  "session_expired_another_device": "Sizning sessiyangiz tugadi: boshqa qurilmadan kirilgan. Iltimos, qayta kiring."
}

// en/auth.json
{
  "session_expired_another_device": "Your session has expired: logged in from another device. Please sign in again."
}

// ru/auth.json
{
  "session_expired_another_device": "Ваша сессия истекла: вход выполнен с другого устройства. Пожалуйста, войдите снова."
}
```

## Foydalanuvchi Tajribasi

### Stsenariy 1: Oddiy Ish Kuni
1. Operator ertalab telefon A dan kiradi
2. Kun davomida ishlaydi - hech qanday muammo yo'q
3. Kechqurun chiqadi (logout)

### Stsenariy 2: Qurilma Almashtirish
1. Operator telefon A dan kirgan
2. Telefon A batareyasi tugadi
3. Operator telefon B dan kiradi
4. Telefon A avtomatik chiqariladi
5. Telefon A qayta ishga tushganda, login sahifasida xabar ko'rsatiladi

### Stsenariy 3: Xavfsizlik
1. Operator telefon A dan kirgan va uni yo'qotdi
2. Boshqa operator telefon B dan o'sha login bilan kiradi
3. Telefon A darhol chiqariladi
4. Telefon A topilsa ham, ishlatib bo'lmaydi

## Testing

### Backend Tests (`tests/test_session_management.py`)

Quyidagi stsenariylar test qilinadi:
- ✅ Login sessiya token yaratadi
- ✅ Ikkinchi login birinchi sessiyani bekor qiladi
- ✅ Logout sessiyani tozalaydi
- ✅ Qurilma ma'lumotlari saqlanadi
- ✅ Har xil foydalanuvchilar mustaqil sessiyalarga ega
- ✅ Sessiya bir nechta so'rovlar uchun ishlaydi

### Manual Testing Checklist

- [ ] Login qilish va token olish
- [ ] Ikkinchi qurilmadan login qilish
- [ ] Birinchi qurilmada API so'rovi 401 qaytaradi
- [ ] Login sahifasida to'g'ri xabar ko'rsatiladi
- [ ] Logout qilish ishlaydi
- [ ] Har xil foydalanuvchilar bir vaqtda ishlaydi

## Deployment

### 1. Database Migration
```bash
cd backend
alembic upgrade head
```

### 2. Backend Deploy
Backend avtomatik deploy bo'ladi (Render.com)

### 3. Frontend Deploy
Frontend avtomatik deploy bo'ladi (Vercel)

### 4. Verification
```bash
# Test login
curl -X POST https://wms-ngdm.onrender.com/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username": "test", "password": "test123"}'

# Test /me endpoint
curl https://wms-ngdm.onrender.com/api/v1/auth/me \
  -H "Authorization: Bearer <token>"
```

## Monitoring

### Database Queries
```sql
-- Active sessions count
SELECT COUNT(*) FROM users WHERE active_session_token IS NOT NULL;

-- Recent logins
SELECT username, last_login_at, session_started_at, last_device_info 
FROM users 
WHERE last_login_at > NOW() - INTERVAL '1 day'
ORDER BY last_login_at DESC;

-- Users with old sessions (possible stuck sessions)
SELECT username, session_started_at 
FROM users 
WHERE session_started_at < NOW() - INTERVAL '24 hours'
  AND active_session_token IS NOT NULL;
```

## Kelajakdagi Yaxshilashlar (Optional)

1. **Session Timeout**: 24 soatdan keyin avtomatik logout
2. **Device Management UI**: Foydalanuvchi o'z qurilmalarini ko'rish va boshqarish
3. **Session History**: Barcha kirish tarixini ko'rish
4. **Suspicious Activity Alert**: Noodatiy kirish urinishlarini aniqlash
5. **Remember Device**: Ishonchli qurilmalarni eslab qolish

## Xavfsizlik Mulohazalari

✅ **Afzalliklar:**
- Yo'qolgan/o'g'irlangan qurilmalardan himoya
- Bir accountdan bir nechta kishi foydalanishini oldini olish
- Audit trail va accountability

⚠️ **Cheklovlar:**
- Token o'g'irlansa, yangi login kerak (bu aslida yaxshi)
- Offline mode da sessiya tekshirilmaydi (bu normal)

## Qo'llab-quvvatlash

Muammolar yuzaga kelsa:

1. **Foydalanuvchi tez-tez chiqariladi**: Bir nechta qurilmadan kirishga urinayotgan bo'lishi mumkin
2. **Login ishlamayapti**: Database migration run qilinganini tekshiring
3. **Xabar ko'rsatilmayapti**: Browser cache ni tozalang

## Xulosa

Gibrid yechim WMS uchun optimal:
- ✅ Xavfsizlik: Bir vaqtda faqat bitta aktiv sessiya
- ✅ Qulaylik: Yangi qurilmadan osongina kirish
- ✅ Shaffoflik: Foydalanuvchi nima bo'layotganini tushunadi
- ✅ Audit: Barcha kirish/chiqishlar saqlanadi

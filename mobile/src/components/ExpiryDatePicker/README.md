# ExpiryDatePicker

Custom modal date picker: **Yil → Oy → Kun**, WMS style, ru/uz/en, dark mode. Returns ISO `YYYY-MM-DD`. Past dates disabled; today allowed.

## How to use

```tsx
import { ExpiryDatePicker, formatExpiryDisplay } from '../components/ExpiryDatePicker';

// State
const [open, setOpen] = useState(false);
const [value, setValue] = useState<string | null>(null);

// Today for minDate (no past)
function todayISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// Input that opens picker and shows formatted date
<TouchableOpacity onPress={() => setOpen(true)}>
  <Text>
    {value ? formatExpiryDisplay(value) : 'Срок годности'}
  </Text>
</TouchableOpacity>

<ExpiryDatePicker
  visible={open}
  onClose={() => setOpen(false)}
  value={value}
  onChange={(iso) => {
    setValue(iso);
    setOpen(false);
  }}
  minDate={todayISO()}
  maxDate={undefined}
  locale="uz"
  darkMode={false}
/>
```

## Props

| Prop       | Type                    | Description                          |
|-----------|--------------------------|--------------------------------------|
| visible   | boolean                  | Show/hide modal                      |
| onClose   | () => void               | Called on Close or Cancel            |
| value     | string \| null            | ISO date "YYYY-MM-DD" or null        |
| onChange  | (iso: string \| null) => void | Called with ISO on Apply         |
| minDate   | string (optional)        | Min date ISO; default today          |
| maxDate   | string (optional)        | Max date ISO                         |
| locale    | 'ru' \| 'uz' \| 'en'     | Labels and month/weekday names       |
| darkMode  | boolean (optional)       | Dark theme                           |

## Display format

`formatExpiryDisplay(isoDate)` → `"16.02.2026"` (DD.MM.YYYY).

## Validation

- Dates before `minDate` are disabled (e.g. past).
- Dates after `maxDate` (if set) are disabled.
- Apply is enabled only on step 3 when a valid day is selected.

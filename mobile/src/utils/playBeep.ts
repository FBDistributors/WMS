import { Platform, Vibration } from 'react-native';

/** Shtrix to'g'ri bo'lganda tebranish. Android da VIBRATE ruxsati rad etilganda xato chiqmasligi uchun faqat iOS da ishlatamiz. */
export function playSuccessBeep(): void {
  try {
    if (Platform.OS === 'ios') {
      Vibration.vibrate([0, 100, 50, 100]);
    }
    // Android: VIBRATE ruxsati ba'zi qurilmalarda "Neither user nor current process has android.permission.VIBRATE"
    // deb rad etiladi va ilova qulab tushadi — shuning uchun Android da tebranish o‘chirilgan
  } catch {
    // ignore
  }
}

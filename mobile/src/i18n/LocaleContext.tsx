/**
 * Til konteksti: locale, setLocale, t(key). AsyncStorage da saqlanadi.
 */
import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { LocaleCode } from './translations';
import { translations } from './translations';

const STORAGE_KEY = '@wms_locale';

type LocaleContextValue = {
  locale: LocaleCode;
  setLocale: (code: LocaleCode) => Promise<void>;
  t: (key: string, params?: Record<string, string | number>) => string;
};

const defaultLocale: LocaleCode = 'uz';

const LocaleContext = createContext<LocaleContextValue | null>(null);

function replaceParams(text: string, params?: Record<string, string | number>): string {
  if (!params) return text;
  let result = text;
  for (const [k, v] of Object.entries(params)) {
    result = result.replace(new RegExp(`\\{\\{${k}\\}\\}`, 'g'), String(v));
  }
  return result;
}

export function LocaleProvider({ children }: { children: React.ReactNode }) {
  const [locale, setLocaleState] = useState<LocaleCode>(defaultLocale);

  useEffect(() => {
    AsyncStorage.getItem(STORAGE_KEY).then((stored) => {
      if (stored === 'uz' || stored === 'ru' || stored === 'en') {
        setLocaleState(stored);
      }
    });
  }, []);

  const setLocale = useCallback(async (code: LocaleCode) => {
    setLocaleState(code);
    await AsyncStorage.setItem(STORAGE_KEY, code);
  }, []);

  const t = useCallback(
    (key: string, params?: Record<string, string | number>) => {
      const dict = translations[locale];
      const text = dict[key] ?? translations.uz[key] ?? key;
      return replaceParams(text, params);
    },
    [locale]
  );

  return (
    <LocaleContext.Provider value={{ locale, setLocale, t }}>
      {children}
    </LocaleContext.Provider>
  );
}

export function useLocale(): LocaleContextValue {
  const ctx = useContext(LocaleContext);
  if (!ctx) throw new Error('useLocale must be used inside LocaleProvider');
  return ctx;
}

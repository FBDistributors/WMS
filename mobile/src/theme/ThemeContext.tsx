/**
 * Mavzu konteksti: light / dark. AsyncStorage da @wms_theme saqlanadi.
 */
import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

export type ThemeType = 'light' | 'dark';

const STORAGE_KEY = '@wms_theme';

type ThemeContextValue = {
  theme: ThemeType;
  setTheme: (value: ThemeType) => Promise<void>;
};

const ThemeContext = createContext<ThemeContextValue | null>(null);

export function ThemeProvider({ children }: { children?: React.ReactNode }) {
  const [theme, setThemeState] = useState<ThemeType>('light');

  useEffect(() => {
    AsyncStorage.getItem(STORAGE_KEY).then((stored) => {
      if (stored === 'light' || stored === 'dark') {
        setThemeState(stored);
      }
    });
  }, []);

  const setTheme = useCallback(async (value: ThemeType) => {
    setThemeState(value);
    await AsyncStorage.setItem(STORAGE_KEY, value);
  }, []);

  const value: ThemeContextValue = { theme, setTheme };

  return (
    <ThemeContext.Provider value={value}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) {
    throw new Error('useTheme must be used within ThemeProvider');
  }
  return ctx;
}

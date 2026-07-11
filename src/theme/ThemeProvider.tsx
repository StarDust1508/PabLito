/**
 * §8 (TZ-04): тема свет/тьма/системная с сохранением выбора.
 * Раньше палитра бралась из системной useColorScheme() в каждом экране; теперь —
 * из контекста, с ручным оверрайдом. Модалки по-прежнему получают палитру пропом.
 */
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { useColorScheme } from 'react-native';
import { dark, light, type Palette } from '@/theme/theme';
import * as mem from '@/core/memory';

export type ThemeMode = 'light' | 'dark' | 'system';

interface ThemeCtx {
  c: Palette;
  scheme: 'light' | 'dark';
  mode: ThemeMode;
  setMode: (m: ThemeMode) => void;
}

const Ctx = createContext<ThemeCtx>({ c: light, scheme: 'light', mode: 'system', setMode: () => {} });
export const useTheme = () => useContext(Ctx);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const system = useColorScheme();
  const [mode, setModeState] = useState<ThemeMode>('system');

  useEffect(() => {
    mem
      .getSetting('theme')
      .then((v) => {
        if (v === 'light' || v === 'dark' || v === 'system') setModeState(v);
      })
      .catch(() => {});
  }, []);

  const setMode = (m: ThemeMode) => {
    setModeState(m);
    mem.setSetting('theme', m).catch(() => {});
  };

  const scheme: 'light' | 'dark' = mode === 'system' ? (system === 'dark' ? 'dark' : 'light') : mode;
  const c = scheme === 'dark' ? dark : light;

  return <Ctx.Provider value={{ c, scheme, mode, setMode }}>{children}</Ctx.Provider>;
}

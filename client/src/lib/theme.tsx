import { createContext, ReactNode, useContext, useEffect, useState } from 'react';

export type ThemeChoice = 'auto' | 'light' | 'dark';

const STORAGE_KEY = 'theme';
const THEME_COLOR = { light: '#FDFBF7', dark: '#141720' };

/** The stored choice; the old on/off switch ("darkMode") counts as dark or auto. */
export function storedTheme(): ThemeChoice {
  try {
    const value = localStorage.getItem(STORAGE_KEY);
    if (value === 'auto' || value === 'light' || value === 'dark') return value;
    return localStorage.getItem('darkMode') === 'true' ? 'dark' : 'auto';
  } catch {
    return 'auto';
  }
}

function systemDark(): boolean {
  return typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-color-scheme: dark)').matches;
}

export function applyTheme(choice: ThemeChoice) {
  const dark = choice === 'dark' || (choice === 'auto' && systemDark());
  document.documentElement.classList.toggle('dark', dark);
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', dark ? THEME_COLOR.dark : THEME_COLOR.light);
}

/** The theme choice, applied to the page; "auto" follows the system as it changes. */
function useAppliedTheme(): [ThemeChoice, (choice: ThemeChoice) => void] {
  const [choice, setChoice] = useState<ThemeChoice>(storedTheme);

  useEffect(() => {
    applyTheme(choice);
    try {
      localStorage.setItem(STORAGE_KEY, choice);
      localStorage.removeItem('darkMode');
    } catch { /* storage blocked: the choice holds until reload */ }
    if (choice !== 'auto' || !window.matchMedia) return;
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const follow = () => applyTheme('auto');
    media.addEventListener('change', follow);
    return () => media.removeEventListener('change', follow);
  }, [choice]);

  return [choice, setChoice];
}

const ThemeContext = createContext<[ThemeChoice, (choice: ThemeChoice) => void]>(['auto', () => {}]);

export function ThemeProvider({ children }: { children: ReactNode }) {
  return <ThemeContext.Provider value={useAppliedTheme()}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  return useContext(ThemeContext);
}

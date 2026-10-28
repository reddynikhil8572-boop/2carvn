import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { useAuthUser } from '@/stores/auth';

/**
 * Theme provider. Persists the user's choice ('light' | 'dark' | 'system') in
 * localStorage — the one place that is acceptable, because it is a preference,
 * not a credential. `document.documentElement.classList` is what Tailwind's
 * `darkMode: ['class']` keys on.
 */

type Theme = 'light' | 'dark' | 'system';
type ResolvedTheme = 'light' | 'dark';
export type StudentTheme = 'classic' | 'cartoon' | 'anime' | 'racing';
export type MotionLevel = 'minimal' | 'subtle' | 'playful';

interface ThemeProviderState {
  theme: Theme;
  resolvedTheme: ResolvedTheme;
  setTheme: (theme: Theme) => void;
  studentTheme: StudentTheme;
  setStudentTheme: (theme: StudentTheme) => void;
  soundEnabled: boolean;
  setSoundEnabled: (enabled: boolean) => void;
  soundVolume: number;
  setSoundVolume: (volume: number) => void;
  motionLevel: MotionLevel;
  setMotionLevel: (level: MotionLevel) => void;
}

function readSoundVolume(): number {
  try {
    const stored = Number(localStorage.getItem(SOUND_VOLUME_KEY));
    if (Number.isFinite(stored) && stored >= 0 && stored <= 1) return stored;
  } catch {
    /* Local preferences are optional. */
  }
  return 0.3;
}

const ThemeProviderContext = createContext<ThemeProviderState | null>(null);

const STORAGE_KEY = 'edusphere:theme';
const STUDENT_THEME_KEY = '2carvn:student-theme';
const SOUND_KEY = '2carvn:sound-enabled';
const SOUND_VOLUME_KEY = '2carvn:sound-volume';
const MOTION_KEY = '2carvn:motion-level';

function readStoredTheme(): Theme {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === 'light' || stored === 'dark' || stored === 'system') return stored;
  } catch {
    /* localStorage unavailable; default to system */
  }
  return 'system';
}

function readStudentTheme(): StudentTheme {
  try {
    const stored = localStorage.getItem(STUDENT_THEME_KEY);
    if (stored === 'classic' || stored === 'cartoon' || stored === 'anime' || stored === 'racing') {
      return stored;
    }
  } catch {
    /* Local preferences are optional. */
  }
  return 'classic';
}

function readSoundEnabled(): boolean {
  try {
    return localStorage.getItem(SOUND_KEY) === 'true';
  } catch {
    return false;
  }
}

function readMotionLevel(): MotionLevel {
  try {
    const stored = localStorage.getItem(MOTION_KEY);
    if (stored === 'minimal' || stored === 'subtle' || stored === 'playful') return stored;
  } catch {
    /* Local preferences are optional. */
  }
  return 'subtle';
}

function systemTheme(): ResolvedTheme {
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function applyClass(resolved: ResolvedTheme) {
  document.documentElement.classList.toggle('dark', resolved === 'dark');
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const user = useAuthUser();
  const [theme, setThemeState] = useState<Theme>(readStoredTheme);
  const [studentTheme, setStudentThemeState] = useState<StudentTheme>(readStudentTheme);
  const [soundEnabled, setSoundEnabledState] = useState(readSoundEnabled);
  const [soundVolume, setSoundVolumeState] = useState(readSoundVolume);
  const [motionLevel, setMotionLevelState] = useState<MotionLevel>(readMotionLevel);
  const [resolvedTheme, setResolvedTheme] = useState<ResolvedTheme>(() => {
    const t = readStoredTheme();
    return t === 'system' ? systemTheme() : t;
  });

  useEffect(() => {
    applyClass(resolvedTheme);
  }, [resolvedTheme]);

  useEffect(() => {
    const root = document.documentElement;
    if (user?.role === 'STUDENT') {
      root.dataset.studentTheme = studentTheme;
      root.dataset.motionLevel = motionLevel;
    } else {
      delete root.dataset.studentTheme;
      delete root.dataset.motionLevel;
    }
  }, [studentTheme, motionLevel, user?.role]);

  // Follow OS changes while the user is on 'system'.
  useEffect(() => {
    if (theme !== 'system') return;
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = () => setResolvedTheme(systemTheme());
    media.addEventListener('change', onChange);
    return () => media.removeEventListener('change', onChange);
  }, [theme]);

  const setTheme = (next: Theme) => {
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      /* non-persistent is fine */
    }
    setThemeState(next);
    setResolvedTheme(next === 'system' ? systemTheme() : next);
  };

  const setStudentTheme = (next: StudentTheme) => {
    try {
      localStorage.setItem(STUDENT_THEME_KEY, next);
    } catch {
      /* The preference still applies for this session. */
    }
    setStudentThemeState(next);
  };

  const setSoundEnabled = (enabled: boolean) => {
    try {
      localStorage.setItem(SOUND_KEY, String(enabled));
    } catch {
      /* The preference still applies for this session. */
    }
    setSoundEnabledState(enabled);
  };

  const setSoundVolume = (volume: number) => {
    const next = Math.min(1, Math.max(0, volume));
    try {
      localStorage.setItem(SOUND_VOLUME_KEY, String(next));
    } catch {
      /* The preference still applies for this session. */
    }
    setSoundVolumeState(next);
  };

  const setMotionLevel = (level: MotionLevel) => {
    try {
      localStorage.setItem(MOTION_KEY, level);
    } catch {
      /* The preference still applies for this session. */
    }
    setMotionLevelState(level);
  };

  const value = useMemo(
    () => ({
      theme,
      resolvedTheme,
      setTheme,
      studentTheme,
      setStudentTheme,
      soundEnabled,
      setSoundEnabled,
      soundVolume,
      setSoundVolume,
      motionLevel,
      setMotionLevel,
    }),
    [theme, resolvedTheme, studentTheme, soundEnabled, soundVolume, motionLevel],
  );

  return <ThemeProviderContext.Provider value={value}>{children}</ThemeProviderContext.Provider>;
}

export function useTheme(): ThemeProviderState {
  const ctx = useContext(ThemeProviderContext);
  if (!ctx) throw new Error('useTheme must be used within a <ThemeProvider>');
  return ctx;
}
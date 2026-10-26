// Per-device look & feel: theme (light / night), motion level
// (off / light / full), and whether the welcome page shows when StayBill opens.
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { MotionConfig } from 'framer-motion';

const KEY = 'staybill-appearance-v1';
const Ctx = createContext(null);

function prefersReducedMotion() {
  try { return window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { return false; }
}
function load() {
  const defaults = { theme: 'light', motion: prefersReducedMotion() ? 'off' : 'light', intro: true, transition: 'elevator', sound: false };
  try { return { ...defaults, ...(JSON.parse(localStorage.getItem(KEY) || '{}')) }; } catch { return defaults; }
}

export function AppearanceProvider({ children }) {
  const [prefs, setPrefs] = useState(load);
  const [paused, setPaused] = useState(false);

  useEffect(() => {
    try { localStorage.setItem(KEY, JSON.stringify(prefs)); } catch { /* storage unavailable */ }
  }, [prefs]);
  useEffect(() => {
    document.documentElement.dataset.theme = prefs.theme;
  }, [prefs.theme]);

  const update = useCallback((patch) => setPrefs((p) => ({ ...p, ...patch })), []);
  const motion = paused ? 'off' : prefs.motion;
  useEffect(() => { document.documentElement.dataset.motion = motion; }, [motion]);

  const value = useMemo(() => ({
    theme: prefs.theme,
    setTheme: (theme) => update({ theme }),
    toggleTheme: () => update({ theme: prefs.theme === 'dark' ? 'light' : 'dark' }),
    motionSetting: prefs.motion,
    setMotion: (m) => { update({ motion: m }); setPaused(false); },
    motion, // effective level, after "Pause motion"
    paused,
    setPaused,
    intro: prefs.intro,
    setIntro: (intro) => update({ intro }),
    transition: prefs.transition,
    setTransition: (transition) => update({ transition }),
    sound: prefs.sound,
    setSound: (sound) => update({ sound }),
  }), [prefs, motion, paused, update]);

  return (
    <Ctx.Provider value={value}>
      <MotionConfig reducedMotion={motion === 'off' ? 'always' : 'never'}>{children}</MotionConfig>
    </Ctx.Provider>
  );
}

export const useAppearance = () => useContext(Ctx) || {
  theme: 'light', motion: 'off', motionSetting: 'off', paused: false, intro: false, transition: 'fade', sound: false,
  setTheme() {}, toggleTheme() {}, setMotion() {}, setPaused() {}, setIntro() {}, setTransition() {}, setSound() {},
};

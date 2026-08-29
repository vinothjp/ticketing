import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { applyPrefs, loadPrefs, savePrefs, type Prefs } from '../lib/preferences';

interface PreferencesContextType {
  prefs: Prefs;
  setPrefs: (next: Prefs) => void;
  /** Patch one key — the usual call from the panel. */
  updatePrefs: (patch: Partial<Prefs>) => void;
}

const PreferencesContext = createContext<PreferencesContextType | null>(null);

export function PreferencesProvider({ children }: { children: React.ReactNode }) {
  // main.tsx already applied these to the DOM before the first paint; seeding
  // from the same source keeps React's view and the document in step.
  const [prefs, setPrefs] = useState<Prefs>(() => loadPrefs());

  const updatePrefs = useCallback(
    (patch: Partial<Prefs>) => setPrefs((current) => ({ ...current, ...patch })),
    [],
  );

  // Persisting and painting live in an effect, not in the setter, so a
  // StrictMode double-render can't write localStorage twice.
  useEffect(() => {
    savePrefs(prefs);
  }, [prefs]);

  // Only 'system' tracks the OS; an explicit light/dark choice must not flip
  // when the OS does.
  useEffect(() => {
    if (prefs.theme !== 'system') return;
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = () => applyPrefs(prefs);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, [prefs]);

  return (
    <PreferencesContext.Provider value={{ prefs, setPrefs, updatePrefs }}>
      {children}
    </PreferencesContext.Provider>
  );
}

export function usePrefs() {
  const ctx = useContext(PreferencesContext);
  if (!ctx) throw new Error('usePrefs must be used within PreferencesProvider');
  return ctx;
}

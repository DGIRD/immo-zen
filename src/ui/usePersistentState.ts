import { useCallback, useState } from 'react';

/**
 * État mémorisé dans ce navigateur (filtres, vues) : retrouvé au prochain passage sur l'écran.
 * Clé nulle : état ordinaire, non mémorisé. Valeur absente ou refusée par `accept` : valeur initiale.
 * `override` (lien venant d'un autre écran) l'emporte sur la valeur mémorisée et la remplace.
 */
export function usePersistentState<T>(key: string | null, initial: T, accept?: (v: unknown) => boolean, override?: T): [T, (v: T) => void] {
  const [value, setValue] = useState<T>(() => {
    if (!key) return override ?? initial;
    if (override !== undefined) {
      try { localStorage.setItem(`immozen:filtre:${key}`, JSON.stringify(override)); } catch { /* facultatif */ }
      return override;
    }
    try {
      const raw = localStorage.getItem(`immozen:filtre:${key}`);
      if (raw == null) return initial;
      const v = JSON.parse(raw) as unknown;
      return accept && !accept(v) ? initial : (v as T);
    } catch { return initial; }
  });
  const set = useCallback((v: T) => {
    setValue(v);
    if (!key) return;
    try { localStorage.setItem(`immozen:filtre:${key}`, JSON.stringify(v)); } catch { /* stockage indisponible : non mémorisé */ }
  }, [key]);
  return [value, set];
}

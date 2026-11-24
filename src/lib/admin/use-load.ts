import { useCallback, useEffect, useState } from 'react';

type PgError = { code?: string; message: string } | null;

// Turn a Supabase error into a French sentence for the dashboard.
// Business-rule errors raised by the database (P0001) are already in French.
export function errorMessage(error: PgError | Error | unknown, fallback = 'Action impossible. Réessayez.') {
  const e = error as { code?: string; message?: string } | null;
  if (!e) return fallback;
  if (e.code === 'P0001' && e.message) return e.message;
  if (e.code === '42501') return 'Vous n’avez pas les droits pour cette action.';
  if (e.code === '23505') return 'Cette valeur existe déjà (doublon).';
  if (e.code === '23503') return 'Impossible : cet élément est encore utilisé ailleurs.';
  if (e.code === '23P01') return 'Conflit de créneau : déjà pris sur cette période.';
  if (e.code === '23514') return 'Valeur refusée : vérifiez les champs.';
  if (e.message?.includes('Failed to fetch') || e.message?.includes('Network')) {
    return 'Problème de connexion. Vérifiez votre accès internet.';
  }
  return e.message ? `${fallback} (${e.message})` : fallback;
}

// Fetch data for a screen; reload() fetches again (after a change).
export function useLoad<T>(fetcher: () => Promise<T>, deps: unknown[]) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [version, setVersion] = useState(0);

  useEffect(() => {
    let active = true;
    fetcher().then(
      (value) => {
        if (!active) return;
        setData(value);
        setError(null);
      },
      (e) => {
        if (active) setError(errorMessage(e, 'Chargement impossible.'));
      },
    );
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, version]);

  const reload = useCallback(() => setVersion((v) => v + 1), []);
  return { data, error, loading: data === null && !error, reload };
}

// Throw on a Supabase error so useLoad shows it
export function unwrap<T>({ data, error }: { data: T | null; error: PgError }): T {
  if (error) throw error;
  return data as T;
}

import { useCallback, useEffect, useRef, useState } from 'react';

/** Load one entity, keep local edits, and save with a debounce. */
export function useEntity<T extends { id: string }>(load: () => Promise<T | null>, save: (v: T) => Promise<void>, deps: unknown[]) {
  const [value, setValue] = useState<T | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latest = useRef<T | null>(null);
  useEffect(() => {
    void load().then((v) => { setValue(v); latest.current = v; });
    return () => { if (timer.current && latest.current) { clearTimeout(timer.current); void save(latest.current); } };
  }, deps); // eslint-disable-line react-hooks/exhaustive-deps
  const update = useCallback((patch: Partial<T>) => {
    setValue((v) => {
      if (!v) return v;
      const next = { ...v, ...patch };
      latest.current = next;
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => void save(next), 400);
      return next;
    });
  }, [save]);
  return [value, update] as const;
}

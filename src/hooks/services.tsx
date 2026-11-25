import { createContext, useCallback, useContext, useEffect, useState, useSyncExternalStore, type ReactNode } from 'react';
import { getConfig } from '../config/env';
import type { Schema } from '../schema/columnMapper';
import type { ValueContext } from '../schema/values';
import type { AppServices, SyncStatus } from '../services/appServices';

const ServicesContext = createContext<AppServices | null>(null);

export function ServicesProvider({ services, children }: { services: AppServices; children: ReactNode }) {
  return <ServicesContext.Provider value={services}>{children}</ServicesContext.Provider>;
}

export function useServices(): AppServices {
  const s = useContext(ServicesContext);
  if (!s) throw new Error('useServices must be used inside ServicesProvider');
  return s;
}

export function useSyncStatus(): SyncStatus {
  const s = useServices();
  return useSyncExternalStore(
    (cb) => s.onStatus(cb),
    () => s.status,
    () => s.status,
  );
}

/** Increments whenever local data changes (sync finished, local edit saved). */
export function useDataVersion(): number {
  const s = useServices();
  const [v, setV] = useState(0);
  useEffect(() => s.onDataChanged(() => setV((x) => x + 1)), [s]);
  return v;
}

export interface AsyncState<T> {
  data: T | undefined;
  error: Error | null;
  loading: boolean;
  reload: () => void;
}

/** Runs an async loader when deps change; keeps the previous data while reloading. */
export function useAsync<T>(fn: () => Promise<T>, deps: unknown[]): AsyncState<T> {
  const [data, setData] = useState<T | undefined>(undefined);
  const [error, setError] = useState<Error | null>(null);
  const [loading, setLoading] = useState(true);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let alive = true;
    // A data loader: marking "loading" when its inputs change is the intended behaviour.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoading(true);
    fn()
      .then((d) => {
        if (!alive) return;
        setData(d);
        setError(null);
      })
      .catch((e: unknown) => alive && setError(e instanceof Error ? e : new Error(String(e))))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, tick]);

  const reload = useCallback(() => setTick((x) => x + 1), []);
  return { data, error, loading, reload };
}

/** Cached schema + value formatting context (people names, site time zone). */
export function useSchema(): AsyncState<{ schema: Schema | null; ctx: ValueContext }> {
  const s = useServices();
  const version = useDataVersion();
  return useAsync(async () => {
    const schema = await s.engine.getSchema();
    const people = await s.store.people.nameMap();
    return { schema, ctx: { timeZone: getConfig().siteTimeZone, people } };
  }, [s, version]);
}

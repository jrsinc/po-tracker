import { useCallback, useMemo } from 'react';
import { useAsync, useDataVersion, useSchema, useServices } from '../hooks/services';
import { builtInReports, REPORTS_KEY, type Report } from './reports';

const NONE: Report[] = [];

/** Built-in reports for this schema plus the custom reports saved on this device. */
export function useReports() {
  const services = useServices();
  const version = useDataVersion();
  const schemaState = useSchema();
  const schema = schemaState.data?.schema ?? null;
  const custom = useAsync(async () => (await services.store.settings.getJson<Report[]>(REPORTS_KEY)) ?? [], [services, version]);

  const reloadCustom = custom.reload;
  const saveCustom = useCallback(
    async (list: Report[]) => {
      await services.store.settings.setJson(REPORTS_KEY, list);
      reloadCustom();
    },
    [services, reloadCustom],
  );

  const builtIns = useMemo(() => (schema ? builtInReports(schema) : []), [schema]);
  return { schemaState, builtIns, custom: custom.data ?? NONE, loading: custom.loading || schemaState.loading, saveCustom };
}

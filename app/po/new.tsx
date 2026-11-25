import { useRouter } from 'expo-router';
import { POForm } from '../../src/components/POForm';
import { EmptyState, ErrorState, LoadingState } from '../../src/components/ui';
import { getConfig } from '../../src/config/env';
import { useAsync, useServices } from '../../src/hooks/services';
import { formToGraphCreate, type FormValues } from '../../src/schema/values';
import { afterLocalChange } from '../../src/services/coordinator';

export default function NewPO() {
  const router = useRouter();
  const services = useServices();

  const state = useAsync(async () => {
    const schema = await services.engine.getSchema();
    const people = await services.store.people.all();
    return { schema, people };
  }, [services]);

  if (state.loading) return <LoadingState />;
  if (state.error) return <ErrorState message={state.error.message} onRetry={state.reload} />;
  const { schema, people } = state.data!;
  if (!schema) return <EmptyState title="Columns not loaded yet" message="Sync once while online to load the SharePoint columns." />;

  const initial: FormValues = {};
  for (const f of schema.fields) initial[f.name] = f.kind === 'boolean' ? false : f.kind === 'multichoice' ? [] : '';

  return (
    <POForm
      schema={schema}
      initial={initial}
      people={people}
      submitLabel="Create PO"
      onCancel={() => router.back()}
      onSubmit={async (values) => {
        const ctx = { timeZone: getConfig().siteTimeZone, people: {} };
        const localId = await services.engine.createItem(formToGraphCreate(values, schema, ctx));
        afterLocalChange(services);
        router.replace({ pathname: '/po/[id]', params: { id: localId } });
      }}
    />
  );
}

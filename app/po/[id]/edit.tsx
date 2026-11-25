import { useLocalSearchParams, useRouter } from 'expo-router';
import { POForm } from '../../../src/components/POForm';
import { EmptyState, ErrorState, LoadingState } from '../../../src/components/ui';
import { useAsync, useServices } from '../../../src/hooks/services';
import { getConfig } from '../../../src/config/env';
import { diffToGraph, formFromFields } from '../../../src/schema/values';
import { afterLocalChange } from '../../../src/services/coordinator';

export default function EditPO() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const services = useServices();

  const state = useAsync(async () => {
    const schema = await services.engine.getSchema();
    const item = await services.store.items.get(id);
    const people = await services.store.people.all();
    const ctx = { timeZone: getConfig().siteTimeZone, people: Object.fromEntries(people.map((p) => [p.lookupId, p.name])) };
    return { schema, item, people, ctx, initial: schema && item ? formFromFields(item.fields, schema, ctx) : {} };
  }, [services, id]);

  if (state.loading) return <LoadingState />;
  if (state.error) return <ErrorState message={state.error.message} onRetry={state.reload} />;
  const { schema, item, people, ctx, initial } = state.data!;
  if (!schema) return <EmptyState title="Columns not loaded yet" message="Sync once while online to load the SharePoint columns." />;
  if (!item) return <EmptyState title="PO not found" />;

  return (
    <POForm
      schema={schema}
      initial={initial}
      people={people}
      submitLabel="Save"
      onCancel={() => router.back()}
      onSubmit={async (values) => {
        const patch = diffToGraph(initial, values, schema, ctx);
        if (Object.keys(patch).length) {
          await services.engine.updateItem(item.localId, patch);
          afterLocalChange(services);
        }
        router.back();
      }}
    />
  );
}

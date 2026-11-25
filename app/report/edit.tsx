import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { ColumnPickerModal } from '../../src/components/ColumnPickerModal';
import { ConditionsModal } from '../../src/components/ConditionsModal';
import { PickerModal } from '../../src/components/PickerModal';
import { spacing, useTheme } from '../../src/components/theme';
import { Banner, Button, Card, EmptyState, LoadingState, SectionHeader, Txt } from '../../src/components/ui';
import { newReportId, type Report } from '../../src/reports/reports';
import { useReports } from '../../src/reports/useReports';
import { describeConditions, EMPTY_CONDITIONS, isComplete, type ConditionSet } from '../../src/schema/conditions';

/** Create or change a custom report: name, conditions, columns to fill in. */
export default function EditReport() {
  const { id } = useLocalSearchParams<{ id?: string }>();
  const { schemaState, custom, loading } = useReports();
  if (loading && !schemaState.data) return <LoadingState />;
  const existing = id ? custom.find((r) => r.id === id) : undefined;
  if (id && !existing && !loading) return <EmptyState title="Report not found" />;
  // Keyed so the form starts from the loaded report.
  return <Editor key={existing?.id ?? 'new'} existing={existing} />;
}

function Editor({ existing }: { existing?: Report }) {
  const t = useTheme();
  const router = useRouter();
  const { schemaState, custom, saveCustom } = useReports();
  const schema = schemaState.data?.schema;
  const ctx = schemaState.data?.ctx;
  const [name, setName] = useState(existing?.name ?? '');
  const [description, setDescription] = useState(existing?.description ?? '');
  const [conditions, setConditions] = useState<ConditionSet>(existing?.conditions ?? EMPTY_CONDITIONS);
  const [columns, setColumns] = useState<string[]>(existing?.columns ?? []);
  const [groupBy, setGroupBy] = useState<string>(existing?.groupBy ?? '');
  const [modal, setModal] = useState<'conditions' | 'columns' | 'group' | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (!schema || !ctx) return <EmptyState title="No data yet" message="Sync once while online to load the SharePoint columns." />;

  const complete = conditions.conditions.filter((c) => isComplete(c, schema));
  // Suggested columns to fill: the fields the conditions check.
  const suggested = [...new Set(complete.map((c) => c.field))];

  const save = async () => {
    if (!name.trim()) return setError('Give the report a name.');
    if (!complete.length) return setError('Add at least one condition.');
    const report: Report = {
      id: existing?.id ?? newReportId(),
      name: name.trim(),
      description: description.trim() || undefined,
      conditions: { ...conditions, conditions: complete },
      columns: columns.length ? columns : suggested,
      groupBy: groupBy || undefined,
    };
    await saveCustom(existing ? custom.map((r) => (r.id === report.id ? report : r)) : [...custom, report]);
    router.replace({ pathname: '/report/[id]', params: { id: report.id } });
  };

  const input = [s.input, { color: t.text, borderColor: t.border, backgroundColor: t.inputBg }];

  return (
    <>
      <Stack.Screen options={{ title: existing ? 'Edit report' : 'New report' }} />
      <ScrollView style={{ flex: 1, backgroundColor: t.bg }} contentContainerStyle={{ padding: spacing.lg, maxWidth: 760, width: '100%', alignSelf: 'center' }} keyboardShouldPersistTaps="handled">
        {error ? <Banner tone="danger" text={error} /> : null}
        <Card>
          <Txt size={13} weight="600" muted style={{ marginBottom: 6 }}>
            Report name *
          </Txt>
          <TextInput value={name} onChangeText={setName} placeholder="e.g. Ready to ship, no dispatch date" placeholderTextColor={t.muted} style={input} accessibilityLabel="Report name" />
          <Txt size={13} weight="600" muted style={{ marginTop: spacing.md, marginBottom: 6 }}>
            Description
          </Txt>
          <TextInput value={description} onChangeText={setDescription} placeholder="Optional" placeholderTextColor={t.muted} style={input} accessibilityLabel="Description" />
        </Card>

        <SectionHeader title="1. Conditions" right={<Button compact kind="ghost" title={complete.length ? 'Change' : '+ Add'} onPress={() => setModal('conditions')} />} />
        <Card>
          {complete.length ? (
            <Txt size={14}>{describeConditions(conditions, schema, ctx)}</Txt>
          ) : (
            <Txt muted>For example: Status is “Completed” AND Outbound AWB # is empty.</Txt>
          )}
        </Card>

        <SectionHeader title="2. Columns to show and fill in" right={<Button compact kind="ghost" title="Choose" onPress={() => setModal('columns')} />} />
        <Card>
          <Txt>
            {(columns.length ? columns : suggested)
              .map((n) => schema.byName[n]?.label)
              .filter(Boolean)
              .join(', ') || 'The columns used in the conditions.'}
          </Txt>
          {!columns.length && suggested.length ? (
            <Txt size={12} muted style={{ marginTop: 4 }}>
              Using the columns from your conditions. Tap Choose to change.
            </Txt>
          ) : null}
        </Card>

        <SectionHeader title="3. Group lines by (optional)" right={<Button compact kind="ghost" title="Choose" onPress={() => setModal('group')} />} />
        <Card>
          <Txt>{groupBy ? (schema.byName[groupBy]?.label ?? groupBy) : 'No grouping'}</Txt>
          <Txt size={12} muted style={{ marginTop: 4 }}>
            For example group by Account Manager or Customer: the report shows one heading per person or customer with their lines under it.
          </Txt>
        </Card>

        <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.lg, marginBottom: spacing.xl * 2 }}>
          <Button kind="ghost" title="Cancel" onPress={() => router.back()} style={{ flex: 1 }} />
          <Button title="Save report" onPress={save} style={{ flex: 2 }} />
        </View>
      </ScrollView>

      {modal === 'conditions' ? (
        <ConditionsModal visible schema={schema} ctx={ctx} value={conditions} onClose={() => setModal(null)} onApply={setConditions} />
      ) : modal === 'columns' ? (
        <ColumnPickerModal
          visible
          schema={schema}
          value={columns.length ? columns : suggested}
          defaults={suggested}
          onClose={() => setModal(null)}
          onApply={setColumns}
        />
      ) : modal === 'group' ? (
        <PickerModal
          visible
          title="Group lines by"
          options={[
            { value: '', label: 'No grouping' },
            ...schema.fields
              .filter((f) => ['choice', 'person', 'text'].includes(f.kind))
              .map((f) => ({ value: f.name, label: f.label })),
          ]}
          selected={[groupBy]}
          onClose={() => setModal(null)}
          onChange={(v) => setGroupBy(v[0] ?? '')}
        />
      ) : null}
    </>
  );
}

const s = StyleSheet.create({
  input: { borderWidth: 1, borderRadius: 10, minHeight: 44, paddingHorizontal: 12, fontSize: 15 },
});

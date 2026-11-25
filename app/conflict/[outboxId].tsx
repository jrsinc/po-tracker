import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { spacing, useTheme } from '../../src/components/theme';
import { Banner, Button, Card, EmptyState, ErrorState, LoadingState, Txt } from '../../src/components/ui';
import { useAsync, useSchema, useServices } from '../../src/hooks/services';
import type { FieldDef } from '../../src/schema/columnMapper';
import { displayValue, fieldKey } from '../../src/schema/values';
import { afterLocalChange } from '../../src/services/coordinator';

export default function ConflictScreen() {
  const t = useTheme();
  const router = useRouter();
  const { outboxId } = useLocalSearchParams<{ outboxId: string }>();
  const services = useServices();
  const schemaState = useSchema();
  const view = useAsync(() => services.engine.getConflict(Number(outboxId)), [services, outboxId]);
  // Only the user's explicit picks are stored; every field defaults to "mine".
  const [picks, setChoice] = useState<Record<string, 'mine' | 'server'>>({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const choice: Record<string, 'mine' | 'server'> = {
    ...Object.fromEntries((view.data?.fields ?? []).map((f) => [f.key, 'mine' as const])),
    ...picks,
  };

  if (view.loading) return <LoadingState />;
  if (view.error) return <ErrorState message={view.error.message} onRetry={view.reload} />;
  const v = view.data;
  if (!v) return <EmptyState title="Nothing to resolve" message="This conflict was already resolved." action={<Button title="Back" onPress={() => router.back()} />} />;

  const schema = schemaState.data?.schema;
  const ctx = schemaState.data?.ctx ?? { timeZone: 'UTC', people: {} };
  const defFor = (key: string): FieldDef | undefined => schema?.fields.find((f) => fieldKey(f) === key);
  const show = (key: string, value: unknown) => {
    const def = defFor(key);
    if (value === null || value === undefined || value === '') return '(blank)';
    return def ? displayValue({ [key]: value }, def, ctx) || '(blank)' : String(value);
  };

  const apply = async (resolution: Parameters<typeof services.engine.resolveConflict>[1]) => {
    setSaving(true);
    setError(null);
    try {
      await services.engine.resolveConflict(v.entry.id, resolution);
      afterLocalChange(services);
      router.back();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  const isDelete = v.entry.op === 'delete';
  const serverDeleted = v.conflict.serverDeleted;

  return (
    <ScrollView style={{ flex: 1, backgroundColor: t.bg }} contentContainerStyle={{ padding: spacing.lg, maxWidth: 860, width: '100%', alignSelf: 'center' }}>
      {error ? <Banner tone="danger" text={error} /> : null}
      <Card>
        <Txt weight="700" size={17} accessibilityRole="header">
          {isDelete
            ? 'You deleted this PO, but someone changed it in SharePoint.'
            : serverDeleted
              ? 'This PO was deleted in SharePoint, but you have unsynced changes.'
              : 'This PO was changed in SharePoint after you edited it.'}
        </Txt>
        <Txt muted style={{ marginTop: spacing.sm }}>
          Nothing has been overwritten. Choose which version to keep.
        </Txt>
      </Card>

      {isDelete ? (
        <View style={{ gap: spacing.md }}>
          <Button kind="danger" title="Delete anyway" loading={saving} onPress={() => apply({ mode: 'mine' })} />
          <Button kind="secondary" title="Keep the SharePoint version" disabled={saving} onPress={() => apply({ mode: 'server' })} />
        </View>
      ) : serverDeleted ? (
        <View style={{ gap: spacing.md }}>
          <Button title="Re-create the PO with my data" loading={saving} onPress={() => apply({ mode: 'mine' })} />
          <Button kind="secondary" title="Accept the deletion" disabled={saving} onPress={() => apply({ mode: 'server' })} />
        </View>
      ) : (
        <>
          {v.fields.map((f) => {
            const def = defFor(f.key);
            return (
              <Card key={f.key}>
                <Txt weight="700" style={{ marginBottom: spacing.sm }}>
                  {def?.label ?? f.key}
                </Txt>
                {(['mine', 'server'] as const).map((side) => {
                  const on = choice[f.key] === side;
                  return (
                    <Pressable
                      key={side}
                      accessibilityRole="radio"
                      accessibilityState={{ checked: on }}
                      accessibilityLabel={`${side === 'mine' ? 'My value' : 'SharePoint value'}: ${show(f.key, side === 'mine' ? f.mine : f.server)}`}
                      onPress={() => setChoice((c) => ({ ...c, [f.key]: side }))}
                      style={{
                        flexDirection: 'row',
                        alignItems: 'center',
                        padding: spacing.md,
                        borderRadius: 10,
                        borderWidth: 1,
                        borderColor: on ? t.primary : t.border,
                        backgroundColor: on ? t.chipActive : 'transparent',
                        marginBottom: spacing.sm,
                      }}
                    >
                      <Txt size={12} muted style={{ width: 90 }}>
                        {side === 'mine' ? 'Mine' : 'SharePoint'}
                      </Txt>
                      <Txt style={{ flex: 1 }}>{show(f.key, side === 'mine' ? f.mine : f.server)}</Txt>
                      {on ? <Txt color={t.primary} weight="700">✓</Txt> : null}
                    </Pressable>
                  );
                })}
              </Card>
            );
          })}
          {v.fields.length === 0 ? (
            <Card>
              <Txt muted>Your values already match SharePoint. Keeping the SharePoint version is safe.</Txt>
            </Card>
          ) : null}
          <View style={{ gap: spacing.md, marginBottom: spacing.xl * 2 }}>
            <Button
              title="Apply my choices"
              loading={saving}
              onPress={() => apply({ mode: 'merge', keepMine: Object.entries(choice).filter(([, s]) => s === 'mine').map(([k]) => k) })}
            />
            <View style={{ flexDirection: 'row', gap: spacing.md }}>
              <Button kind="secondary" title="Keep all mine" disabled={saving} onPress={() => apply({ mode: 'mine' })} style={{ flex: 1 }} />
              <Button kind="secondary" title="Keep all SharePoint" disabled={saving} onPress={() => apply({ mode: 'server' })} style={{ flex: 1 }} />
            </View>
          </View>
        </>
      )}
    </ScrollView>
  );
}

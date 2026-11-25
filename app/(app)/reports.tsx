import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useMemo } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { spacing, useTheme } from '../../src/components/theme';
import { Button, EmptyState, LoadingState, SectionHeader, Txt } from '../../src/components/ui';
import { useAsync, useDataVersion, useServices } from '../../src/hooks/services';
import { describeConditions } from '../../src/schema/conditions';
import { runReport, type Report } from '../../src/reports/reports';
import { useReports } from '../../src/reports/useReports';

/** Reports: saved condition checks ("Completed but AWB missing") with live counts. */
export default function ReportsScreen() {
  const t = useTheme();
  const router = useRouter();
  const services = useServices();
  const version = useDataVersion();
  const { schemaState, builtIns, custom, loading } = useReports();
  const items = useAsync(() => services.store.items.query({}), [services, version]);

  const schema = schemaState.data?.schema;
  const ctx = schemaState.data?.ctx;
  const counts = useMemo(() => {
    const out: Record<string, number> = {};
    if (!schema || !ctx || !items.data) return out;
    for (const r of [...builtIns, ...custom]) out[r.id] = runReport(items.data, r, schema, ctx).length;
    return out;
  }, [schema, ctx, items.data, builtIns, custom]);

  if ((loading || items.loading) && !items.data) return <LoadingState />;
  if (!schema || !ctx) return <EmptyState title="No data yet" message="Sync once while online to load the SharePoint columns." />;

  const open = (r: Report) => router.push({ pathname: '/report/[id]', params: { id: r.id } });

  const row = (r: Report) => {
    const n = counts[r.id];
    const summary = describeConditions(r.conditions, schema, ctx);
    const clean = n === 0;
    return (
      <Pressable
        key={r.id}
        accessibilityRole="button"
        accessibilityLabel={`${r.name}, ${n ?? 0} lines`}
        onPress={() => open(r)}
        style={({ pressed }) => [s.card, { backgroundColor: pressed ? t.chip : t.card, borderColor: t.border, borderLeftColor: clean ? t.success : t.danger }]}
      >
        <View style={{ flex: 1 }}>
          <Txt size={15} weight="700">
            {r.name}
          </Txt>
          <Txt size={12} muted style={{ marginTop: 2 }} numberOfLines={2}>
            {r.description || summary || 'No conditions yet'}
          </Txt>
        </View>
        <View style={[s.count, { backgroundColor: clean ? (t.dark ? '#0F3320' : '#D7F5DF') : t.dark ? '#4A1715' : '#FDE2DF' }]}>
          {clean ? <Ionicons name="checkmark" size={14} color={t.success} /> : null}
          <Txt size={14} weight="800" color={clean ? t.success : t.danger}>
            {n ?? '…'}
          </Txt>
        </View>
        <Ionicons name="chevron-forward" size={18} color={t.muted} />
      </Pressable>
    );
  };

  return (
    <ScrollView style={{ flex: 1, backgroundColor: t.bg }} contentContainerStyle={{ padding: spacing.lg, maxWidth: 860, width: '100%', alignSelf: 'center' }}>
      <Txt muted size={13}>
        Each report lists the PO lines that match its conditions. Open one to fill in the missing data right there; changes sync to
        SharePoint like any other edit.
      </Txt>

      <SectionHeader title="Data checks" />
      {builtIns.map(row)}

      <SectionHeader
        title="My reports"
        right={<Button compact kind="ghost" title="+ New report" onPress={() => router.push({ pathname: '/report/edit', params: {} })} />}
      />
      {custom.length ? (
        custom.map(row)
      ) : (
        <Txt muted size={13} style={{ marginBottom: spacing.md }}>
          No custom reports yet. Tap “New report” to pick your own conditions, for example “Status is Ready to Ship and Dispatch Date is empty”.
        </Txt>
      )}
      <View style={{ height: spacing.xl * 2 }} />
    </ScrollView>
  );
}

const s = StyleSheet.create({
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    padding: spacing.md,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderLeftWidth: 4,
    marginBottom: spacing.sm,
  },
  count: { flexDirection: 'row', alignItems: 'center', gap: 3, minWidth: 48, justifyContent: 'center', borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4 },
});

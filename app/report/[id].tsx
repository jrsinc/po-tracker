import { Ionicons } from '@expo/vector-icons';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { FlatList, Platform, ScrollView, StyleSheet, View } from 'react-native';
import { confirm, notify } from '../../src/components/confirm';
import { EditableRow, editCellWidth, ROW_ACTIONS_W, ROW_SERIAL_W, type TableColumn } from '../../src/components/EditableRow';
import { StatusPill } from '../../src/components/fieldGrid';
import { spacing, useTheme } from '../../src/components/theme';
import { Button, Card, Chip, EmptyState, LoadingState, Txt } from '../../src/components/ui';
import type { SemanticKey } from '../../src/config/schemaGroups';
import type { LocalItem } from '../../src/db/repositories/items';
import { useAsync, useDataVersion, useServices } from '../../src/hooks/services';
import { exportCsv } from '../../src/reports/exportCsv';
import { groupReport, newReportId, reportCsv, runReport, type Report, type ReportGroup } from '../../src/reports/reports';
import { useReports } from '../../src/reports/useReports';
import type { FieldDef } from '../../src/schema/columnMapper';
import { describeConditions } from '../../src/schema/conditions';
import { afterLocalChange } from '../../src/services/coordinator';

/** Read-only identity columns at the left of every report table. */
const IDENTITY: { key: SemanticKey; width: number }[] = [
  { key: 'folder', width: 118 },
  { key: 'line', width: 52 },
  { key: 'customer', width: 190 },
  { key: 'product', width: 270 },
  { key: 'status', width: 140 },
];

function editWidth(d: FieldDef): number {
  switch (d.kind) {
    case 'note':
      return 260;
    case 'number':
    case 'currency':
      return 110;
    case 'boolean':
      return 90;
    case 'date':
    case 'datetime':
      return 170;
    case 'choice':
    case 'multichoice':
    case 'person':
      return 200;
    default:
      return 180;
  }
}

type Entry = { type: 'group'; group: ReportGroup } | { type: 'row'; item: LocalItem; serial: number };

/** One report as a table: identity columns, then the report's columns editable in place. */
export default function ReportScreen() {
  const t = useTheme();
  const router = useRouter();
  const services = useServices();
  const version = useDataVersion();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { schemaState, builtIns, custom, loading, saveCustom } = useReports();
  const items = useAsync(() => services.store.items.query({}), [services, version]);
  const people = useAsync(() => services.store.people.all(), [services]);

  const report = builtIns.find((r) => r.id === id) ?? custom.find((r) => r.id === id);
  const schema = schemaState.data?.schema;
  const ctx = schemaState.data?.ctx;
  const rows = useMemo(() => (report && schema && ctx && items.data ? runReport(items.data, report, schema, ctx) : []), [report, schema, ctx, items.data]);
  const groups = useMemo(() => (report && schema && ctx ? groupReport(rows, report, schema, ctx) : []), [rows, report, schema, ctx]);
  /** Group shown on its own (null = all groups). */
  const [only, setOnly] = useState<string | null>(null);
  const entries: Entry[] = useMemo(() => {
    if (!groups.length) return rows.map((item, i) => ({ type: 'row', item, serial: i + 1 }));
    const out: Entry[] = [];
    for (const g of groups) {
      if (only && g.key !== only) continue;
      out.push({ type: 'group', group: g });
      g.rows.forEach((item, i) => out.push({ type: 'row', item, serial: i + 1 }));
    }
    return out;
  }, [groups, rows, only]);

  if ((loading || items.loading) && !items.data) return <LoadingState />;
  if (!schema || !ctx) return <EmptyState title="No data yet" message="Sync once while online to load the SharePoint columns." />;
  if (!report) return <EmptyState title="Report not found" action={<Button title="Back" onPress={() => router.back()} />} />;

  // A grouped report is a working list (e.g. the daily meeting), not a "needs fixing" check.
  const isList = !!report.groupBy;
  const shownCount = only ? (groups.find((g) => g.key === only)?.rows.length ?? 0) : rows.length;
  const editDefs = report.columns.map((n) => schema.byName[n]).filter((d): d is FieldDef => !!d && d.name !== report.groupBy);
  const identity = IDENTITY.map((c) => ({ ...c, def: schema.bySemantic[c.key] })).filter(
    (c): c is typeof c & { def: FieldDef } => !!c.def && !editDefs.includes(c.def) && c.def.name !== report.groupBy,
  );
  const columns: TableColumn[] = [
    ...identity.map((c) => ({ def: c.def, width: c.width })),
    ...editDefs.map((d) => ({ def: d, width: editWidth(d) })),
  ].map((c) => ({ ...c, width: editCellWidth(c) }));
  const tableWidth = ROW_SERIAL_W + columns.reduce((n, c) => n + c.width, 0) + ROW_ACTIONS_W + 2 * spacing.md + 2 * spacing.lg;
  const summary = describeConditions(report.conditions, schema, ctx);

  const onExport = async () => {
    try {
      const date = new Date().toISOString().slice(0, 10);
      await exportCsv(`${report.name.replace(/[^\w -]+/g, '').trim() || 'report'} ${date}.csv`, reportCsv(rows, report, schema, ctx));
    } catch (e) {
      notify('Export failed', e instanceof Error ? e.message : String(e));
    }
  };
  const onCopy = async () => {
    const copy: Report = { ...report, id: newReportId(), name: `${report.name} (copy)`, builtIn: false };
    await saveCustom([...custom, copy]);
    router.replace({ pathname: '/report/edit', params: { id: copy.id } });
  };
  const onDelete = async () => {
    if (!(await confirm('Delete this report?', `“${report.name}” will be removed from this device. No PO data is changed.`, 'Delete', true))) return;
    await saveCustom(custom.filter((r) => r.id !== report.id));
    router.back();
  };

  const header = (
    <View style={{ padding: spacing.lg, paddingBottom: spacing.sm, maxWidth: 1100, width: '100%', alignSelf: 'center' }}>
      <Card style={{ padding: spacing.md, marginBottom: 0 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
          <View
            style={[
              s.countBig,
              { backgroundColor: isList ? t.chipActive : rows.length ? (t.dark ? '#4A1715' : '#FDE2DF') : t.dark ? '#0F3320' : '#D7F5DF' },
            ]}
          >
            <Txt size={22} weight="800" color={isList ? t.primary : rows.length ? t.danger : t.success}>
              {shownCount}
            </Txt>
          </View>
          <View style={{ flex: 1 }}>
            <Txt size={16} weight="700">
              {isList
                ? `open line${shownCount === 1 ? '' : 's'}${only ? ` · ${only}` : groups.length ? ` · ${groups.length} account managers` : ''}`
                : rows.length
                  ? `line${rows.length === 1 ? '' : 's'} need attention`
                  : 'All good: no lines match'}
            </Txt>
            {isList ? (
              <Txt size={12} muted>
                {new Date().toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
              </Txt>
            ) : null}
            <Txt size={12} color={t.primary} style={{ marginTop: 2 }}>
              {summary || 'No conditions'}
            </Txt>
          </View>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, justifyContent: 'flex-end', flexShrink: 1 }}>
            <Button compact kind="secondary" title="Export CSV" onPress={onExport} disabled={!rows.length} />
            {Platform.OS === 'web' ? <Button compact kind="ghost" title="Print" onPress={() => window.print()} /> : null}
            {report.builtIn ? (
              <Button compact kind="ghost" title="Copy and change" onPress={onCopy} />
            ) : (
              <>
                <Button compact kind="ghost" title="Edit report" onPress={() => router.push({ pathname: '/report/edit', params: { id: report.id } })} />
                <Button compact kind="ghost" title="Delete" onPress={onDelete} />
              </>
            )}
          </View>
        </View>
        {editDefs.length ? (
          <Txt size={12} muted style={{ marginTop: spacing.sm }}>
            {isList
              ? `Update ${editDefs.map((d) => d.label).join(', ')} in the table and tap Save on that line; it syncs to SharePoint.`
              : `Fill in ${editDefs.map((d) => d.label).join(', ')} in the table and tap Save. A line leaves this report once it no longer matches.`}
          </Txt>
        ) : null}
        {groups.length > 1 ? (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginTop: spacing.md }}>
            <Chip label={`All (${rows.length})`} active={!only} onPress={() => setOnly(null)} />
            {groups.map((g) => (
              <Chip key={g.key} label={`${g.title} (${g.rows.length})`} active={only === g.key} onPress={() => setOnly(only === g.key ? null : g.key)} />
            ))}
          </ScrollView>
        ) : null}
      </Card>
    </View>
  );

  return (
    <>
      <Stack.Screen options={{ title: report.name }} />
      <View style={{ flex: 1, backgroundColor: t.bg }}>
        {header}
        {rows.length ? (
          <ScrollView horizontal style={{ flex: 1 }} contentContainerStyle={{ flexGrow: 1, justifyContent: 'center' }}>
            <View style={{ width: tableWidth, flex: 1, paddingHorizontal: spacing.lg }}>
              <View style={[s.tr, s.th, { backgroundColor: t.chip, borderColor: t.border }]} accessibilityRole="header">
                <Txt size={12} weight="800" muted style={{ width: ROW_SERIAL_W }}>
                  S.No
                </Txt>
                {columns.map((c) => (
                  <Txt key={c.def.name} size={12} weight="800" color={editDefs.includes(c.def) ? t.primary : t.muted} style={[s.cellPad, { width: c.width }]} numberOfLines={1}>
                    {c.def.label}
                  </Txt>
                ))}
                <Txt size={12} weight="800" muted style={{ width: ROW_ACTIONS_W }}>
                  Edit
                </Txt>
              </View>
              <FlatList
                data={entries}
                keyExtractor={(e) => (e.type === 'group' ? `g:${e.group.key}` : e.item.localId)}
                initialNumToRender={20}
                windowSize={9}
                keyboardShouldPersistTaps="handled"
                contentContainerStyle={{ paddingBottom: 96 }}
                renderItem={({ item: entry }) =>
                  entry.type === 'group' ? (
                    <GroupHeader group={entry.group} />
                  ) : (
                    <EditableRow
                      item={entry.item}
                      serial={entry.serial}
                      schema={schema}
                      ctx={ctx}
                      columns={columns}
                      people={people.data ?? []}
                      onOpen={() => router.push({ pathname: '/po/[id]', params: { id: entry.item.localId } })}
                      onSave={async (patch) => {
                        await services.engine.updateItem(entry.item.localId, patch);
                        afterLocalChange(services);
                      }}
                    />
                  )
                }
              />
            </View>
          </ScrollView>
        ) : (
          <View style={{ alignItems: 'center', padding: spacing.xl }}>
            <Ionicons name="checkmark-circle" size={48} color={t.success} />
            <Txt muted style={{ marginTop: spacing.sm }}>
              Nothing to fix.
            </Txt>
          </View>
        )}
      </View>
    </>
  );
}

/** Full-width group row (e.g. account manager) with line count and status breakdown. */
function GroupHeader({ group }: { group: ReportGroup }) {
  const t = useTheme();
  return (
    <View style={[s.groupHead, { backgroundColor: t.primary }]} accessibilityRole="header">
      <Ionicons name="person-circle" size={22} color={t.primaryText} />
      <Txt size={15} weight="800" color={t.primaryText} numberOfLines={1}>
        {group.title}
      </Txt>
      <Txt size={13} weight="700" color={t.primaryText}>
        · {group.rows.length} line{group.rows.length === 1 ? '' : 's'}
      </Txt>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginLeft: spacing.sm }}>
        {group.statusCounts.map(([st, n]) => (
          <View key={st} style={[s.miniCount, { backgroundColor: t.card }]}>
            <StatusPill status={st} />
            <Txt size={12} weight="800">
              {n}
            </Txt>
          </View>
        ))}
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  countBig: { minWidth: 56, height: 48, borderRadius: 12, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 10 },
  tr: { flexDirection: 'row', alignItems: 'center', minHeight: 50, paddingHorizontal: spacing.md, borderBottomWidth: StyleSheet.hairlineWidth },
  th: { minHeight: 40, borderTopLeftRadius: 8, borderTopRightRadius: 8, borderBottomWidth: 1 },
  cellPad: { paddingRight: spacing.sm, paddingVertical: 6 },
  groupHead: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.md, paddingVertical: 10, marginTop: spacing.sm, flexWrap: 'wrap' },
  miniCount: { flexDirection: 'row', alignItems: 'center', gap: 4, borderRadius: 999, paddingLeft: 2, paddingRight: 8, paddingVertical: 2 },
});

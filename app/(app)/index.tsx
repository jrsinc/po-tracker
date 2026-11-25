import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { memo, useEffect, useMemo, useState } from 'react';
import { FlatList, Pressable, RefreshControl, ScrollView, StyleSheet, TextInput, useWindowDimensions, View } from 'react-native';
import { FolderLink } from '../../src/components/FolderLink';
import { afterLocalChange } from '../../src/services/coordinator';
import { EditableRow, editCellWidth, ROW_ACTIONS_W, ROW_LINK_W, ROW_SERIAL_W, type TableColumn } from '../../src/components/EditableRow';
import { StatusPill } from '../../src/components/fieldGrid';
import { ColumnFilterModal } from '../../src/components/ColumnFilterModal';
import { ColumnPickerModal } from '../../src/components/ColumnPickerModal';
import { ConditionsModal } from '../../src/components/ConditionsModal';
import { PickerModal, type PickerOption } from '../../src/components/PickerModal';
import { spacing, useTheme } from '../../src/components/theme';
import { Badge, Banner, Button, Chip, EmptyState, ErrorState, LoadingState, Txt } from '../../src/components/ui';
import { FILTER_KEYS, type SemanticKey } from '../../src/config/schemaGroups';
import type { ItemQuery, LocalItem } from '../../src/db/repositories/items';
import { useAsync, useDataVersion, useSchema, useServices, useSyncStatus } from '../../src/hooks/services';
import type { FieldDef, Schema } from '../../src/schema/columnMapper';
import {
  activeColumnFilterCount,
  applyColumnFilters,
  columnWidth,
  distinctValues,
  sortByColumn,
  type ColumnFilters,
  type ColumnSort,
} from '../../src/schema/columnFilters';
import {
  activeConditionCount,
  describeConditions,
  EMPTY_CONDITIONS,
  matchesConditions,
  opsFor,
  type ConditionSet,
} from '../../src/schema/conditions';
import { groupByFolder, type FolderGroup } from '../../src/schema/grouping';
import { displayValue, fieldKey, type ValueContext } from '../../src/schema/values';

type SortKey = 'modified' | 'folder' | 'customer' | 'status' | 'dirty';
type ViewMode = 'folders' | 'cards' | 'table';
const KEYS = {
  view: 'listView',
  conditions: 'listConditions',
  columns: 'listColumns',
  colFilters: 'listColumnFilters',
  colSort: 'listColumnSort',
  serialDesc: 'listSerialDesc',
} as const;

const SORTS: { key: SortKey; label: string }[] = [
  { key: 'modified', label: 'Last modified' },
  { key: 'folder', label: 'Folder # (high to low)' },
  { key: 'customer', label: 'Customer (A–Z)' },
  { key: 'status', label: 'Status (A–Z)' },
  { key: 'dirty', label: 'Unsynced first' },
];

const FILTER_LABELS: Partial<Record<SemanticKey, string>> = {
  status: 'Status',
  paymentStatus: 'Payment',
  service: 'Service',
  accountManager: 'Account manager',
};

/** Columns shown until the user picks their own. */
const DEFAULT_COLUMNS: SemanticKey[] = ['folder', 'line', 'customer', 'product', 'status', 'remarksOnStatus', 'remarks', 'customerPo', 'accountManager'];

function buildQuery(schema: Schema | null, search: string, filters: Partial<Record<SemanticKey, string[]>>, sort: SortKey): ItemQuery {
  const q: ItemQuery = { search, filters: {} };
  if (schema) {
    for (const [k, values] of Object.entries(filters)) {
      const def = schema.bySemantic[k as SemanticKey];
      if (def && values?.length) q.filters![fieldKey(def)] = values;
    }
    const pick = (k: SemanticKey) => schema.bySemantic[k];
    if (sort === 'folder' && pick('folder'))
      q.sort = {
        key: fieldKey(pick('folder')!),
        direction: 'desc',
        numeric: true,
      };
    if (sort === 'customer' && pick('customer')) q.sort = { key: fieldKey(pick('customer')!), direction: 'asc' };
    if (sort === 'status' && pick('status')) q.sort = { key: fieldKey(pick('status')!), direction: 'asc' };
  }
  if (sort === 'dirty') q.sort = { special: 'dirty' };
  if (sort === 'modified') q.sort = { special: 'modified' };
  return q;
}

/** Header context shared by all column headers: filter/sort state and the open-filter action. */
interface HeaderCtx {
  colFilters: ColumnFilters;
  colSort: ColumnSort | null;
  openFilter: (field: string) => void;
  serialDesc: boolean;
  toggleSerial: () => void;
}

export default function POList() {
  const t = useTheme();
  const router = useRouter();
  const services = useServices();
  const status = useSyncStatus();
  const version = useDataVersion();
  const schemaState = useSchema();
  const schema = schemaState.data?.schema ?? null;
  const ctx = schemaState.data?.ctx;

  const [search, setSearch] = useState('');
  const [filters, setFilters] = useState<Partial<Record<SemanticKey, string[]>>>({});
  const [conditions, setConditionsState] = useState<ConditionSet>(EMPTY_CONDITIONS);
  const [conditionsSeed, setConditionsSeed] = useState<ConditionSet | null>(null);
  const [sort, setSort] = useState<SortKey>('modified');
  const [picker, setPicker] = useState<SemanticKey | 'sort' | 'conditions' | 'columns' | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [view, setViewState] = useState<ViewMode>('folders');
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [columnsState, setColumnsState] = useState<string[] | null>(null);
  const [colFilters, setColFiltersState] = useState<ColumnFilters>({});
  const [colSort, setColSortState] = useState<ColumnSort | null>(null);
  const [filterFor, setFilterFor] = useState<string | null>(null);
  /** S.No descending: show the list bottom-up (last row first), numbers counting down. */
  const [serialDesc, setSerialDescState] = useState(false);

  // Restore this device's list preferences.
  useEffect(() => {
    const st = services.store.settings;
    st.get(KEYS.view)
      .then((v) => {
        if (v === 'cards' || v === 'table' || v === 'folders') setViewState(v);
      })
      .catch(() => undefined);
    st.getJson<ConditionSet>(KEYS.conditions)
      .then((c) => {
        if (c?.conditions) setConditionsState(c);
      })
      .catch(() => undefined);
    st.getJson<string[]>(KEYS.columns)
      .then((c) => {
        if (Array.isArray(c) && c.length) setColumnsState(c);
      })
      .catch(() => undefined);
    st.getJson<ColumnFilters>(KEYS.colFilters)
      .then((c) => {
        if (c) setColFiltersState(c);
      })
      .catch(() => undefined);
    st.get(KEYS.serialDesc)
      .then((v) => setSerialDescState(v === '1'))
      .catch(() => undefined);
    st.getJson<ColumnSort>(KEYS.colSort)
      .then((c) => {
        if (c?.field) setColSortState(c);
      })
      .catch(() => undefined);
  }, [services]);

  const persist = (key: string, value: unknown) => void services.store.settings.setJson(key, value);
  const setView = (v: ViewMode) => {
    setViewState(v);
    void services.store.settings.set(KEYS.view, v);
  };
  const setConditions = (c: ConditionSet) => {
    setConditionsState(c);
    persist(KEYS.conditions, c);
  };
  const setColumns = (c: string[]) => {
    setColumnsState(c);
    persist(KEYS.columns, c);
  };
  const setColFilter = (field: string, values: string[]) => {
    setColFiltersState((prev) => {
      const next = { ...prev };
      if (values.length) next[field] = values;
      else delete next[field];
      persist(KEYS.colFilters, next);
      return next;
    });
  };
  const setColSort = (s: ColumnSort | null) => {
    setColSortState(s);
    persist(KEYS.colSort, s);
  };

  const toggleSerial = () => {
    setSerialDescState((d) => {
      void services.store.settings.set(KEYS.serialDesc, d ? '0' : '1');
      return !d;
    });
  };

  const defaultColumns = useMemo(() => (schema ? DEFAULT_COLUMNS.map((k) => schema.bySemantic[k]?.name).filter((n): n is string => !!n) : []), [schema]);
  const columnDefs: FieldDef[] = useMemo(() => {
    if (!schema) return [];
    const names = (columnsState ?? defaultColumns).filter((n) => schema.byName[n]);
    return names.map((n) => schema.byName[n]!);
  }, [schema, columnsState, defaultColumns]);

  const items = useAsync(() => services.store.items.query(buildQuery(schema, search, filters, sort)), [services, schema, search, filters, sort, version]);
  const total = useAsync(() => services.store.items.count(), [services, version]);
  const people = useAsync(() => services.store.people.all(), [services, version]);

  // search/quick filters (SQL) → conditions → column filters → column sort
  const afterConditions = useMemo(() => {
    const list = items.data ?? [];
    if (!schema || !ctx || !activeConditionCount(conditions, schema)) return list;
    return list.filter((i) => matchesConditions(i.fields, conditions, schema, ctx));
  }, [items.data, schema, ctx, conditions]);

  const visible = useMemo(() => {
    if (!schema || !ctx) return afterConditions;
    const filtered = applyColumnFilters(afterConditions, colFilters, schema, ctx);
    return colSort ? sortByColumn(filtered, colSort, schema, ctx) : filtered;
  }, [afterConditions, colFilters, colSort, schema, ctx]);

  const groups = useMemo(
    () => (view === 'folders' && schema && ctx ? groupByFolder(visible, schema, ctx, sort === 'folder' && !colSort) : []),
    [view, visible, schema, ctx, sort, colSort],
  );

  const shownRows = useMemo(() => (serialDesc ? [...visible].reverse() : visible), [visible, serialDesc]);
  const shownGroups = useMemo(() => (serialDesc ? [...groups].reverse() : groups), [groups, serialDesc]);
  const serialOf = (index: number, n: number) => (serialDesc ? n - index : index + 1);

  const filterDef = filterFor && schema ? schema.byName[filterFor] : undefined;
  const filterValues = useMemo(() => {
    if (!filterDef || !schema || !ctx) return [];
    return distinctValues(applyColumnFilters(afterConditions, colFilters, schema, ctx, filterDef.name), filterDef, ctx);
  }, [filterDef, afterConditions, colFilters, schema, ctx]);

  const filterOptions = useAsync(async () => {
    const out: Partial<Record<SemanticKey, PickerOption[]>> = {};
    if (!schema || !ctx) return out;
    for (const k of FILTER_KEYS) {
      const def = schema.bySemantic[k];
      if (!def) continue;
      const values = await services.store.items.distinctValues(fieldKey(def));
      const known = def.kind === 'choice' ? [...new Set([...def.choices, ...values])] : values;
      out[k] = [
        { value: '', label: '(blank)' },
        ...known.map((v) => ({
          value: v,
          label: def.kind === 'person' ? (ctx.people[v] ?? `User #${v}`) : v,
        })),
      ];
    }
    return out;
  }, [services, schema, ctx, version]);

  const onRefresh = async () => {
    setRefreshing(true);
    try {
      await services.runCycle('manual');
    } finally {
      setRefreshing(false);
    }
  };

  const toggle = (key: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const openAdvanced = (field: string) => {
    const def = schema?.byName[field];
    if (!def) return;
    setConditionsSeed({
      ...conditions,
      conditions: [...conditions.conditions, { id: `c${Date.now()}`, field, op: opsFor(def.kind)[0]!.op, value: '' }],
    });
    setPicker('conditions');
  };

  const clearAll = () => {
    setFilters({});
    setConditions(EMPTY_CONDITIONS);
    setColFiltersState({});
    persist(KEYS.colFilters, {});
    setColSort(null);
  };

  const activeFilters = Object.values(filters).reduce((n, v) => n + (v?.length ? 1 : 0), 0);
  const conditionCount = activeConditionCount(conditions, schema);
  const colFilterCount = activeColumnFilterCount(colFilters);
  const openItem = (localId: string) => router.push({ pathname: '/po/[id]', params: { id: localId } });
  const emptyList = items.loading ? undefined : <EmptyState title="No matching POs" message="Try a different search or clear the filters." />;
  const headerCtx: HeaderCtx = {
    colFilters,
    colSort,
    openFilter: setFilterFor,
    serialDesc,
    toggleSerial,
  };

  const countText =
    view === 'folders'
      ? `${groups.length} folder${groups.length === 1 ? '' : 's'} · ${visible.length} line${visible.length === 1 ? '' : 's'} of ${total.data ?? 0}`
      : `${visible.length} of ${total.data ?? 0} PO lines`;

  const header = (
    <View style={{ padding: spacing.lg, paddingBottom: spacing.sm }}>
      {!status.online ? <Banner tone="warning" text="Offline. Showing saved data; changes will sync when you reconnect." /> : null}
      {status.conflicts ? (
        <Banner
          tone="danger"
          text={`${status.conflicts} change${status.conflicts === 1 ? '' : 's'} conflict with SharePoint.`}
          action={<Button compact kind="ghost" title="Resolve" onPress={() => router.push('/sync')} />}
        />
      ) : null}
      <View style={[s.search, { backgroundColor: t.inputBg, borderColor: t.border }]}>
        <Ionicons name="search" size={18} color={t.muted} />
        <TextInput
          value={search}
          onChangeText={setSearch}
          placeholder="Folder #, customer, PO #, product, invoice #"
          placeholderTextColor={t.muted}
          accessibilityLabel="Search purchase orders"
          autoCorrect={false}
          autoCapitalize="none"
          clearButtonMode="while-editing"
          style={{
            flex: 1,
            color: t.text,
            fontSize: 15,
            minHeight: 42,
            marginLeft: spacing.sm,
          }}
        />
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginTop: spacing.md }}>
        <Chip label="Columns" onPress={() => setPicker('columns')} />
        <Chip
          label={conditionCount ? `Conditions (${conditionCount})` : 'Conditions +'}
          active={conditionCount > 0}
          onPress={() => {
            setConditionsSeed(null);
            setPicker('conditions');
          }}
        />
        {FILTER_KEYS.filter((k) => schema?.bySemantic[k]).map((k) => {
          const n = filters[k]?.length ?? 0;
          return <Chip key={k} label={`${FILTER_LABELS[k] ?? k}${n ? ` (${n})` : ''}`} active={n > 0} onPress={() => setPicker(k)} />;
        })}
        <Chip
          label={`Sort: ${colSort && schema?.byName[colSort.field] ? `${schema.byName[colSort.field]!.label} ${colSort.dir === 'asc' ? '↑' : '↓'}` : SORTS.find((x) => x.key === sort)?.label}`}
          onPress={() => setPicker('sort')}
        />
        {activeFilters || conditionCount || colFilterCount || colSort ? <Chip label="Clear all" onPress={clearAll} /> : null}
      </ScrollView>

      {colFilterCount && schema ? (
        <View
          style={{
            flexDirection: 'row',
            flexWrap: 'wrap',
            rowGap: 6,
            marginTop: spacing.sm,
          }}
        >
          {Object.entries(colFilters)
            .filter(([f, v]) => v.length && schema.byName[f])
            .map(([f, v]) => (
              <Chip
                key={f}
                active
                label={`${schema.byName[f]!.label}: ${v.length === 1 ? v[0] || '(Blank)' : `${v.length} values`}  ✕`}
                onPress={() => setColFilter(f, [])}
              />
            ))}
        </View>
      ) : null}
      {conditionCount && schema && ctx ? (
        <Pressable
          accessibilityRole="button"
          onPress={() => {
            setConditionsSeed(null);
            setPicker('conditions');
          }}
          style={{ marginTop: spacing.sm }}
        >
          <Txt size={12} color={t.primary}>
            {describeConditions(conditions, schema, ctx)}
          </Txt>
        </Pressable>
      ) : null}

      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          marginTop: spacing.sm,
          flexWrap: 'wrap',
          rowGap: spacing.sm,
        }}
      >
        <Txt muted size={12} style={{ flex: 1, minWidth: 160 }} accessibilityLiveRegion="polite">
          {items.data ? countText : ''}
          {status.syncing ? ' · Syncing…' : ''}
        </Txt>
        <Chip label="Folders" active={view === 'folders'} onPress={() => setView('folders')} />
        <Chip label="Cards" active={view === 'cards'} onPress={() => setView('cards')} />
        <Chip label="Table" active={view === 'table'} onPress={() => setView('table')} />
      </View>
      {view !== 'cards' ? (
        <Txt muted size={11} style={{ marginTop: 6 }}>
          Tap a column heading to sort or filter it.
        </Txt>
      ) : null}
      {view === 'folders' && groups.length ? (
        <View
          style={{
            flexDirection: 'row',
            marginTop: spacing.sm,
            gap: spacing.md,
          }}
        >
          <Pressable accessibilityRole="button" onPress={() => setExpanded(new Set(groups.map((g) => g.key)))}>
            <Txt size={12} color={t.primary}>
              Expand all
            </Txt>
          </Pressable>
          <Pressable accessibilityRole="button" onPress={() => setExpanded(new Set())}>
            <Txt size={12} color={t.primary}>
              Collapse all
            </Txt>
          </Pressable>
        </View>
      ) : null}
    </View>
  );

  let body;
  if (schemaState.loading && !schemaState.data) body = <LoadingState />;
  else if (items.error) body = <ErrorState message={items.error.message} onRetry={items.reload} />;
  else if (!schema && !total.data) {
    body = (
      <EmptyState
        title={status.syncing ? 'Loading POs from SharePoint…' : 'No data yet'}
        message={
          status.lastError ?? (status.online ? 'The first sync downloads all POs. This can take a moment.' : 'Connect to the internet for the first sync.')
        }
        action={!status.syncing ? <Button title="Sync now" onPress={onRefresh} /> : null}
      />
    );
  }

  const refresh = <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={t.primary} />;
  const listStyle = {
    paddingBottom: 96,
    maxWidth: 1100,
    width: '100%' as const,
    alignSelf: 'center' as const,
  };

  let content = body;
  if (!content && schema && ctx) {
    if (view === 'table') {
      const tableCols: TableColumn[] = columnDefs.map((d) => ({ def: d, width: editCellWidth({ def: d, width: columnWidth(d) }) }));
      const tableWidth = ROW_SERIAL_W + ROW_LINK_W + ROW_ACTIONS_W + tableCols.reduce((n, c) => n + c.width, 0) + 2 * spacing.md + 2 * spacing.lg;
      content = (
        <View style={{ flex: 1 }}>
          <View style={{ maxWidth: 1100, width: '100%', alignSelf: 'center' }}>{header}</View>
          <ScrollView horizontal contentContainerStyle={{ flexGrow: 1, justifyContent: 'center' }} style={{ flex: 1 }}>
            <View
              style={{
                width: tableWidth,
                flex: 1,
                paddingHorizontal: spacing.lg,
              }}
            >
              <View style={[s.tr, s.th, { backgroundColor: t.chip, borderColor: t.border }]} accessibilityRole="header">
                <SerialHeader label="S.No" width={ROW_SERIAL_W} hc={headerCtx} />
                <Txt size={12} weight="700" muted style={{ width: ROW_LINK_W }}>
                  Folder link
                </Txt>
                {columnDefs.map((d) => (
                  <HeaderCell key={d.name} def={d} label={d.label} width={tableCols.find((c) => c.def === d)?.width ?? columnWidth(d)} hc={headerCtx} />
                ))}
                <Txt size={12} weight="700" muted style={{ width: ROW_ACTIONS_W }}>
                  Edit
                </Txt>
              </View>
              <FlatList
                data={shownRows}
                keyExtractor={(i) => i.localId}
                refreshControl={refresh}
                renderItem={({ item, index }) => (
                  <EditableRow
                    item={item}
                    serial={serialOf(index, shownRows.length)}
                    columns={tableCols}
                    schema={schema}
                    ctx={ctx}
                    people={people.data ?? []}
                    folderLinkDef={schema.bySemantic.folder}
                    onOpen={() => openItem(item.localId)}
                    onSave={async (patch) => {
                      await services.engine.updateItem(item.localId, patch);
                      afterLocalChange(services);
                    }}
                  />
                )}
                ListEmptyComponent={emptyList}
                contentContainerStyle={{ paddingBottom: 96 }}
                initialNumToRender={30}
                windowSize={11}
              />
            </View>
          </ScrollView>
        </View>
      );
    } else if (view === 'folders') {
      const lineColumns = columnDefs.filter((d) => d.semantic !== 'folder' && d.semantic !== 'customer');
      content = (
        <FlatList
          data={shownGroups}
          keyExtractor={(g) => g.key}
          ListHeaderComponent={
            <>
              {header}
              {groups.length ? <FolderTableHeader schema={schema} hc={headerCtx} /> : null}
            </>
          }
          refreshControl={refresh}
          extraData={[expanded, lineColumns, colFilters, colSort, serialDesc]}
          renderItem={({ item, index }) => (
            <FolderRow
              group={item}
              serial={serialOf(index, shownGroups.length)}
              expanded={expanded.has(item.key)}
              lineColumns={lineColumns}
              ctx={ctx}
              hc={headerCtx}
              onToggle={() => toggle(item.key)}
              onOpenLine={openItem}
            />
          )}
          ListEmptyComponent={emptyList}
          contentContainerStyle={listStyle}
          initialNumToRender={20}
          windowSize={11}
        />
      );
    } else {
      content = (
        <FlatList
          data={shownRows}
          keyExtractor={(i) => i.localId}
          ListHeaderComponent={header}
          refreshControl={refresh}
          renderItem={({ item, index }) => (
            <PORow item={item} serial={serialOf(index, shownRows.length)} schema={schema} ctx={ctx} onPress={() => openItem(item.localId)} />
          )}
          ListEmptyComponent={emptyList}
          contentContainerStyle={{ ...listStyle, maxWidth: 960 }}
          initialNumToRender={20}
          windowSize={11}
        />
      );
    }
  }

  return (
    <View style={{ flex: 1, backgroundColor: t.bg }}>
      {content ?? <LoadingState />}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Add PO"
        onPress={() => router.push('/po/new')}
        style={({ pressed }) => [s.fab, { backgroundColor: t.primary, opacity: pressed ? 0.85 : 1 }]}
      >
        <Ionicons name="add" size={28} color={t.primaryText} />
      </Pressable>

      {filterDef ? (
        <ColumnFilterModal
          def={filterDef}
          values={filterValues}
          selected={colFilters[filterDef.name] ?? []}
          sort={colSort}
          onClose={() => setFilterFor(null)}
          onApply={(v) => setColFilter(filterDef.name, v)}
          onSort={(s2) => {
            setColSort(s2);
            setFilterFor(null);
          }}
          onAdvanced={() => openAdvanced(filterDef.name)}
        />
      ) : null}

      {picker === 'columns' && schema ? (
        <ColumnPickerModal
          visible
          schema={schema}
          value={columnDefs.map((d) => d.name)}
          defaults={defaultColumns}
          onClose={() => setPicker(null)}
          onApply={setColumns}
        />
      ) : picker === 'conditions' && schema && ctx ? (
        <ConditionsModal
          visible
          schema={schema}
          ctx={ctx}
          value={conditionsSeed ?? conditions}
          onClose={() => {
            setPicker(null);
            setConditionsSeed(null);
          }}
          onApply={setConditions}
        />
      ) : picker === 'sort' ? (
        <PickerModal
          visible
          title="Sort by"
          options={SORTS.map((x) => ({ value: x.key, label: x.label }))}
          selected={colSort ? [] : [sort]}
          onClose={() => setPicker(null)}
          onChange={(v) => {
            setColSort(null);
            setSort((v[0] as SortKey) ?? 'modified');
          }}
        />
      ) : picker && picker !== 'columns' && picker !== 'conditions' ? (
        <PickerModal
          visible
          multiple
          title={`Filter: ${FILTER_LABELS[picker] ?? picker}`}
          options={filterOptions.data?.[picker] ?? []}
          selected={filters[picker] ?? []}
          onClose={() => setPicker(null)}
          onChange={(v) => setFilters((f) => ({ ...f, [picker]: v }))}
        />
      ) : null}
    </View>
  );
}

/** S.No heading: tap to switch between ascending (1, 2, 3…) and descending (…3, 2, 1). */
function SerialHeader({ label, width, hc }: { label: string; width: number; hc: HeaderCtx }) {
  const t = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Serial number, ${hc.serialDesc ? 'descending' : 'ascending'}. Tap to reverse`}
      onPress={hc.toggleSerial}
      style={({ pressed }) => ({
        width,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 2,
        opacity: pressed ? 0.6 : 1,
      })}
    >
      <Txt size={12} weight="700" color={hc.serialDesc ? t.primary : t.muted} numberOfLines={1}>
        {label}
      </Txt>
      <Ionicons name={hc.serialDesc ? 'arrow-down' : 'arrow-up'} size={12} color={hc.serialDesc ? t.primary : t.muted} />
    </Pressable>
  );
}

/** A tappable column heading: shows filter and sort state; opens the column filter. */
function HeaderCell({
  def,
  label,
  width,
  flex,
  hc,
  small,
}: {
  def: FieldDef | undefined;
  label: string;
  width?: number;
  flex?: number;
  hc: HeaderCtx;
  small?: boolean;
}) {
  const t = useTheme();
  const size = small ? 11 : 12;
  const style = { width, flex, paddingRight: spacing.sm };
  if (!def) {
    return (
      <Txt size={size} weight="700" muted style={style} numberOfLines={1}>
        {label}
      </Txt>
    );
  }
  const filtered = (hc.colFilters[def.name]?.length ?? 0) > 0;
  const sorted = hc.colSort?.field === def.name ? hc.colSort.dir : null;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${label} column${filtered ? ', filtered' : ''}${sorted ? `, sorted ${sorted === 'asc' ? 'ascending' : 'descending'}` : ''}. Sort or filter`}
      onPress={() => hc.openFilter(def.name)}
      style={({ pressed }) => [
        style,
        {
          flexDirection: 'row',
          alignItems: 'center',
          gap: 3,
          opacity: pressed ? 0.6 : 1,
        },
      ]}
    >
      <Txt size={size} weight="700" color={filtered || sorted ? t.primary : t.muted} numberOfLines={1} style={{ flexShrink: 1 }}>
        {label}
      </Txt>
      {sorted ? <Ionicons name={sorted === 'asc' ? 'arrow-up' : 'arrow-down'} size={12} color={t.primary} /> : null}
      <Ionicons name={filtered ? 'funnel' : 'funnel-outline'} size={11} color={filtered ? t.primary : t.muted} />
    </Pressable>
  );
}

/** Column widths for the Folders view. */
const COL = {
  serial: 44,
  folder: 96,
  link: 44,
  lines: 52,
  status: 150,
  statusNarrow: 104,
  chevron: 24,
};

function FolderTableHeader({ schema, hc }: { schema: Schema; hc: HeaderCtx }) {
  const t = useTheme();
  const { width } = useWindowDimensions();
  const wide = width >= 640;
  return (
    <View style={[s.folderHead, { backgroundColor: t.chip, borderColor: t.border }]} accessibilityRole="header">
      <SerialHeader label={wide ? 'S.No' : '#'} width={wide ? COL.serial : 32} hc={hc} />
      {wide ? (
        <>
          <HeaderCell def={schema.bySemantic.folder} label="Folder #" width={COL.folder} hc={hc} />
          <Txt size={12} weight="700" muted style={{ width: COL.link }}>
            Link
          </Txt>
          <HeaderCell def={schema.bySemantic.customer} label="Customer name" flex={1} hc={hc} />
          <Txt size={12} weight="700" muted style={{ width: COL.lines, textAlign: 'center' }}>
            Lines
          </Txt>
        </>
      ) : (
        <View style={{ flex: 1, flexDirection: 'row', gap: spacing.sm }}>
          <HeaderCell def={schema.bySemantic.folder} label="Folder #" hc={hc} />
          <HeaderCell def={schema.bySemantic.customer} label="Customer" hc={hc} />
        </View>
      )}
      <HeaderCell def={schema.bySemantic.status} label="Status" width={wide ? COL.status : COL.statusNarrow} hc={hc} />
      <View style={{ width: COL.chevron }} />
    </View>
  );
}

/** One Folder #: folder and customer on the row; its lines inside, with the chosen columns. */
const FolderRow = memo(function FolderRow({
  group,
  serial,
  expanded,
  lineColumns,
  ctx,
  hc,
  onToggle,
  onOpenLine,
}: {
  group: FolderGroup;
  serial: number;
  expanded: boolean;
  lineColumns: FieldDef[];
  ctx: ValueContext;
  hc?: HeaderCtx;
  onToggle: () => void;
  onOpenLine: (localId: string) => void;
}) {
  const t = useTheme();
  const { width } = useWindowDimensions();
  const wide = width >= 640;
  const title = group.folder || '—';
  const lineCount = group.lines.length;

  return (
    <View
      style={[
        s.folderRow,
        {
          backgroundColor: t.card,
          borderColor: expanded ? t.primary : t.border,
        },
      ]}
    >
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded }}
        accessibilityLabel={`Number ${serial}, Folder ${title}, ${group.customer || 'no customer'}, ${lineCount} line${lineCount === 1 ? '' : 's'}${group.dirty ? ', has unsynced changes' : ''}`}
        accessibilityHint={expanded ? 'Hides the lines' : 'Shows the lines in this folder'}
        onPress={onToggle}
        style={({ pressed }) => [s.fr, { opacity: pressed ? 0.7 : 1 }]}
      >
        <Txt size={13} muted style={{ width: wide ? COL.serial : 32 }}>
          {serial}
        </Txt>
        {wide ? (
          <>
            <Txt size={15} weight="700" style={{ width: COL.folder }} numberOfLines={1}>
              {title}
            </Txt>
            <View style={{ width: COL.link }}>
              <FolderLink folder={group.folder} />
            </View>
            <Txt size={14} style={{ flex: 1, paddingRight: spacing.sm }} numberOfLines={1} color={group.customer ? t.text : t.muted}>
              {group.customer || 'No customer'}
            </Txt>
            <Txt size={13} muted style={{ width: COL.lines, textAlign: 'center' }}>
              {lineCount}
            </Txt>
          </>
        ) : (
          // Phone width: folder # over customer name, so neither gets cut off.
          <View style={{ flex: 1, paddingRight: spacing.sm, paddingVertical: 6 }}>
            <View
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: spacing.sm,
              }}
            >
              <Txt size={15} weight="700" numberOfLines={1} style={{ flexShrink: 1 }}>
                {title}
                <Txt size={12} muted>{`  · ${lineCount} line${lineCount === 1 ? '' : 's'}`}</Txt>
              </Txt>
              <FolderLink folder={group.folder} size={17} />
            </View>
            <Txt size={13} numberOfLines={2} color={group.customer ? t.text : t.muted}>
              {group.customer || 'No customer'}
            </Txt>
          </View>
        )}
        <View
          style={{
            width: wide ? COL.status : COL.statusNarrow,
            flexDirection: 'row',
            flexWrap: 'wrap',
            gap: 4,
          }}
        >
          {group.dirty ? <Badge label="Not synced" tone="warning" /> : null}
          {group.statuses.length === 1 ? <StatusPill status={group.statuses[0]!} /> : null}
          {group.statuses.length > 1 ? <Badge label={`${group.statuses.length} statuses`} /> : null}
        </View>
        <Ionicons name={expanded ? 'chevron-up' : 'chevron-down'} size={18} color={t.muted} style={{ width: COL.chevron }} />
      </Pressable>

      {expanded ? (
        <View
          style={{
            marginLeft: wide ? COL.serial : 0,
            marginRight: spacing.sm,
            marginBottom: spacing.md,
            gap: spacing.sm,
          }}
        >
          {group.lines.map((item) => (
            <LineCard key={item.localId} item={item} lineColumns={lineColumns} ctx={ctx} onOpen={() => onOpenLine(item.localId)} />
          ))}
        </View>
      ) : null}
    </View>
  );
});

/**
 * One PO line inside an opened folder, as a compact card:
 *   [Line 2]  Product name (wraps)                       [Status] ›
 *             Remarks on status · Remarks
 *             PO 123 · Account manager Alex · Received 20 Nov …  (other chosen columns)
 */
function LineCard({ item, lineColumns, ctx, onOpen }: { item: LocalItem; lineColumns: FieldDef[]; ctx: ValueContext; onOpen: () => void }) {
  const t = useTheme();
  const bySem = (k: SemanticKey) => lineColumns.find((d) => d.semantic === k);
  const val = (d: FieldDef | undefined) => (d ? displayValue(item.fields, d, ctx) : '');
  const lineDef = bySem('line');
  const productDef = bySem('product');
  const statusDef = bySem('status');
  const remarkDefs = lineColumns.filter((d) => d.semantic === 'remarksOnStatus' || d.semantic === 'remarks');
  const shownSeparately = new Set([lineDef, productDef, statusDef, ...remarkDefs].filter(Boolean).map((d) => d!.name));
  const details = lineColumns
    .filter((d) => !shownSeparately.has(d.name))
    .map((d) => ({ d, v: val(d) }))
    .filter((x) => x.v);
  const remarks = remarkDefs.map((d) => ({ d, v: val(d) })).filter((x) => x.v);
  const line = val(lineDef);
  const product = val(productDef);
  const st = val(statusDef);

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={[
        line && `Line ${line}`,
        product,
        st,
        ...remarks.map((r) => `${r.d.label} ${r.v}`),
        ...details.map((x) => `${x.d.label} ${x.v}`),
        item.dirty ? 'not synced' : '',
        'Open',
      ]
        .filter(Boolean)
        .join(', ')}
      onPress={onOpen}
      style={({ pressed }) => [s.lineCard, { borderColor: t.border, backgroundColor: pressed ? t.chip : t.bg }]}
    >
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'flex-start',
          gap: spacing.sm,
        }}
      >
        {lineDef ? (
          <View style={[s.linePill, { backgroundColor: t.chipActive }]}>
            <Txt size={11} weight="800" color={t.primary}>
              LINE {line || '—'}
            </Txt>
          </View>
        ) : null}
        <Txt size={14} weight="600" style={{ flex: 1 }}>
          {productDef ? product || 'No product name' : ''}
        </Txt>
        {item.dirty ? <Badge label="Not synced" tone="warning" /> : null}
        {st ? <StatusPill status={st} /> : null}
        <Ionicons name="chevron-forward" size={16} color={t.muted} />
      </View>
      {remarks.length ? (
        <View style={{ marginTop: 6, gap: 2 }}>
          {remarks.map(({ d, v }) => (
            <Txt key={d.name} size={13} color={t.warning}>
              <Txt size={12} weight="700" color={t.muted}>
                {d.label}:{' '}
              </Txt>
              {v}
            </Txt>
          ))}
        </View>
      ) : null}
      {details.length ? (
        <View
          style={{
            flexDirection: 'row',
            flexWrap: 'wrap',
            columnGap: spacing.lg,
            rowGap: 2,
            marginTop: 6,
          }}
        >
          {details.map(({ d, v }) => (
            <Txt key={d.name} size={12}>
              <Txt size={12} color={t.muted}>
                {d.label}{' '}
              </Txt>
              {v}
            </Txt>
          ))}
        </View>
      ) : null}
    </Pressable>
  );
}

const PORow = memo(function PORow({
  item,
  serial,
  schema,
  ctx,
  onPress,
}: {
  item: LocalItem;
  serial: number;
  schema: Schema;
  ctx: ValueContext;
  onPress: () => void;
}) {
  const t = useTheme();
  const v = (k: SemanticKey) => {
    const def = schema.bySemantic[k];
    return def ? displayValue(item.fields, def, ctx) : '';
  };
  const folder = v('folder');
  const statusText = v('status');
  const title = folder ? `Folder ${folder}` : item.spId ? `Item ${item.spId}` : 'New PO';
  const line = v('line');
  const sub = [v('customer'), v('product')].filter(Boolean).join(' · ');
  const meta = [v('customerPo') && `PO ${v('customerPo')}`, v('invoice') && `Inv ${v('invoice')}`, v('accountManager')].filter(Boolean).join(' · ');
  const remark = [v('remarksOnStatus'), v('remarks')].filter(Boolean).join(' · ');

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={[`Number ${serial}`, title, line && `line ${line}`, statusText, sub, item.dirty ? 'not synced' : ''].filter(Boolean).join(', ')}
      onPress={onPress}
      style={({ pressed }) => [s.row, { backgroundColor: pressed ? t.chip : t.card, borderColor: t.border }]}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
        <View style={[s.serial, { backgroundColor: t.chip }]}>
          <Txt size={12} weight="700" muted>
            {serial}
          </Txt>
        </View>
        <Txt weight="700" size={16} style={{ flexShrink: 1 }} numberOfLines={1}>
          {title}
          {line ? <Txt muted size={13}>{`  · line ${line}`}</Txt> : null}
        </Txt>
        <View style={{ flex: 1 }} />
        {item.dirty ? <Badge label="Not synced" tone="warning" /> : null}
        {statusText ? <StatusPill status={statusText} /> : null}
      </View>
      {sub ? (
        <Txt size={14} style={{ marginTop: 4 }} numberOfLines={1}>
          {sub}
        </Txt>
      ) : null}
      {remark ? (
        <Txt size={13} color={t.warning} style={{ marginTop: 4 }} numberOfLines={2}>
          {remark}
        </Txt>
      ) : null}
      {meta ? (
        <Txt muted size={12} style={{ marginTop: 2 }} numberOfLines={1}>
          {meta}
        </Txt>
      ) : null}
    </Pressable>
  );
});

const s = StyleSheet.create({
  serial: {
    minWidth: 28,
    height: 24,
    borderRadius: 12,
    paddingHorizontal: 6,
    alignItems: 'center',
    justifyContent: 'center',
  },
  search: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: spacing.md,
  },
  row: {
    marginHorizontal: spacing.lg,
    marginBottom: spacing.sm,
    padding: spacing.md,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
  },
  line: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    paddingHorizontal: spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  folderHead: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: spacing.lg,
    paddingHorizontal: spacing.md,
    minHeight: 38,
    borderTopLeftRadius: 10,
    borderTopRightRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
  },
  folderRow: {
    marginHorizontal: spacing.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderTopWidth: 0,
  },
  fr: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 52,
    paddingHorizontal: spacing.md,
  },
  lineCard: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 10,
    padding: spacing.md,
  },
  linePill: {
    borderRadius: 6,
    paddingHorizontal: 6,
    paddingVertical: 3,
    marginTop: 1,
  },
  tr: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 44,
    paddingHorizontal: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  th: {
    minHeight: 38,
    borderTopLeftRadius: 8,
    borderTopRightRadius: 8,
    borderBottomWidth: 1,
  },
  fab: {
    position: 'absolute',
    right: spacing.xl,
    bottom: spacing.xl,
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 4,
    shadowColor: '#000',
    shadowOpacity: 0.2,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 3 },
  },
});

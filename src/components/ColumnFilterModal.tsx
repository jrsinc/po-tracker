import { useMemo, useState } from 'react';
import { FlatList, Modal, Pressable, StyleSheet, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { FieldDef } from '../schema/columnMapper';
import { BLANK, type ColumnSort, type ValueCount } from '../schema/columnFilters';
import { spacing, useTheme } from './theme';
import { Button, Chip, Txt } from './ui';

/**
 * Excel-style filter for one column: sort, search, tick the values to show.
 * `values` are the column's distinct values among rows that pass the other filters.
 */
export function ColumnFilterModal({
  def,
  values,
  selected,
  sort,
  onClose,
  onApply,
  onSort,
  onAdvanced,
}: {
  def: FieldDef;
  values: ValueCount[];
  /** Currently selected values ([] = no filter, everything shown). */
  selected: string[];
  sort: ColumnSort | null;
  onClose: () => void;
  onApply: (values: string[]) => void;
  onSort: (sort: ColumnSort | null) => void;
  onAdvanced: () => void;
}) {
  const t = useTheme();
  const all = useMemo(() => values.map((v) => v.value), [values]);
  const [picked, setPicked] = useState<Set<string>>(new Set(selected.length ? selected : all));
  const [query, setQuery] = useState('');

  const q = query.trim().toLowerCase();
  const shown = q ? values.filter((v) => (v.value || '(blank)').toLowerCase().includes(q)) : values;
  const allPicked = picked.size === all.length;
  const sortedThis = sort?.field === def.name ? sort.dir : null;

  const toggle = (v: string) =>
    setPicked((p) => {
      const next = new Set(p);
      if (next.has(v)) next.delete(v);
      else next.add(v);
      return next;
    });

  const apply = () => {
    // Everything ticked = no filter on this column.
    onApply(picked.size === all.length ? [] : [...picked]);
    onClose();
  };

  return (
    <Modal visible animationType="slide" onRequestClose={onClose}>
      <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }}>
        <View style={[s.header, { borderBottomColor: t.border, backgroundColor: t.card }]}>
          <Txt size={17} weight="700" style={{ flex: 1 }} numberOfLines={1} accessibilityRole="header">
            {def.label}
          </Txt>
          <Button compact kind="ghost" title="Cancel" onPress={onClose} />
          <Button compact title="Apply" onPress={apply} />
        </View>

        <View style={{ padding: spacing.lg, paddingBottom: 0, maxWidth: 640, width: '100%', alignSelf: 'center' }}>
          <Txt size={12} weight="700" muted style={{ marginBottom: 6 }}>
            SORT
          </Txt>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', rowGap: spacing.sm, marginBottom: spacing.md }}>
            <Chip label="A → Z / smallest first" active={sortedThis === 'asc'} onPress={() => onSort({ field: def.name, dir: 'asc' })} />
            <Chip label="Z → A / largest first" active={sortedThis === 'desc'} onPress={() => onSort({ field: def.name, dir: 'desc' })} />
            {sortedThis ? <Chip label="No sort" onPress={() => onSort(null)} /> : null}
          </View>

          <Txt size={12} weight="700" muted style={{ marginBottom: 6 }}>
            FILTER
          </Txt>
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder="Search values"
            placeholderTextColor={t.muted}
            accessibilityLabel={`Search ${def.label} values`}
            autoCorrect={false}
            style={[s.search, { color: t.text, borderColor: t.border, backgroundColor: t.inputBg }]}
          />
          <View style={{ flexDirection: 'row', gap: spacing.md, marginVertical: spacing.sm, alignItems: 'center' }}>
            <Pressable accessibilityRole="button" onPress={() => setPicked(allPicked ? new Set() : new Set(all))}>
              <Txt size={13} color={t.primary}>
                {allPicked ? 'Clear all' : 'Select all'}
              </Txt>
            </Pressable>
            {q ? (
              <Pressable accessibilityRole="button" onPress={() => setPicked(new Set(shown.map((v) => v.value)))}>
                <Txt size={13} color={t.primary}>
                  Only these results
                </Txt>
              </Pressable>
            ) : null}
            <View style={{ flex: 1 }} />
            <Pressable
              accessibilityRole="button"
              onPress={() => {
                onClose();
                onAdvanced();
              }}
            >
              <Txt size={13} color={t.primary}>
                Advanced condition…
              </Txt>
            </Pressable>
          </View>
          <Txt muted size={12}>
            {picked.size} of {all.length} values selected
          </Txt>
        </View>

        <FlatList
          data={shown}
          keyExtractor={(v) => v.value || '__blank__'}
          style={{ flex: 1 }}
          contentContainerStyle={{ paddingHorizontal: spacing.lg, paddingBottom: spacing.xl, maxWidth: 640, width: '100%', alignSelf: 'center' }}
          keyboardShouldPersistTaps="handled"
          ListEmptyComponent={
            <Txt muted style={{ padding: spacing.lg }}>
              No values match.
            </Txt>
          }
          renderItem={({ item }) => {
            const on = picked.has(item.value);
            return (
              <Pressable
                accessibilityRole="checkbox"
                accessibilityState={{ checked: on }}
                accessibilityLabel={`${item.value || 'Blank'}, ${item.count} rows`}
                onPress={() => toggle(item.value)}
                style={({ pressed }) => [s.row, { borderBottomColor: t.border, backgroundColor: pressed ? t.chip : 'transparent' }]}
              >
                <View style={[s.box, { borderColor: on ? t.primary : t.border, backgroundColor: on ? t.primary : 'transparent' }]}>
                  {on ? <Txt size={12} weight="800" color={t.primaryText}>✓</Txt> : null}
                </View>
                <Txt style={{ flex: 1 }} numberOfLines={2} color={item.value === BLANK ? t.muted : t.text}>
                  {item.value || '(Blank)'}
                </Txt>
                <Txt muted size={12}>
                  {item.count}
                </Txt>
              </Pressable>
            );
          }}
        />
      </SafeAreaView>
    </Modal>
  );
}

const s = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, padding: spacing.lg, borderBottomWidth: StyleSheet.hairlineWidth },
  search: { borderWidth: 1, borderRadius: 10, minHeight: 44, paddingHorizontal: 12, fontSize: 15 },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, minHeight: 46, borderBottomWidth: StyleSheet.hairlineWidth },
  box: { width: 22, height: 22, borderRadius: 5, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
});

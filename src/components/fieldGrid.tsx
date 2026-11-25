import { Ionicons } from '@expo/vector-icons';
import type { ReactNode } from 'react';
import { StyleSheet, useWindowDimensions, View } from 'react-native';
import type { Person } from '../db/repositories/misc';
import type { FieldValues } from '../graph/types';
import type { FieldDef } from '../schema/columnMapper';
import { displayValue, type FormValue, type FormValues, type ValidationErrors, type ValueContext } from '../schema/values';
import { FieldInput } from './FieldInput';
import { dateColor, groupStyle, statusSwatch } from './palette';
import { spacing, useTheme } from './theme';
import { Txt } from './ui';

/** Filled, coloured status pill (Active blue, Completed green, Cancelled red …). */
export function StatusPill({ status, large }: { status: string; large?: boolean }) {
  const t = useTheme();
  if (!status) return null;
  const c = statusSwatch(status, t);
  return (
    <View
      style={[s.pill, { backgroundColor: c.bg, paddingVertical: large ? 5 : 3, paddingHorizontal: large ? 12 : 9 }]}
      accessible
      accessibilityLabel={`Status ${status}`}
    >
      <View style={[s.dot, { backgroundColor: c.fg }]} />
      <Txt size={large ? 14 : 12} weight="700" color={c.fg}>
        {status}
      </Txt>
    </View>
  );
}

/** A section with a coloured title band. */
export function Section({ groupKey, title, right, children }: { groupKey: string; title: string; right?: ReactNode; children: ReactNode }) {
  const t = useTheme();
  const g = groupStyle(groupKey, t);
  return (
    <View style={[s.section, { borderColor: t.border, backgroundColor: t.card }]}>
      <View style={[s.band, { backgroundColor: g.band }]} accessibilityRole="header">
        <Ionicons name={g.icon} size={16} color="#FFFFFF" />
        <Txt size={13} weight="700" color="#FFFFFF" style={{ flex: 1, letterSpacing: 0.4 }}>
          {title.toUpperCase()}
        </Txt>
        {right}
      </View>
      {children}
    </View>
  );
}

/** Two-column grid of label-over-value cells. Long text spans both columns. */
export function FieldGrid({ fields, values, ctx }: { fields: FieldDef[]; values: FieldValues; ctx: ValueContext }) {
  const t = useTheme();
  return (
    <View style={s.grid}>
      {fields.map((f) => {
        const value = displayValue(values, f, ctx);
        const wide = f.kind === 'note' || value.length > 48;
        return (
          <View
            key={f.name}
            style={[s.cell, { width: wide ? '100%' : '50%', borderColor: t.border }]}
            accessible
            accessibilityLabel={`${f.label}: ${value || 'empty'}`}
          >
            <Txt size={11} weight="600" muted numberOfLines={1}>
              {f.label}
            </Txt>
            <FieldValueText def={f} value={value} />
          </View>
        );
      })}
    </View>
  );
}

/**
 * One table for all sections:  Section (merged cell, coloured) | Field | Value.
 * The section cell spans all of its field rows, like a merged cell in Excel.
 */
export function GroupTable({
  groups,
  values,
  ctx,
  edit,
}: {
  groups: { key: string; title: string; fields: FieldDef[] }[];
  values: FieldValues;
  ctx: ValueContext;
  /** When set, editable value cells become inputs (same table, same layout). */
  edit?: { values: FormValues; errors: ValidationErrors; people: Person[]; onChange: (name: string, v: FormValue) => void };
}) {
  const t = useTheme();
  const { width } = useWindowDimensions();
  const narrow = width < 560;
  const groupW = narrow ? 84 : 150;
  const labelW = narrow ? '42%' : '38%';
  return (
    <View style={[s.table, { borderColor: t.border, backgroundColor: t.card }]} accessibilityRole="list">
      <View style={[s.tRow, { backgroundColor: t.chip, borderColor: t.border }]} accessibilityRole="header">
        <Txt size={12} weight="800" muted style={[s.th, { width: groupW, borderColor: t.border }]}>
          SECTION
        </Txt>
        <View style={{ flex: 1, flexDirection: 'row' }}>
          <Txt size={12} weight="800" muted style={[s.th, { width: labelW, borderColor: t.border }]}>
            FIELD
          </Txt>
          <Txt size={12} weight="800" muted style={[s.th, { flex: 1, borderRightWidth: 0 }]}>
            VALUE
          </Txt>
        </View>
      </View>
      {groups.map((g, gi) => {
        const st = groupStyle(g.key, t);
        return (
          <View key={g.key} style={[s.tRow, { borderColor: t.border, borderTopWidth: gi ? 2 : 0 }]}>
            {/* Merged section cell */}
            <View style={[s.groupCell, { width: groupW, backgroundColor: st.band }]} accessibilityRole="header">
              <Ionicons name={st.icon} size={narrow ? 16 : 18} color="#FFFFFF" />
              <Txt size={narrow ? 11 : 13} weight="800" color="#FFFFFF" style={{ textAlign: 'center', marginTop: 4, letterSpacing: 0.3 }}>
                {g.title.toUpperCase()}
              </Txt>
            </View>
            <View style={{ flex: 1 }}>
              {g.fields.map((f, i) => {
                const value = displayValue(values, f, ctx);
                return (
                  <View
                    key={f.name}
                    style={[s.fRow, { borderColor: t.border, borderTopWidth: i ? StyleSheet.hairlineWidth : 0, backgroundColor: i % 2 ? t.bg : t.card }]}
                    accessible
                    accessibilityLabel={`${g.title}, ${f.label}: ${value || 'empty'}`}
                  >
                    <Txt size={13} weight="600" muted style={[s.label, { width: labelW, borderColor: t.border }]}>
                      {f.label}
                    </Txt>
                    <View style={s.value}>
                      {edit && !f.readOnly ? (
                        <FieldInput
                          compact
                          def={f}
                          value={edit.values[f.name] ?? null}
                          error={edit.errors[f.name]}
                          people={edit.people}
                          onChange={(v) => edit.onChange(f.name, v)}
                        />
                      ) : (
                        <FieldValueText def={f} value={value} />
                      )}
                    </View>
                  </View>
                );
              })}
            </View>
          </View>
        );
      })}
    </View>
  );
}

/** A value styled by its type: status pill, coloured date, Yes/No, or plain text. */
export function FieldValueText({ def, value }: { def: FieldDef; value: string }) {
  const t = useTheme();
  if (!value) {
    return (
      <Txt size={15} color={t.muted} style={{ marginTop: 2 }}>
        —
      </Txt>
    );
  }
  if (def.semantic === 'status') {
    return (
      <View style={{ flexDirection: 'row', marginTop: 3 }}>
        <StatusPill status={value} />
      </View>
    );
  }
  if (def.kind === 'date' || def.kind === 'datetime' || def.semantic === 'expiry') {
    const c = dateColor(t);
    return (
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 2 }}>
        <Ionicons name="calendar-outline" size={14} color={c} />
        <Txt size={15} weight="600" color={c}>
          {value}
        </Txt>
      </View>
    );
  }
  if (def.kind === 'boolean') {
    const yes = value === 'Yes';
    return (
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 2 }}>
        <Ionicons name={yes ? 'checkmark-circle' : 'close-circle-outline'} size={16} color={yes ? t.success : t.muted} />
        <Txt size={15} weight="600" color={yes ? t.success : t.muted}>
          {value}
        </Txt>
      </View>
    );
  }
  return (
    <Txt size={15} weight="500" style={{ marginTop: 2 }}>
      {value}
    </Txt>
  );
}

const s = StyleSheet.create({
  pill: { flexDirection: 'row', alignItems: 'center', gap: 6, borderRadius: 999, alignSelf: 'flex-start' },
  dot: { width: 7, height: 7, borderRadius: 4 },
  section: { borderWidth: StyleSheet.hairlineWidth, borderRadius: 12, overflow: 'hidden', marginBottom: spacing.md },
  band: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.md, paddingVertical: 8 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', paddingHorizontal: spacing.xs, paddingBottom: spacing.xs },
  table: { borderWidth: 1, borderRadius: 12, overflow: 'hidden', marginBottom: spacing.md },
  tRow: { flexDirection: 'row', alignItems: 'stretch' },
  th: { paddingHorizontal: spacing.md, paddingVertical: 8, borderRightWidth: StyleSheet.hairlineWidth, letterSpacing: 0.5 },
  groupCell: { alignItems: 'center', justifyContent: 'center', paddingHorizontal: 6, paddingVertical: spacing.md },
  fRow: { flexDirection: 'row', alignItems: 'stretch', minHeight: 40 },
  label: { paddingHorizontal: spacing.md, paddingVertical: 9, borderRightWidth: StyleSheet.hairlineWidth },
  value: { flex: 1, paddingHorizontal: spacing.md, paddingVertical: 7, justifyContent: 'center' },
  cell: { paddingHorizontal: spacing.sm, paddingVertical: 8, borderBottomWidth: StyleSheet.hairlineWidth },
});

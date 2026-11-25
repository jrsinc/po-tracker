import { Ionicons } from '@expo/vector-icons';
import { memo, useMemo, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import type { LocalItem } from '../db/repositories/items';
import type { Person } from '../db/repositories/misc';
import type { FieldDef, Schema } from '../schema/columnMapper';
import { diffToGraph, displayValue, formFromFields, validateForm, type FormValues, type ValueContext } from '../schema/values';
import { FieldInput } from './FieldInput';
import { FieldValueText, StatusPill } from './fieldGrid';
import { FolderLink } from './FolderLink';
import { spacing, useTheme } from './theme';
import { Button, Txt } from './ui';

export interface TableColumn {
  def: FieldDef;
  width: number;
}

export const ROW_SERIAL_W = 52;
export const ROW_ACTIONS_W = 168;
export const ROW_LINK_W = 64;

/** Column width that also fits the edit control, so the row keeps its layout while editing. */
export function editCellWidth(c: TableColumn): number {
  const min =
    c.def.kind === 'date' || c.def.kind === 'datetime' ? 160 : c.def.kind === 'choice' || c.def.kind === 'person' || c.def.kind === 'multichoice' ? 170 : 110;
  return Math.max(c.width, min);
}

/**
 * One table row. Shows values; "Edit" turns the same row into inputs (no navigation),
 * "Save" queues the change for SharePoint like the edit form does.
 * Folder # and read-only/calculated columns are never editable here.
 */
export const EditableRow = memo(function EditableRow({
  item,
  serial,
  columns,
  schema,
  ctx,
  people,
  folderLinkDef,
  onOpen,
  onSave,
}: {
  item: LocalItem;
  serial: number;
  columns: TableColumn[];
  schema: Schema;
  ctx: ValueContext;
  people: Person[];
  /** When set, a "Folder link" column (icon) is shown after S.No. */
  folderLinkDef?: FieldDef;
  onOpen: () => void;
  onSave: (patch: Record<string, unknown>) => Promise<void>;
}) {
  const t = useTheme();
  const initial = useMemo(() => formFromFields(item.fields, schema, ctx), [item.fields, schema, ctx]);
  const [editing, setEditing] = useState(false);
  const [values, setValues] = useState<FormValues>(initial);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const patch = editing ? diffToGraph(initial, values, schema, ctx) : {};
  const changed = Object.keys(patch).length > 0;
  const canEdit = (d: FieldDef) => !d.readOnly && d.semantic !== 'folder';

  const startEdit = () => {
    setValues(initial);
    setError(null);
    setEditing(true);
  };
  const cancel = () => {
    setEditing(false);
    setError(null);
  };
  const save = async () => {
    if (!changed) return cancel();
    const errs = validateForm(values, schema);
    const relevant = columns.map((c) => errs[c.def.name]).filter(Boolean);
    if (relevant.length) {
      setError(relevant.join(' '));
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await onSave(patch);
      setEditing(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  const bg = editing ? t.chipActive : serial % 2 ? t.card : t.bg;

  return (
    <View style={[s.tr, { borderColor: editing ? t.primary : t.border, backgroundColor: bg, borderWidth: editing ? 1 : 0, borderBottomWidth: editing ? 1 : StyleSheet.hairlineWidth }]}>
      <Txt size={13} muted style={{ width: ROW_SERIAL_W }}>
        {serial}
      </Txt>
      {folderLinkDef ? (
        <View style={{ width: ROW_LINK_W, alignItems: 'flex-start' }}>
          <FolderLink folder={displayValue(item.fields, folderLinkDef, ctx)} />
        </View>
      ) : null}
      {columns.map((c) => {
        const d = c.def;
        const width = c.width;
        if (editing && canEdit(d)) {
          return (
            <View key={d.name} style={[s.cell, { width }]}>
              <FieldInput compact def={d} value={values[d.name] ?? null} people={people} onChange={(nv) => setValues((p) => ({ ...p, [d.name]: nv }))} />
            </View>
          );
        }
        const value = displayValue(item.fields, d, ctx);
        if (d.semantic === 'folder') {
          return (
            <View key={d.name} style={[s.cell, { width, flexDirection: 'row', alignItems: 'center', gap: 6 }]}>
              <Pressable accessibilityRole="link" accessibilityLabel={`Open PO ${value}`} onPress={onOpen} hitSlop={6}>
                <Txt size={14} weight="800" color={t.primary}>
                  {value || '—'}
                </Txt>
              </Pressable>
              {folderLinkDef ? null : <FolderLink folder={value} size={16} />}
            </View>
          );
        }
        if (d.semantic === 'status') {
          return (
            <View key={d.name} style={[s.cell, { width }]}>
              {value ? <StatusPill status={value} /> : <Txt muted>—</Txt>}
            </View>
          );
        }
        if (d.kind === 'date' || d.kind === 'datetime' || d.kind === 'boolean') {
          return (
            <View key={d.name} style={[s.cell, { width }]}>
              <FieldValueText def={d} value={value} />
            </View>
          );
        }
        return (
          <Txt key={d.name} size={13} numberOfLines={2} color={value ? t.text : t.muted} style={[s.cell, { width }]}>
            {value || '—'}
          </Txt>
        );
      })}
      <View style={[s.cell, { width: ROW_ACTIONS_W, flexDirection: 'row', alignItems: 'center', gap: 4, flexWrap: 'wrap' }]}>
        {editing ? (
          <>
            <Button compact title={changed ? 'Save' : 'Done'} loading={saving} onPress={save} />
            <Button compact kind="ghost" title="Cancel" onPress={cancel} />
          </>
        ) : (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Edit line ${serial}`}
            onPress={startEdit}
            hitSlop={6}
            style={({ pressed }) => [s.editBtn, { borderColor: t.border, backgroundColor: pressed ? t.chip : t.card }]}
          >
            <Ionicons name="create-outline" size={15} color={t.primary} />
            <Txt size={13} weight="600" color={t.primary}>
              Edit
            </Txt>
          </Pressable>
        )}
        {item.dirty && !editing ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 3 }} accessible accessibilityLabel="Not synced yet">
            <Ionicons name="cloud-upload-outline" size={14} color={t.warning} />
            <Txt size={11} color={t.warning}>
              Not synced
            </Txt>
          </View>
        ) : null}
        {error ? (
          <Txt size={11} color={t.danger} style={{ width: '100%' }}>
            {error}
          </Txt>
        ) : null}
      </View>
    </View>
  );
});

const s = StyleSheet.create({
  tr: { flexDirection: 'row', alignItems: 'center', minHeight: 48, paddingHorizontal: spacing.md },
  cell: { paddingRight: spacing.sm, paddingVertical: 6 },
  editBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, borderWidth: 1, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 5 },
});

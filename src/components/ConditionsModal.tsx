import { useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { Schema } from '../schema/columnMapper';
import { describeConditions, isComplete, joinOf, opInfo, opsFor, type Condition, type ConditionSet } from '../schema/conditions';
import type { ValueContext } from '../schema/values';
import { DateField } from './DateField';
import { PickerModal } from './PickerModal';
import { spacing, useTheme } from './theme';
import { Button, Card, Chip, Txt } from './ui';

let seq = 0;
const newId = () => `c${Date.now()}_${++seq}`;

/** Builder for "field + condition + value" filters, combined with match all / any. */
export function ConditionsModal({
  visible,
  schema,
  ctx,
  value,
  onClose,
  onApply,
}: {
  visible: boolean;
  schema: Schema;
  ctx: ValueContext;
  value: ConditionSet;
  onClose: () => void;
  onApply: (set: ConditionSet) => void;
}) {
  const t = useTheme();
  const [draft, setDraft] = useState<ConditionSet>(value);
  const [fieldPickerFor, setFieldPickerFor] = useState<string | null>(null);
  const [valuePickerFor, setValuePickerFor] = useState<string | null>(null);

  const fields = schema.fields;
  const update = (id: string, patch: Partial<Condition>) =>
    setDraft((d) => ({ ...d, conditions: d.conditions.map((c) => (c.id === id ? { ...c, ...patch } : c)) }));
  const remove = (id: string) => setDraft((d) => ({ ...d, conditions: d.conditions.filter((c) => c.id !== id) }));
  const add = () => {
    const def = schema.bySemantic.status ?? fields[0];
    if (!def) return;
    const op = opsFor(def.kind)[0]!.op;
    setDraft((d) => ({ ...d, conditions: [...d.conditions, { id: newId(), field: def.name, op, value: '', join: 'and' }] }));
  };

  const complete = draft.conditions.filter((c) => isComplete(c, schema));
  const pickerCondition = draft.conditions.find((c) => c.id === (fieldPickerFor ?? valuePickerFor));
  const pickerDef = pickerCondition ? schema.byName[pickerCondition.field] : undefined;

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose} onShow={() => setDraft(value)}>
      <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }}>
        <View style={[s.header, { borderBottomColor: t.border, backgroundColor: t.card }]}>
          <Txt size={17} weight="700" style={{ flex: 1 }} accessibilityRole="header">
            Filter conditions
          </Txt>
          <Button compact kind="ghost" title="Cancel" onPress={onClose} />
        </View>

        <ScrollView contentContainerStyle={{ padding: spacing.lg, maxWidth: 760, width: '100%', alignSelf: 'center' }} keyboardShouldPersistTaps="handled">
          <Txt muted size={13} style={{ marginBottom: spacing.md }}>
            Choose AND or OR between conditions. Conditions joined by OR are checked together, e.g. Status is Active OR Status is Ready to Ship,
            AND Outbound AWB # is empty → (Active or Ready to Ship) and no AWB.
          </Txt>
          {complete.length ? (
            <Card>
              <Txt size={13} color={t.primary}>
                {describeConditions(draft, schema, ctx)}
              </Txt>
            </Card>
          ) : null}

          {draft.conditions.length === 0 ? (
            <Card>
              <Txt muted>No conditions yet. Add one, for example “Status is Ready to Ship” or “Received Date is after …”.</Txt>
            </Card>
          ) : null}

          {draft.conditions.map((c, i) => {
            const def = schema.byName[c.field];
            if (!def) return null;
            const info = opInfo(def.kind, c.op);
            const pickable = (def.kind === 'choice' || def.kind === 'multichoice' || def.kind === 'person') && (c.op === 'eq' || c.op === 'neq');
            const shownValue = def.kind === 'person' ? (ctx.people[c.value] ?? c.value) : c.value;
            return (
              <Card key={c.id}>
                <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: spacing.sm }}>
                  {i === 0 ? (
                    <Txt muted size={12} weight="700" style={{ flex: 1 }}>
                      WHERE
                    </Txt>
                  ) : (
                    <View style={{ flex: 1, flexDirection: 'row' }}>
                      <Chip label="AND" active={joinOf(c, draft) === 'and'} onPress={() => update(c.id, { join: 'and' })} />
                      <Chip label="OR" active={joinOf(c, draft) === 'or'} onPress={() => update(c.id, { join: 'or' })} />
                    </View>
                  )}
                  <Button compact kind="ghost" title="Remove" onPress={() => remove(c.id)} />
                </View>

                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`Column: ${def.label}. Change column`}
                  onPress={() => setFieldPickerFor(c.id)}
                  style={[s.input, { borderColor: t.border, backgroundColor: t.inputBg }]}
                >
                  <Txt>{def.label}</Txt>
                </Pressable>

                <View style={{ flexDirection: 'row', flexWrap: 'wrap', rowGap: spacing.sm, marginVertical: spacing.sm }}>
                  {opsFor(def.kind).map((o) => (
                    <Chip key={o.op} label={o.label} active={c.op === o.op} onPress={() => update(c.id, { op: o.op })} />
                  ))}
                </View>

                {info?.needsValue ? (
                  def.kind === 'date' || def.kind === 'datetime' ? (
                    <DateField label={`${def.label} value`} value={c.value || null} onChange={(v) => update(c.id, { value: v ?? '' })} />
                  ) : pickable ? (
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={`Value: ${shownValue || 'not set'}. Choose`}
                      onPress={() => setValuePickerFor(c.id)}
                      style={[s.input, { borderColor: t.border, backgroundColor: t.inputBg }]}
                    >
                      <Txt color={shownValue ? t.text : t.muted}>{shownValue || 'Choose a value…'}</Txt>
                    </Pressable>
                  ) : (
                    <TextInput
                      accessibilityLabel={`${def.label} value`}
                      value={c.value}
                      onChangeText={(v) => update(c.id, { value: v })}
                      placeholder="Value"
                      placeholderTextColor={t.muted}
                      keyboardType={['number', 'currency', 'calculated'].includes(def.kind) ? 'decimal-pad' : 'default'}
                      autoCapitalize="none"
                      style={[s.input, { color: t.text, borderColor: t.border, backgroundColor: t.inputBg }]}
                    />
                  )
                ) : null}
              </Card>
            );
          })}

          <Button kind="secondary" title="+ Add condition" onPress={add} style={{ marginBottom: spacing.lg }} />
          <View style={{ flexDirection: 'row', gap: spacing.md, marginBottom: spacing.xl * 2 }}>
            <Button
              kind="ghost"
              title="Clear all"
              style={{ flex: 1 }}
              onPress={() => {
                onApply({ match: 'all', conditions: [] });
                onClose();
              }}
            />
            <Button
              title="Apply"
              style={{ flex: 2 }}
              onPress={() => {
                onApply(draft);
                onClose();
              }}
            />
          </View>
        </ScrollView>

        {fieldPickerFor && pickerCondition ? (
          <PickerModal
            visible
            title="Column"
            options={fields.map((f) => ({ value: f.name, label: f.label }))}
            selected={[pickerCondition.field]}
            onClose={() => setFieldPickerFor(null)}
            onChange={(v) => {
              const def = v[0] ? schema.byName[v[0]] : undefined;
              if (def) update(pickerCondition.id, { field: def.name, op: opsFor(def.kind)[0]!.op, value: '' });
            }}
          />
        ) : null}
        {valuePickerFor && pickerCondition && pickerDef ? (
          <PickerModal
            visible
            title={pickerDef.label}
            options={
              pickerDef.kind === 'person'
                ? Object.entries(ctx.people)
                    .map(([id, name]) => ({ value: id, label: name }))
                    .sort((a, b) => a.label.localeCompare(b.label))
                : pickerDef.choices.map((x) => ({ value: x, label: x }))
            }
            selected={[pickerCondition.value]}
            onClose={() => setValuePickerFor(null)}
            onChange={(v) => update(pickerCondition.id, { value: v[0] ?? '' })}
          />
        ) : null}
      </SafeAreaView>
    </Modal>
  );
}

const s = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', padding: spacing.lg, borderBottomWidth: StyleSheet.hairlineWidth },
  input: { borderWidth: 1, borderRadius: 10, minHeight: 44, paddingHorizontal: 12, justifyContent: 'center', fontSize: 15 },
});

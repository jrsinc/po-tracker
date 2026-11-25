import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Switch, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { Schema } from '../schema/columnMapper';
import { spacing, useTheme } from './theme';
import { Button, Txt } from './ui';

/** Choose which columns the list shows, and in what order. */
export function ColumnPickerModal({
  visible,
  schema,
  value,
  defaults,
  onClose,
  onApply,
}: {
  visible: boolean;
  schema: Schema;
  /** Selected column internal names, in display order. */
  value: string[];
  defaults: string[];
  onClose: () => void;
  onApply: (columns: string[]) => void;
}) {
  const t = useTheme();
  const [selected, setSelected] = useState<string[]>(value);
  const [query, setQuery] = useState('');

  const toggle = (name: string, on: boolean) => setSelected((s) => (on ? [...s, name] : s.filter((x) => x !== name)));
  const move = (name: string, delta: number) =>
    setSelected((s) => {
      const i = s.indexOf(name);
      const j = i + delta;
      if (i < 0 || j < 0 || j >= s.length) return s;
      const next = [...s];
      [next[i], next[j]] = [next[j]!, next[i]!];
      return next;
    });

  const q = query.trim().toLowerCase();
  const others = schema.fields.filter((f) => !selected.includes(f.name) && (!q || f.label.toLowerCase().includes(q)));
  const groupTitle = (key: string) => schema.groups.find((g) => g.key === key)?.title ?? '';

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose} onShow={() => setSelected(value)}>
      <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }}>
        <View style={[s.header, { borderBottomColor: t.border, backgroundColor: t.card }]}>
          <Txt size={17} weight="700" style={{ flex: 1 }} accessibilityRole="header">
            Columns
          </Txt>
          <Button compact kind="ghost" title="Cancel" onPress={onClose} />
          <Button
            compact
            title="Apply"
            onPress={() => {
              onApply(selected);
              onClose();
            }}
          />
        </View>
        <ScrollView contentContainerStyle={{ padding: spacing.lg, maxWidth: 720, width: '100%', alignSelf: 'center' }} keyboardShouldPersistTaps="handled">
          <Txt size={13} weight="700" muted style={{ marginBottom: spacing.sm }}>
            SHOWN ({selected.length}) — use the arrows to change the order
          </Txt>
          {selected.map((name, i) => {
            const f = schema.byName[name];
            if (!f) return null;
            return (
              <View key={name} style={[s.row, { borderColor: t.border, backgroundColor: t.card }]}>
                <Txt muted size={12} style={{ width: 24 }}>
                  {i + 1}
                </Txt>
                <Txt style={{ flex: 1 }} numberOfLines={1}>
                  {f.label}
                </Txt>
                <Pressable accessibilityRole="button" accessibilityLabel={`Move ${f.label} up`} disabled={i === 0} onPress={() => move(name, -1)} style={s.icon}>
                  <Ionicons name="arrow-up" size={18} color={i === 0 ? t.border : t.primary} />
                </Pressable>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`Move ${f.label} down`}
                  disabled={i === selected.length - 1}
                  onPress={() => move(name, 1)}
                  style={s.icon}
                >
                  <Ionicons name="arrow-down" size={18} color={i === selected.length - 1 ? t.border : t.primary} />
                </Pressable>
                <Switch accessibilityLabel={`Show ${f.label}`} value onValueChange={() => toggle(name, false)} trackColor={{ true: t.primary, false: t.border }} />
              </View>
            );
          })}

          <Txt size={13} weight="700" muted style={{ marginTop: spacing.lg, marginBottom: spacing.sm }}>
            ADD A COLUMN
          </Txt>
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder="Search columns"
            placeholderTextColor={t.muted}
            accessibilityLabel="Search columns"
            style={[s.search, { color: t.text, borderColor: t.border, backgroundColor: t.inputBg }]}
          />
          {others.map((f) => (
            <View key={f.name} style={[s.row, { borderColor: t.border, backgroundColor: t.card }]}>
              <View style={{ flex: 1 }}>
                <Txt numberOfLines={1}>{f.label}</Txt>
                <Txt muted size={11}>
                  {groupTitle(f.groupKey)}
                </Txt>
              </View>
              <Switch accessibilityLabel={`Show ${f.label}`} value={false} onValueChange={() => toggle(f.name, true)} trackColor={{ true: t.primary, false: t.border }} />
            </View>
          ))}

          <Button kind="ghost" title="Reset to default columns" onPress={() => setSelected(defaults)} style={{ marginTop: spacing.lg, marginBottom: spacing.xl * 2 }} />
        </ScrollView>
      </SafeAreaView>
    </Modal>
  );
}

const s = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, padding: spacing.lg, borderBottomWidth: StyleSheet.hairlineWidth },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, minHeight: 48, paddingHorizontal: spacing.md, borderWidth: StyleSheet.hairlineWidth, borderRadius: 10, marginBottom: 6 },
  icon: { width: 32, height: 32, alignItems: 'center', justifyContent: 'center' },
  search: { borderWidth: 1, borderRadius: 10, minHeight: 44, paddingHorizontal: 12, fontSize: 15, marginBottom: spacing.sm },
});

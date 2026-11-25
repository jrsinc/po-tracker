import { useMemo, useState } from 'react';
import { FlatList, Modal, Pressable, StyleSheet, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { spacing, useTheme } from './theme';
import { Button, Txt } from './ui';

export interface PickerOption {
  value: string;
  label: string;
}

/** Searchable single/multi select in a modal. Used for choices, people and filters. */
export function PickerModal({
  visible,
  title,
  options,
  selected,
  multiple,
  allowCustom,
  onClose,
  onChange,
}: {
  visible: boolean;
  title: string;
  options: PickerOption[];
  selected: string[];
  multiple?: boolean;
  allowCustom?: boolean;
  onClose: () => void;
  onChange: (values: string[]) => void;
}) {
  const t = useTheme();
  const [query, setQuery] = useState('');
  const [picked, setPicked] = useState<string[]>(selected);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? options.filter((o) => o.label.toLowerCase().includes(q)) : options;
  }, [options, query]);

  const toggle = (v: string) => {
    if (!multiple) {
      onChange([v]);
      onClose();
      return;
    }
    setPicked((p) => (p.includes(v) ? p.filter((x) => x !== v) : [...p, v]));
  };

  const custom = allowCustom && query.trim() && !options.some((o) => o.label.toLowerCase() === query.trim().toLowerCase());

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose} onShow={() => setPicked(selected)}>
      <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }}>
        <View style={[s.header, { borderBottomColor: t.border }]}>
          <Txt size={17} weight="700" style={{ flex: 1 }}>
            {title}
          </Txt>
          {multiple ? (
            <Button
              compact
              title="Done"
              onPress={() => {
                onChange(picked);
                onClose();
              }}
            />
          ) : (
            <Button compact kind="ghost" title="Cancel" onPress={onClose} />
          )}
        </View>
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder="Search"
          placeholderTextColor={t.muted}
          accessibilityLabel={`Search ${title}`}
          autoCorrect={false}
          style={[s.search, { color: t.text, backgroundColor: t.inputBg, borderColor: t.border }]}
        />
        {multiple && picked.length > 0 ? (
          <Button kind="ghost" compact title="Clear selection" onPress={() => setPicked([])} style={{ alignSelf: 'flex-start', marginLeft: spacing.sm }} />
        ) : null}
        <FlatList
          data={filtered}
          keyExtractor={(o) => o.value}
          keyboardShouldPersistTaps="handled"
          ListHeaderComponent={
            custom ? (
              <Pressable accessibilityRole="button" onPress={() => toggle(query.trim())} style={[s.row, { borderBottomColor: t.border }]}>
                <Txt color={t.primary}>Use “{query.trim()}”</Txt>
              </Pressable>
            ) : undefined
          }
          ListEmptyComponent={
            <Txt muted style={{ padding: spacing.lg }}>
              No matches.
            </Txt>
          }
          renderItem={({ item }) => {
            const on = (multiple ? picked : selected).includes(item.value);
            return (
              <Pressable
                accessibilityRole={multiple ? 'checkbox' : 'radio'}
                accessibilityState={{ checked: on }}
                onPress={() => toggle(item.value)}
                style={({ pressed }) => [s.row, { borderBottomColor: t.border, backgroundColor: pressed ? t.chip : 'transparent' }]}
              >
                <Txt style={{ flex: 1 }}>{item.label}</Txt>
                {on ? <Txt color={t.primary} weight="700">✓</Txt> : null}
              </Pressable>
            );
          }}
        />
      </SafeAreaView>
    </Modal>
  );
}

const s = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', padding: spacing.lg, borderBottomWidth: StyleSheet.hairlineWidth },
  search: { margin: spacing.md, borderWidth: 1, borderRadius: 10, paddingHorizontal: spacing.md, minHeight: 44, fontSize: 15 },
  row: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing.lg, minHeight: 48, borderBottomWidth: StyleSheet.hairlineWidth },
});

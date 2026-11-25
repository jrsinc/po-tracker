import { useState } from 'react';
import { Pressable, StyleSheet, Switch, TextInput, View } from 'react-native';
import type { Person } from '../db/repositories/misc';
import type { FieldDef } from '../schema/columnMapper';
import type { FormValue } from '../schema/values';
import { DateField } from './DateField';
import { PickerModal } from './PickerModal';
import { spacing, useTheme } from './theme';
import { Txt } from './ui';

/** One form control, chosen from the column type in the live SharePoint schema. */
export function FieldInput({
  def,
  value,
  error,
  people,
  onChange,
  compact,
}: {
  def: FieldDef;
  value: FormValue;
  error?: string;
  people: Person[];
  onChange: (v: FormValue) => void;
  /** Table-cell mode: no label above, smaller box. */
  compact?: boolean;
}) {
  const t = useTheme();
  const [picking, setPicking] = useState(false);
  const label = `${def.label}${def.required ? ' *' : ''}`;
  const str = typeof value === 'string' ? value : '';
  const inputStyle = [s.input, { color: t.text, backgroundColor: t.inputBg, borderColor: error ? t.danger : t.border }, compact && s.compact];

  let control;
  switch (def.kind) {
    case 'boolean':
      control = (
        <Switch
          accessibilityLabel={def.label}
          value={value === true}
          onValueChange={(v) => onChange(v)}
          trackColor={{ true: t.primary, false: t.border }}
        />
      );
      break;
    case 'date':
      control = <DateField label={def.label} value={str || null} onChange={(v) => onChange(v)} />;
      break;
    case 'choice':
    case 'multichoice':
    case 'person': {
      const options =
        def.kind === 'person'
          ? people.map((p) => ({ value: p.lookupId, label: p.email ? `${p.name} (${p.email.replace(/^.*\|/, '')})` : p.name }))
          : def.choices.map((c) => ({ value: c, label: c }));
      const selected = Array.isArray(value) ? value : str ? [str] : [];
      const shown =
        def.kind === 'person'
          ? people.find((p) => p.lookupId === str)?.name ?? (str ? `User #${str}` : '')
          : selected.join(', ');
      control = (
        <>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`${def.label}: ${shown || 'not set'}. Choose`}
            onPress={() => setPicking(true)}
            style={[...inputStyle, { justifyContent: 'center' }]}
          >
            <Txt color={shown ? t.text : t.muted} numberOfLines={1}>
              {shown || 'Choose…'}
            </Txt>
          </Pressable>
          <PickerModal
            visible={picking}
            title={def.label}
            options={options}
            selected={selected}
            multiple={def.kind === 'multichoice'}
            allowCustom={def.allowTextEntry}
            onClose={() => setPicking(false)}
            onChange={(vals) => onChange(def.kind === 'multichoice' ? vals : (vals[0] ?? ''))}
          />
          {shown && !def.required && !compact ? (
            <Pressable accessibilityRole="button" onPress={() => onChange(def.kind === 'multichoice' ? [] : '')} style={{ paddingTop: 4 }}>
              <Txt size={13} color={t.primary}>
                Clear
              </Txt>
            </Pressable>
          ) : null}
        </>
      );
      break;
    }
    case 'number':
    case 'currency':
      control = (
        <TextInput
          accessibilityLabel={def.label}
          value={str}
          onChangeText={(v) => onChange(v)}
          keyboardType="decimal-pad"
          style={inputStyle}
          placeholderTextColor={t.muted}
        />
      );
      break;
    case 'text':
    case 'note':
      control = (
        <TextInput
          accessibilityLabel={def.label}
          value={str}
          onChangeText={(v) => onChange(v)}
          multiline={def.multiline}
          maxLength={def.maxLength}
          style={[...inputStyle, def.multiline && !compact && { minHeight: 88, textAlignVertical: 'top', paddingTop: 10 }]}
          placeholderTextColor={t.muted}
        />
      );
      break;
    default:
      control = (
        <Txt muted size={14}>
          {str || '—'} (read-only)
        </Txt>
      );
  }

  return (
    <View style={{ marginBottom: compact ? 0 : spacing.md }}>
      {compact ? null : (
        <Txt size={13} weight="600" muted style={{ marginBottom: 6 }}>
          {label}
        </Txt>
      )}
      {control}
      {error ? (
        <Txt size={12} color={t.danger} style={{ marginTop: 4 }}>
          {error}
        </Txt>
      ) : null}
    </View>
  );
}

const s = StyleSheet.create({
  input: { borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, minHeight: 44, fontSize: 15 },
  compact: { minHeight: 36, borderRadius: 8, paddingHorizontal: 8, fontSize: 14 },
});

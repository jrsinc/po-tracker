import DateTimePicker, { type DateTimePickerEvent } from '@react-native-community/datetimepicker';
import { useState } from 'react';
import { Platform, Pressable, View } from 'react-native';
import { formatYmd } from '../schema/dates';
import { useTheme } from './theme';
import { Button, Txt } from './ui';

/** Native date picker. Value is 'YYYY-MM-DD' (a calendar date, no time zone). */
export function DateField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string | null;
  onChange: (v: string | null) => void;
}) {
  const t = useTheme();
  const [open, setOpen] = useState(false);
  const parts = value?.split('-').map(Number);
  const date = parts && parts.length === 3 ? new Date(parts[0]!, parts[1]! - 1, parts[2]!) : new Date();

  const onPick = (e: DateTimePickerEvent, d?: Date) => {
    if (Platform.OS === 'android') setOpen(false);
    if (e.type === 'set' && d) {
      const ymd = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      onChange(ymd);
    }
  };

  return (
    <View>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`${label}: ${value ? formatYmd(value) : 'not set'}. Change date`}
          onPress={() => setOpen((o) => !o)}
          style={{ flex: 1, minHeight: 44, justifyContent: 'center', borderWidth: 1, borderColor: t.border, borderRadius: 10, paddingHorizontal: 12, backgroundColor: t.inputBg }}
        >
          <Txt color={value ? t.text : t.muted}>{value ? formatYmd(value) : 'Select date'}</Txt>
        </Pressable>
        {value ? <Button compact kind="ghost" title="Clear" onPress={() => onChange(null)} /> : null}
      </View>
      {open ? (
        <DateTimePicker value={date} mode="date" display={Platform.OS === 'ios' ? 'inline' : 'default'} onChange={onPick} />
      ) : null}
    </View>
  );
}

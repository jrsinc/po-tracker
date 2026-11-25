import { createElement } from 'react';
import { View } from 'react-native';
import { useTheme } from './theme';
import { Button } from './ui';

/** Web date input (the native picker is not available on web). Value is 'YYYY-MM-DD'. */
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
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
      {createElement('input', {
        type: 'date',
        'aria-label': label,
        value: value ?? '',
        onChange: (e: { target: { value: string } }) => onChange(e.target.value || null),
        style: {
          flex: 1,
          minHeight: 44,
          borderRadius: 10,
          border: `1px solid ${t.border}`,
          padding: '0 12px',
          fontSize: 15,
          color: t.text,
          background: t.inputBg,
          colorScheme: t.dark ? 'dark' : 'light',
        },
      })}
      {value ? <Button compact kind="ghost" title="Clear" onPress={() => onChange(null)} /> : null}
    </View>
  );
}

import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import { ActivityIndicator, Pressable } from 'react-native';
import { openPoFolder } from '../documents/openFolder';
import { useServices } from '../hooks/services';
import { useTheme } from './theme';
import { Txt } from './ui';

/** Folder icon (optionally with a label) that opens the PO's document folder in SharePoint. */
export function FolderLink({ folder, size = 18, label }: { folder: string; size?: number; label?: string }) {
  const t = useTheme();
  const services = useServices();
  const [busy, setBusy] = useState(false);
  if (!folder.trim()) return null;
  const onPress = () => {
    setBusy(true);
    void openPoFolder(services, folder).finally(() => setBusy(false));
  };
  return (
    <Pressable
      accessibilityRole="link"
      accessibilityLabel={`Open folder ${folder} in SharePoint`}
      onPress={onPress}
      disabled={busy}
      hitSlop={8}
      style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1, flexDirection: 'row', alignItems: 'center', gap: 4 })}
    >
      {busy ? <ActivityIndicator size="small" color={t.primary} /> : <Ionicons name="folder-open" size={size} color="#D69E00" />}
      {label ? (
        <Txt size={13} color={t.primary} numberOfLines={1}>
          {label}
        </Txt>
      ) : null}
    </Pressable>
  );
}

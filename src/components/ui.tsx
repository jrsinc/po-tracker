import type { ReactNode } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type TextStyle,
  type ViewStyle,
} from 'react-native';
import { spacing, useTheme } from './theme';

export function Txt({
  children,
  muted,
  size = 15,
  weight,
  color,
  style,
  numberOfLines,
  accessibilityRole,
  accessibilityLiveRegion,
}: {
  children: ReactNode;
  muted?: boolean;
  size?: number;
  weight?: TextStyle['fontWeight'];
  color?: string;
  style?: StyleProp<TextStyle>;
  numberOfLines?: number;
  accessibilityRole?: 'header' | 'text' | 'alert';
  accessibilityLiveRegion?: 'none' | 'polite' | 'assertive';
}) {
  const t = useTheme();
  return (
    <Text
      numberOfLines={numberOfLines}
      accessibilityRole={accessibilityRole}
      accessibilityLiveRegion={accessibilityLiveRegion}
      style={[{ color: color ?? (muted ? t.muted : t.text), fontSize: size, fontWeight: weight }, style]}
    >
      {children}
    </Text>
  );
}

export function Card({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  const t = useTheme();
  return (
    <View style={[styles.card, { backgroundColor: t.card, borderColor: t.border }, style]}>{children}</View>
  );
}

type ButtonKind = 'primary' | 'secondary' | 'danger' | 'ghost';

export function Button({
  title,
  onPress,
  kind = 'primary',
  disabled,
  loading,
  accessibilityHint,
  style,
  compact,
}: {
  title: string;
  onPress: () => void;
  kind?: ButtonKind;
  disabled?: boolean;
  loading?: boolean;
  accessibilityHint?: string;
  style?: StyleProp<ViewStyle>;
  compact?: boolean;
}) {
  const t = useTheme();
  const bg = kind === 'primary' ? t.primary : kind === 'danger' ? t.danger : kind === 'secondary' ? t.chip : 'transparent';
  const fg = kind === 'primary' ? t.primaryText : kind === 'danger' ? '#FFFFFF' : t.primary;
  const off = disabled || loading;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={title}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled: !!off, busy: !!loading }}
      disabled={off}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        compact && styles.buttonCompact,
        { backgroundColor: bg, opacity: off ? 0.5 : pressed ? 0.8 : 1 },
        style,
      ]}
    >
      {loading ? <ActivityIndicator color={fg} /> : <Text style={[styles.buttonText, { color: fg }]}>{title}</Text>}
    </Pressable>
  );
}

export function Badge({ label, tone = 'neutral' }: { label: string; tone?: 'neutral' | 'warning' | 'danger' | 'success' | 'info' }) {
  const t = useTheme();
  const color =
    tone === 'warning' ? t.warning : tone === 'danger' ? t.danger : tone === 'success' ? t.success : tone === 'info' ? t.primary : t.muted;
  return (
    <View style={[styles.badge, { borderColor: color }]} accessible accessibilityLabel={label}>
      <Text style={[styles.badgeText, { color }]}>{label}</Text>
    </View>
  );
}

export function Chip({ label, active, onPress }: { label: string; active?: boolean; onPress: () => void }) {
  const t = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: !!active }}
      onPress={onPress}
      style={[styles.chip, { backgroundColor: active ? t.chipActive : t.chip, borderColor: active ? t.primary : t.border }]}
    >
      <Text style={{ color: active ? t.primary : t.text, fontSize: 13, fontWeight: active ? '600' : '400' }}>{label}</Text>
    </Pressable>
  );
}

export function SectionHeader({ title, right }: { title: string; right?: ReactNode }) {
  return (
    <View style={styles.sectionHeader} accessibilityRole="header">
      <Txt size={13} weight="700" muted style={{ textTransform: 'uppercase', letterSpacing: 0.5 }}>
        {title}
      </Txt>
      {right}
    </View>
  );
}

export function LoadingState({ label = 'Loading…' }: { label?: string }) {
  const t = useTheme();
  return (
    <View style={styles.center} accessibilityLiveRegion="polite">
      <ActivityIndicator color={t.primary} />
      <Txt muted style={{ marginTop: spacing.sm }}>
        {label}
      </Txt>
    </View>
  );
}

export function EmptyState({ title, message, action }: { title: string; message?: string; action?: ReactNode }) {
  return (
    <View style={styles.center}>
      <Txt size={17} weight="600" style={{ textAlign: 'center' }}>
        {title}
      </Txt>
      {message ? (
        <Txt muted style={{ textAlign: 'center', marginTop: spacing.sm }}>
          {message}
        </Txt>
      ) : null}
      {action ? <View style={{ marginTop: spacing.lg }}>{action}</View> : null}
    </View>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  const t = useTheme();
  return (
    <View style={styles.center} accessibilityRole="alert">
      <Txt size={17} weight="600" color={t.danger} style={{ textAlign: 'center' }}>
        Something went wrong
      </Txt>
      <Txt muted style={{ textAlign: 'center', marginTop: spacing.sm }}>
        {message}
      </Txt>
      {onRetry ? <Button title="Try again" onPress={onRetry} style={{ marginTop: spacing.lg }} /> : null}
    </View>
  );
}

export function Banner({ text, tone = 'info', action }: { text: string; tone?: 'info' | 'warning' | 'danger'; action?: ReactNode }) {
  const t = useTheme();
  const color = tone === 'warning' ? t.warning : tone === 'danger' ? t.danger : t.primary;
  return (
    <View
      accessibilityRole={tone === 'danger' ? 'alert' : undefined}
      style={[styles.banner, { borderColor: color, backgroundColor: t.card }]}
    >
      <Txt size={13} color={color} style={{ flex: 1 }}>
        {text}
      </Txt>
      {action}
    </View>
  );
}

export function KeyValue({ label, value }: { label: string; value: string }) {
  const t = useTheme();
  return (
    <View style={[styles.kv, { borderBottomColor: t.border }]} accessible accessibilityLabel={`${label}: ${value || 'empty'}`}>
      <Txt muted size={13} style={{ flex: 2 }}>
        {label}
      </Txt>
      <Txt size={14} style={{ flex: 3, textAlign: 'right' }} color={value ? t.text : t.muted}>
        {value || '—'}
      </Txt>
    </View>
  );
}

export const styles = StyleSheet.create({
  card: { borderRadius: 12, borderWidth: StyleSheet.hairlineWidth, padding: spacing.lg, marginBottom: spacing.md },
  button: { minHeight: 44, borderRadius: 10, paddingHorizontal: spacing.lg, alignItems: 'center', justifyContent: 'center' },
  buttonCompact: { minHeight: 36, paddingHorizontal: spacing.md },
  buttonText: { fontSize: 15, fontWeight: '600' },
  badge: { borderWidth: 1, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 2, alignSelf: 'flex-start' },
  badgeText: { fontSize: 11, fontWeight: '700' },
  chip: { borderWidth: 1, borderRadius: 999, paddingHorizontal: 12, minHeight: 32, justifyContent: 'center', marginRight: spacing.sm },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: spacing.lg, marginBottom: spacing.sm },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xl },
  banner: { flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderRadius: 10, padding: spacing.md, marginBottom: spacing.md, gap: spacing.sm },
  kv: { flexDirection: 'row', paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth, gap: spacing.md },
});

import { Redirect } from 'expo-router';
import { Platform, View } from 'react-native';
import { useTheme } from '../src/components/theme';
import { LoadingState } from '../src/components/ui';

/**
 * Redirect target for Microsoft sign-in (potracker://auth on mobile, https://<site>/auth on web).
 * On web this page loads inside the sign-in popup; expo-web-browser hands the result back to
 * the opener (maybeCompleteAuthSession in authService) and closes the popup.
 */
export default function AuthCallback() {
  const t = useTheme();
  if (Platform.OS !== 'web') return <Redirect href="/" />;
  return (
    <View style={{ flex: 1, backgroundColor: t.bg }}>
      <LoadingState label="Completing sign-in…" />
    </View>
  );
}

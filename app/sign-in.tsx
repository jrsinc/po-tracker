import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { prepareSignIn } from '../src/auth/authService';
import { useAuth } from '../src/auth/AuthProvider';
import { AuthCancelledError } from '../src/auth/types';
import { spacing, useTheme } from '../src/components/theme';
import { Banner, Button, Card, Txt } from '../src/components/ui';
import { getConfig, getConfigError } from '../src/config/env';

export default function SignIn() {
  const t = useTheme();
  const { signIn } = useAuth();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const configError = getConfigError();

  // Prepare the request ahead of the tap (web pop-ups must open directly from the click).
  useEffect(() => {
    if (!configError) prepareSignIn().catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)));
  }, [configError]);

  const onPress = async () => {
    setBusy(true);
    setError(null);
    try {
      await signIn();
    } catch (e) {
      if (!(e instanceof AuthCancelledError)) setError(e instanceof Error ? e.message : String(e));
      prepareSignIn().catch(() => undefined);
    } finally {
      setBusy(false);
    }
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }}>
      <View style={{ flex: 1, justifyContent: 'center', padding: spacing.xl, maxWidth: 480, width: '100%', alignSelf: 'center' }}>
        <Txt size={28} weight="800" style={{ marginBottom: spacing.sm }} accessibilityRole="header">
          PO Tracker
        </Txt>
        <Txt muted style={{ marginBottom: spacing.xl }}>
          {configError ? 'Configuration needed' : `${getConfig().listName} · SharePoint`}
        </Txt>
        {configError ? (
          <Banner tone="danger" text={configError.message} />
        ) : (
          <Card>
            <Txt style={{ marginBottom: spacing.lg }}>
              Sign in with your work Microsoft account to view and update purchase orders. Data stays in SharePoint; this
              device keeps an offline copy.
            </Txt>
            {error ? <Banner tone="danger" text={error} /> : null}
            <Button title="Sign in with Microsoft" onPress={onPress} loading={busy} />
          </Card>
        )}
      </View>
    </SafeAreaView>
  );
}

import { Stack, useRouter, useSegments } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { AuthProvider, useAuth } from '../src/auth/AuthProvider';
import { useTheme } from '../src/components/theme';
import { EmptyState, ErrorState, LoadingState } from '../src/components/ui';
import { getConfigError } from '../src/config/env';
import { ServicesProvider } from '../src/hooks/services';
import { onNoticeOpened } from '../src/notifications/notifier';
import { getServices, type AppServices } from '../src/services/appServices';
import { startSyncCoordinator } from '../src/services/coordinator';
// Importing this module also defines the background sync task at start-up (no-op on web).
import { registerBackgroundSync } from '../src/services/backgroundTask';

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <AuthProvider>
        <Root />
      </AuthProvider>
    </SafeAreaProvider>
  );
}

function AuthGuard({ signedIn }: { signedIn: boolean }) {
  const segments = useSegments();
  const router = useRouter();
  const first = segments[0] as string | undefined;
  useEffect(() => {
    const onPublic = first === 'sign-in' || first === 'auth';
    if (!signedIn && !onPublic) router.replace('/sign-in');
    else if (signedIn && onPublic) router.replace('/');
  }, [signedIn, first, router]);
  return null;
}

function Root() {
  const t = useTheme();
  const { status, markSignedOut } = useAuth();
  const router = useRouter();
  const [services, setServices] = useState<AppServices | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  const configError = getConfigError();

  useEffect(() => {
    if (configError) return;
    getServices()
      .then(setServices)
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)));
  }, [attempt, configError]);

  useEffect(() => {
    if (!services || status !== 'signedIn') return;
    const stop = startSyncCoordinator(services);
    void registerBackgroundSync().catch(() => undefined);
    const unsub = onNoticeOpened((id) => {
      if (id) router.push({ pathname: '/po/[id]', params: { id } });
    });
    // Session expired for good: back to sign-in. Local data and queued changes are kept, so
    // signing in again as the same user resumes syncing.
    const unsubAuth = services.onAuthRequired(markSignedOut);
    return () => {
      stop();
      unsub();
      unsubAuth();
    };
  }, [services, status, router, markSignedOut]);

  if (configError) {
    return (
      <View style={{ flex: 1, backgroundColor: t.bg }}>
        <EmptyState title="Configuration needed" message={configError.message} />
      </View>
    );
  }
  if (error) {
    return (
      <View style={{ flex: 1, backgroundColor: t.bg }}>
        <ErrorState
          message={`The local database could not be opened: ${error}`}
          onRetry={() => {
            setError(null);
            setAttempt((a) => a + 1);
          }}
        />
      </View>
    );
  }
  if (!services || status === 'loading') {
    return (
      <View style={{ flex: 1, backgroundColor: t.bg }}>
        <LoadingState label="Starting…" />
      </View>
    );
  }

  const signedIn = status === 'signedIn';
  return (
    <ServicesProvider services={services}>
      <StatusBar style={t.dark ? 'light' : 'dark'} />
      <Stack
        screenOptions={{
          headerStyle: { backgroundColor: t.card },
          headerTintColor: t.primary,
          headerTitleStyle: { color: t.text },
          contentStyle: { backgroundColor: t.bg },
        }}
      >
        <Stack.Screen name="(app)" options={{ headerShown: false }} />
        <Stack.Screen name="po/new" options={{ title: 'New PO', presentation: 'modal' }} />
        <Stack.Screen name="po/[id]/index" options={{ title: 'PO' }} />
        <Stack.Screen name="po/[id]/edit" options={{ title: 'Edit PO', presentation: 'modal' }} />
        <Stack.Screen name="po/[id]/documents" options={{ title: 'Documents' }} />
        <Stack.Screen name="report/[id]" options={{ title: 'Report' }} />
        <Stack.Screen name="report/edit" options={{ title: 'Report', presentation: 'modal' }} />
        <Stack.Screen name="conflict/[outboxId]" options={{ title: 'Resolve conflict' }} />
        <Stack.Screen name="sign-in" options={{ headerShown: false }} />
        <Stack.Screen name="auth" options={{ headerShown: false }} />
      </Stack>
      {/* Route guard: signed-out users only see sign-in (and the sign-in callback). */}
      <AuthGuard signedIn={signedIn} />
    </ServicesProvider>
  );
}

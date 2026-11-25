import { Ionicons } from '@expo/vector-icons';
import { Tabs } from 'expo-router';
import { useTheme } from '../../src/components/theme';
import { useSyncStatus } from '../../src/hooks/services';

export default function AppTabs() {
  const t = useTheme();
  const st = useSyncStatus();
  const problems = st.conflicts + st.failedChanges + st.failedUploads + st.blockedUploads;
  const pending = st.pendingChanges + st.pendingUploads;

  return (
    <Tabs
      screenOptions={{
        headerStyle: { backgroundColor: t.card },
        headerTitleStyle: { color: t.text },
        tabBarStyle: { backgroundColor: t.card, borderTopColor: t.border },
        tabBarActiveTintColor: t.primary,
        tabBarInactiveTintColor: t.muted,
        sceneStyle: { backgroundColor: t.bg },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: 'Purchase orders',
          tabBarLabel: 'POs',
          tabBarIcon: ({ color, size }) => <Ionicons name="list" color={color as string} size={size} />,
        }}
      />
      <Tabs.Screen
        name="reports"
        options={{
          title: 'Reports',
          tabBarIcon: ({ color, size }) => <Ionicons name="bar-chart-outline" color={color as string} size={size} />,
        }}
      />
      <Tabs.Screen
        name="sync"
        options={{
          title: 'Sync',
          tabBarIcon: ({ color, size }) => <Ionicons name="sync" color={color as string} size={size} />,
          tabBarBadge: problems ? problems : pending ? pending : undefined,
          tabBarBadgeStyle: { backgroundColor: problems ? t.danger : t.warning },
          tabBarAccessibilityLabel: `Sync${problems ? `, ${problems} problems` : pending ? `, ${pending} pending` : ''}`,
        }}
      />
      <Tabs.Screen
        name="settings"
        options={{
          title: 'Settings',
          tabBarIcon: ({ color, size }) => <Ionicons name="settings-outline" color={color as string} size={size} />,
        }}
      />
    </Tabs>
  );
}

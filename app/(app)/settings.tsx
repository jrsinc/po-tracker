import { useEffect, useState } from 'react';
import { Linking, Platform, Pressable, ScrollView, Switch, View } from 'react-native';
import { useAuth } from '../../src/auth/AuthProvider';
import { confirm } from '../../src/components/confirm';
import { PickerModal } from '../../src/components/PickerModal';
import { spacing, useTheme } from '../../src/components/theme';
import { Banner, Button, Card, Chip, KeyValue, SectionHeader, Txt } from '../../src/components/ui';
import { getConfig } from '../../src/config/env';
import { useAsync, useSchema, useServices, useSyncStatus } from '../../src/hooks/services';
import { getPermission, requestPermission, type PermissionState } from '../../src/notifications/notifier';
import { DEFAULT_PREFS, type NotificationPrefs } from '../../src/notifications/rules';
import { unregisterBackgroundSync } from '../../src/services/backgroundTask';

function Toggle({ label, hint, value, onChange }: { label: string; hint?: string; value: boolean; onChange: (v: boolean) => void }) {
  const t = useTheme();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 10, gap: spacing.md }}>
      <View style={{ flex: 1 }}>
        <Txt>{label}</Txt>
        {hint ? (
          <Txt muted size={12}>
            {hint}
          </Txt>
        ) : null}
      </View>
      <Switch accessibilityLabel={label} value={value} onValueChange={onChange} trackColor={{ true: t.primary, false: t.border }} />
    </View>
  );
}

function DaysChoice({ label, value, options, onChange }: { label: string; value: number; options: number[]; onChange: (v: number) => void }) {
  return (
    <View style={{ paddingVertical: 10 }}>
      <Txt style={{ marginBottom: spacing.sm }}>{label}</Txt>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', rowGap: spacing.sm }}>
        {[0, ...options].map((d) => (
          <Chip key={d} label={d === 0 ? 'Off' : `${d} days`} active={value === d} onPress={() => onChange(d)} />
        ))}
      </View>
    </View>
  );
}

export default function Settings() {
  const t = useTheme();
  const services = useServices();
  const auth = useAuth();
  const st = useSyncStatus();
  const schemaState = useSchema();
  const cfg = getConfig();
  const me = useAsync(() => services.me(), [services]);
  const [prefs, setPrefs] = useState<NotificationPrefs>(DEFAULT_PREFS);
  const [perm, setPerm] = useState<PermissionState>('undetermined');
  const [statusPicker, setStatusPicker] = useState(false);
  const [signingOut, setSigningOut] = useState(false);

  useEffect(() => {
    services.getPrefs().then(setPrefs).catch(() => undefined);
    getPermission().then(setPerm).catch(() => setPerm('unsupported'));
  }, [services]);

  const update = (patch: Partial<NotificationPrefs>) => {
    const next = { ...prefs, ...patch };
    setPrefs(next);
    void services.setPrefs(next);
  };

  const statusChoices = schemaState.data?.schema?.bySemantic.status?.choices ?? [];

  const signOut = async () => {
    const unsynced = st.pendingChanges + st.failedChanges + st.conflicts + st.pendingUploads + st.failedUploads + st.blockedUploads;
    const ok = await confirm(
      'Sign out?',
      unsynced
        ? `${unsynced} change${unsynced === 1 ? '' : 's'} or upload${unsynced === 1 ? '' : 's'} have not reached SharePoint and will be lost. All PO data saved on this device will be deleted.`
        : 'All PO data saved on this device will be deleted. Your data in SharePoint is not affected.',
      'Sign out',
      true,
    );
    if (!ok) return;
    setSigningOut(true);
    try {
      await unregisterBackgroundSync().catch(() => undefined);
      await services.signOut();
      auth.markSignedOut();
    } finally {
      setSigningOut(false);
    }
  };

  const listUrl = `https://${cfg.siteHost}${cfg.sitePath}/Lists/${encodeURIComponent(cfg.listName)}/AllItems.aspx`;

  return (
    <ScrollView style={{ flex: 1, backgroundColor: t.bg }} contentContainerStyle={{ padding: spacing.lg, maxWidth: 860, width: '100%', alignSelf: 'center' }}>
      <SectionHeader title="Account" />
      <Card>
        <KeyValue label="Signed in as" value={me.data?.displayName ?? '…'} />
        <KeyValue label="Email" value={me.data?.mail ?? me.data?.userPrincipalName ?? ''} />
        <KeyValue label="Site" value={`${cfg.siteHost}${cfg.sitePath}`} />
        <KeyValue label="List" value={cfg.listName} />
        <KeyValue label="Document library" value={cfg.baseFolder ? `${cfg.libraryName} / ${cfg.baseFolder}` : cfg.libraryName} />
        <Button kind="danger" title="Sign out" loading={signingOut} onPress={signOut} style={{ marginTop: spacing.lg }} />
      </Card>

      <SectionHeader title="Notifications" />
      <Card>
        {perm === 'unsupported' ? (
          <Banner tone="warning" text="This browser does not support notifications." />
        ) : perm !== 'granted' ? (
          <Banner
            tone="warning"
            text={perm === 'denied' ? 'Notifications are blocked. Turn them on in system settings.' : 'Allow notifications to get PO alerts.'}
            action={
              perm === 'denied' ? (
                Platform.OS !== 'web' ? <Button compact kind="ghost" title="Open settings" onPress={() => Linking.openSettings()} /> : undefined
              ) : (
                <Button compact kind="ghost" title="Allow" onPress={async () => setPerm(await requestPermission())} />
              )
            }
          />
        ) : null}
        <Toggle label="PO alerts" value={prefs.enabled} onChange={(v) => update({ enabled: v })} />
        {prefs.enabled ? (
          <>
            <Toggle label="Only POs where I am Account Manager" value={prefs.onlyMine} onChange={(v) => update({ onlyMine: v })} />
            <Toggle label="PO assigned to me" value={prefs.assignedToMe} onChange={(v) => update({ assignedToMe: v })} />
            <Toggle label="New PO added" value={prefs.newPo} onChange={(v) => update({ newPo: v })} />
            <Toggle label="Status changed" value={prefs.statusChange} onChange={(v) => update({ statusChange: v })} />
            {prefs.statusChange ? (
              <Pressable accessibilityRole="button" onPress={() => setStatusPicker(true)} style={{ paddingVertical: 8 }}>
                <Txt size={13} color={t.primary}>
                  {prefs.statusFilter.length ? `Only when status becomes: ${prefs.statusFilter.join(', ')}` : 'Any new status (tap to limit)'}
                </Txt>
              </Pressable>
            ) : null}
            <Toggle label="Remarks on status changed" value={prefs.remarksChange} onChange={(v) => update({ remarksChange: v })} />
            <DaysChoice label="Product expiring within" value={prefs.expiryWithinDays} options={[30, 60, 90]} onChange={(v) => update({ expiryWithinDays: v })} />
            <DaysChoice label="Received but not dispatched for" value={prefs.readyToShipDays} options={[3, 7, 14]} onChange={(v) => update({ readyToShipDays: v })} />
            <Toggle label="Sync problems (conflicts, failed uploads)" value={prefs.syncProblems} onChange={(v) => update({ syncProblems: v })} />
          </>
        ) : null}
        <Txt muted size={12} style={{ marginTop: spacing.sm }}>
          {Platform.OS === 'web'
            ? 'In the browser, alerts appear while this tab is open (it checks SharePoint every 5 minutes).'
            : 'The app checks SharePoint in the background about every 30 minutes, when the phone allows it. Alerts are not instant.'}
        </Txt>
      </Card>

      <SectionHeader title="Instant email alerts (SharePoint)" />
      <Card>
        <Txt size={14}>
          For instant alerts by email, a site member can add a rule to the list in SharePoint (this changes the list settings, so it is not done
          by the app):
        </Txt>
        <Txt size={14} style={{ marginTop: spacing.sm }}>
          1. Open the list in a browser.{'\n'}2. Select Automate › Rules › Create a rule.{'\n'}3. Choose “A column changes”, pick Status (or
          another column), and choose who to notify.{'\n'}4. Optionally use “A new item is created” for new POs.
        </Txt>
        <Button kind="secondary" title="Open the list in SharePoint" onPress={() => Linking.openURL(listUrl)} style={{ marginTop: spacing.md }} />
      </Card>

      <View style={{ height: spacing.xl * 2 }} />
      <PickerModal
        visible={statusPicker}
        multiple
        title="Alert when status becomes"
        options={statusChoices.map((c) => ({ value: c, label: c }))}
        selected={prefs.statusFilter}
        onClose={() => setStatusPicker(false)}
        onChange={(v) => update({ statusFilter: v })}
      />
    </ScrollView>
  );
}

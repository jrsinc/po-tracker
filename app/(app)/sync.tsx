import { useRouter } from 'expo-router';
import { useState } from 'react';
import { RefreshControl, ScrollView, View } from 'react-native';
import { confirm } from '../../src/components/confirm';
import { spacing, useTheme } from '../../src/components/theme';
import { Badge, Banner, Button, Card, KeyValue, SectionHeader, Txt } from '../../src/components/ui';
import type { OutboxEntry } from '../../src/db/repositories/outbox';
import { useAsync, useDataVersion, useSchema, useServices, useSyncStatus } from '../../src/hooks/services';
import { displayValue } from '../../src/schema/values';
import { afterLocalChange } from '../../src/services/coordinator';

function timeAgo(iso: string | null): string {
  if (!iso) return 'Never';
  const mins = Math.round((Date.now() - Date.parse(iso)) / 60_000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins} min ago`;
  const h = Math.round(mins / 60);
  if (h < 24) return `${h} h ago`;
  return new Date(iso).toLocaleString();
}

const OP_LABEL: Record<OutboxEntry['op'], string> = { create: 'New PO', update: 'Edit', delete: 'Delete' };

export default function SyncScreen() {
  const t = useTheme();
  const router = useRouter();
  const services = useServices();
  const st = useSyncStatus();
  const version = useDataVersion();
  const schemaState = useSchema();
  const [refreshing, setRefreshing] = useState(false);

  const data = useAsync(async () => {
    const outbox = await services.store.outbox.all();
    const items = new Map<string, Awaited<ReturnType<typeof services.store.items.get>>>();
    for (const e of outbox) if (!items.has(e.itemLocalId)) items.set(e.itemLocalId, await services.store.items.get(e.itemLocalId));
    const uploads = await services.store.uploads.active();
    const log = await services.store.log.recent(20);
    return { outbox, items, uploads, log };
  }, [services, version, st.syncing, st.uploading]);

  const syncNow = async () => {
    setRefreshing(true);
    try {
      await services.store.outbox.retryAllFailed();
      await services.store.uploads.retryAllFailed();
      await services.runCycle('manual');
    } finally {
      setRefreshing(false);
    }
  };

  const label = (e: OutboxEntry) => {
    const item = data.data?.items.get(e.itemLocalId);
    const schema = schemaState.data?.schema;
    const ctx = schemaState.data?.ctx;
    const folderDef = schema?.bySemantic.folder;
    const folder = item && folderDef && ctx ? displayValue(item.fields, folderDef, ctx) : '';
    return folder ? `Folder ${folder}` : e.op === 'delete' ? `Item ${String(e.payload.__spId ?? '')}` : 'PO';
  };

  const d = data.data;
  const busy = st.syncing || st.uploading;

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: t.bg }}
      contentContainerStyle={{ padding: spacing.lg, maxWidth: 860, width: '100%', alignSelf: 'center' }}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={syncNow} tintColor={t.primary} />}
    >
      {!st.online ? <Banner tone="warning" text="You are offline. Changes are saved on this device and will sync later." /> : null}
      {st.lastError ? <Banner tone="danger" text={`Last sync error: ${st.lastError}`} /> : null}

      <Card>
        <KeyValue label="Last sync" value={timeAgo(st.lastSync)} />
        <KeyValue label="Status" value={st.syncing ? 'Syncing records…' : st.uploading ? 'Uploading documents…' : st.online ? 'Idle' : 'Offline'} />
        <KeyValue label="Pending record changes" value={String(st.pendingChanges)} />
        <KeyValue label="Pending uploads" value={String(st.pendingUploads)} />
        <KeyValue label="Conflicts" value={String(st.conflicts)} />
        <KeyValue label="Failed" value={String(st.failedChanges + st.failedUploads + st.blockedUploads)} />
        <Button title="Sync now" onPress={syncNow} loading={busy || refreshing} style={{ marginTop: spacing.lg }} accessibilityHint="Sends your changes and downloads updates from SharePoint" />
      </Card>

      <SectionHeader title="Record changes" />
      {!d?.outbox.length ? (
        <Card>
          <Txt muted>Everything is synced.</Txt>
        </Card>
      ) : (
        <Card style={{ paddingVertical: spacing.xs }}>
          {d.outbox.map((e) => (
            <View key={e.id} style={{ paddingVertical: spacing.md, borderBottomWidth: 1, borderBottomColor: t.border }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
                <Txt weight="600" style={{ flex: 1 }}>
                  {OP_LABEL[e.op]} · {label(e)}
                </Txt>
                <Badge
                  label={e.status === 'conflict' ? 'Conflict' : e.status === 'failed' ? 'Failed' : e.attempts ? 'Retrying' : 'Pending'}
                  tone={e.status === 'pending' ? 'warning' : 'danger'}
                />
              </View>
              {e.lastError ? (
                <Txt muted size={12} style={{ marginTop: 2 }}>
                  {e.lastError}
                </Txt>
              ) : null}
              <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm, flexWrap: 'wrap' }}>
                {e.status === 'conflict' ? (
                  <Button compact title="Resolve" onPress={() => router.push({ pathname: '/conflict/[outboxId]', params: { outboxId: String(e.id) } })} />
                ) : null}
                {e.status === 'failed' ? (
                  <Button compact kind="secondary" title="Retry" onPress={async () => {
                    await services.store.outbox.retry(e.id);
                    afterLocalChange(services);
                  }} />
                ) : null}
                {e.status !== 'pending' || e.attempts > 0 ? (
                  <Button compact kind="ghost" title="Discard change" onPress={async () => {
                    const ok = await confirm('Discard this change?', 'Your local change will be dropped and the SharePoint version restored.', 'Discard', true);
                    if (!ok) return;
                    await services.engine.discardChange(e.id);
                    afterLocalChange(services);
                  }} />
                ) : null}
                {d.items.get(e.itemLocalId) ? (
                  <Button compact kind="ghost" title="Open PO" onPress={() => router.push({ pathname: '/po/[id]', params: { id: e.itemLocalId } })} />
                ) : null}
              </View>
            </View>
          ))}
        </Card>
      )}

      <SectionHeader title="Uploads" />
      {!d?.uploads.length ? (
        <Card>
          <Txt muted>No uploads waiting.</Txt>
        </Card>
      ) : (
        <Card style={{ paddingVertical: spacing.xs }}>
          {d.uploads.map((u) => (
            <View key={u.id} style={{ paddingVertical: spacing.md, borderBottomWidth: 1, borderBottomColor: t.border }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
                <Txt style={{ flex: 1 }} numberOfLines={1}>
                  {u.targetName}
                </Txt>
                <Badge label={u.status[0]!.toUpperCase() + u.status.slice(1)} tone={u.status === 'failed' || u.status === 'blocked' ? 'danger' : 'warning'} />
              </View>
              {u.lastError ? (
                <Txt muted size={12} style={{ marginTop: 2 }}>
                  {u.lastError}
                </Txt>
              ) : null}
              <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm }}>
                {u.status === 'failed' || u.status === 'blocked' ? (
                  <Button compact kind="secondary" title="Retry" onPress={async () => {
                    await services.uploads.retry(u.id);
                    afterLocalChange(services);
                  }} />
                ) : null}
                <Button compact kind="ghost" title="Open PO" onPress={() => router.push({ pathname: '/po/[id]/documents', params: { id: u.itemLocalId } })} />
              </View>
            </View>
          ))}
        </Card>
      )}

      <SectionHeader title="Recent activity" />
      <Card>
        {!d?.log.length ? (
          <Txt muted>No messages.</Txt>
        ) : (
          d.log.map((l) => (
            <Txt key={l.id} size={12} color={l.level === 'error' ? t.danger : l.level === 'warn' ? t.warning : t.muted} style={{ marginBottom: 6 }}>
              {new Date(l.at).toLocaleString()} · {l.message}
            </Txt>
          ))
        )}
      </Card>
      <View style={{ height: spacing.xl }} />
    </ScrollView>
  );
}

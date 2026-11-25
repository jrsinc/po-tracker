import * as DocumentPicker from 'expo-document-picker';
import * as ImagePicker from 'expo-image-picker';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Platform, Pressable, ScrollView, View } from 'react-native';
import { confirm, notify } from '../../../src/components/confirm';
import { spacing, useTheme } from '../../../src/components/theme';
import { Badge, Banner, Button, Card, Chip, EmptyState, ErrorState, LoadingState, SectionHeader, Txt } from '../../../src/components/ui';
import { DOC_TYPES, ensureFileName } from '../../../src/documents/paths';
import type { PickedFile } from '../../../src/documents/types';
import { FolderMissingError } from '../../../src/documents/UploadEngine';
import { hasLocalCopy, openDocument } from '../../../src/documents/viewer';
import type { CachedDoc } from '../../../src/db/repositories/misc';
import type { UploadEntry } from '../../../src/db/repositories/uploads';
import { GraphError } from '../../../src/graph/http';
import { useAsync, useDataVersion, useServices, useSyncStatus } from '../../../src/hooks/services';
import { afterLocalChange } from '../../../src/services/coordinator';

function formatSize(n: number | null | undefined): string {
  if (!n && n !== 0) return '';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

const UPLOAD_LABEL: Record<UploadEntry['status'], string> = {
  pending: 'Pending upload',
  uploading: 'Uploading',
  done: 'Uploaded',
  failed: 'Failed',
  blocked: 'Blocked',
};

export default function Documents() {
  const t = useTheme();
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const services = useServices();
  const status = useSyncStatus();
  const version = useDataVersion();
  const [docType, setDocType] = useState<string>('customer_po');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: 'info' | 'danger' | 'warning'; text: string } | null>(null);
  const [opening, setOpening] = useState<string | null>(null);
  const [remoteTick, setRemoteTick] = useState(0);

  const local = useAsync(async () => {
    const item = await services.store.items.get(id);
    const folder = item ? await services.uploads.folderFor(item) : null;
    const docs = folder ? await services.store.docs.forFolder(folder) : [];
    const uploads = (await services.store.uploads.forItem(id)).filter((u) => u.status !== 'done');
    return { item, folder, docs, uploads };
  }, [services, id, version, remoteTick]);

  const folder = local.data?.folder ?? null;

  // Refresh the listing from SharePoint when online; the cached listing is shown meanwhile.
  const [listError, setListError] = useState<string | null>(null);
  const [listing, setListing] = useState(false);
  useEffect(() => {
    if (!folder || !status.online) return;
    let alive = true;
    (async () => {
      setListing(true);
      try {
        const drive = await services.getDrive();
        let children: Awaited<ReturnType<typeof drive.listChildren>> = [];
        try {
          children = await drive.listChildren(folder);
        } catch (e) {
          if (!(e instanceof GraphError && e.status === 404)) throw e; // folder not created yet
        }
        await services.store.docs.replaceFolder(
          folder,
          children
            .filter((c) => !c.folder)
            .map((c) => ({
              folder,
              driveItemId: c.id,
              name: c.name,
              size: c.size ?? null,
              webUrl: c.webUrl ?? null,
              mimeType: c.file?.mimeType ?? null,
              modifiedAt: c.lastModifiedDateTime ?? null,
              modifiedBy: c.lastModifiedBy?.user?.displayName ?? null,
            })),
        );
        if (alive) {
          setListError(null);
          setRemoteTick((x) => x + 1);
        }
      } catch (e) {
        if (alive) setListError(e instanceof Error ? e.message : String(e));
      } finally {
        if (alive) setListing(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [services, folder, status.online, version]);

  const enqueue = async (files: PickedFile[]) => {
    if (!files.length) return;
    setBusy(true);
    setMessage(null);
    try {
      for (const f of files) await services.uploads.enqueue(id, docType, f);
      setMessage({
        tone: 'info',
        text: status.online ? `Uploading ${files.length} file${files.length === 1 ? '' : 's'}…` : 'Saved. Will upload when you are back online.',
      });
      afterLocalChange(services);
    } catch (e) {
      setMessage({ tone: 'danger', text: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(false);
    }
  };

  const fromCamera = async () => {
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) return notify('Camera access needed', 'Allow camera access in Settings to photograph documents.');
    const r = await ImagePicker.launchCameraAsync({ mediaTypes: 'images', quality: 0.8 });
    if (r.canceled) return;
    await enqueue(r.assets.map((a) => toPicked(a.uri, a.fileName, a.mimeType, a.fileSize, a.file)));
  };

  const fromLibrary = async () => {
    if (Platform.OS !== 'web') {
      const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!perm.granted) return notify('Photo access needed', 'Allow photo access in Settings to upload images.');
    }
    const r = await ImagePicker.launchImageLibraryAsync({ mediaTypes: 'images', quality: 0.9, allowsMultipleSelection: true });
    if (r.canceled) return;
    await enqueue(r.assets.map((a) => toPicked(a.uri, a.fileName, a.mimeType, a.fileSize, a.file)));
  };

  const fromFiles = async () => {
    const r = await DocumentPicker.getDocumentAsync({ copyToCacheDirectory: true, multiple: true });
    if (r.canceled) return;
    await enqueue(r.assets.map((a) => toPicked(a.uri, a.name, a.mimeType, a.size, a.file)));
  };

  const open = async (doc: CachedDoc) => {
    setOpening(doc.driveItemId);
    try {
      if (!status.online && !hasLocalCopy(doc)) {
        notify('Offline', 'This file has not been downloaded to this device yet. Connect to open it.');
        return;
      }
      const uri = await openDocument(await services.getDrive(), doc);
      if (uri && uri !== doc.localUri) await services.store.docs.setLocalUri(doc.folder, doc.driveItemId, uri);
    } catch (e) {
      notify('Could not open file', e instanceof Error ? e.message : String(e));
    } finally {
      setOpening(null);
    }
  };

  const removeUpload = async (u: UploadEntry) => {
    if (await confirm('Remove from queue?', `“${u.targetName}” will not be uploaded.`, 'Remove', true)) {
      await services.uploads.cancel(u.id);
      afterLocalChange(services);
    }
  };

  if (local.loading && !local.data) return <LoadingState />;
  if (local.error) return <ErrorState message={local.error.message} onRetry={local.reload} />;
  const d = local.data!;
  if (!d.item) return <EmptyState title="PO not found" />;

  return (
    <ScrollView style={{ flex: 1, backgroundColor: t.bg }} contentContainerStyle={{ padding: spacing.lg, maxWidth: 860, width: '100%', alignSelf: 'center' }}>
      {!d.folder ? (
        <Banner
          tone="warning"
          text={new FolderMissingError().message}
          action={<Button compact kind="ghost" title="Edit PO" onPress={() => router.push({ pathname: '/po/[id]/edit', params: { id } })} />}
        />
      ) : (
        <Txt muted size={13} style={{ marginBottom: spacing.sm }}>
          SharePoint folder: {d.folder}
        </Txt>
      )}
      {message ? <Banner tone={message.tone} text={message.text} /> : null}
      {listError ? <Banner tone="danger" text={listError} /> : null}

      <SectionHeader title="Add document" />
      <Card>
        <Txt size={13} muted style={{ marginBottom: spacing.sm }}>
          Document type (added to the start of the file name)
        </Txt>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', rowGap: spacing.sm, marginBottom: spacing.md }}>
          {DOC_TYPES.map((dt) => (
            <Chip key={dt.key} label={dt.label} active={docType === dt.key} onPress={() => setDocType(dt.key)} />
          ))}
        </View>
        <View style={{ flexDirection: 'row', gap: spacing.sm, flexWrap: 'wrap' }}>
          {Platform.OS !== 'web' ? <Button title="Camera" onPress={fromCamera} disabled={!d.folder || busy} style={{ flexGrow: 1 }} /> : null}
          <Button title="Photos" kind="secondary" onPress={fromLibrary} disabled={!d.folder || busy} style={{ flexGrow: 1 }} />
          <Button title="Files" kind="secondary" onPress={fromFiles} disabled={!d.folder || busy} loading={busy} style={{ flexGrow: 1 }} />
        </View>
      </Card>

      {d.uploads.length ? (
        <>
          <SectionHeader title="Upload queue" />
          <Card style={{ paddingVertical: spacing.xs }}>
            {d.uploads.map((u) => {
              const prog = status.uploadProgress[u.id];
              const pct = prog && prog.total ? Math.floor((prog.sent / prog.total) * 100) : u.size ? Math.floor((u.bytesSent / u.size) * 100) : 0;
              return (
                <View key={u.id} style={{ paddingVertical: spacing.md, borderBottomWidth: 1, borderBottomColor: t.border }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
                    <Txt style={{ flex: 1 }} numberOfLines={1}>
                      {u.targetName}
                    </Txt>
                    <Badge
                      label={u.status === 'uploading' || prog ? `Uploading ${pct}%` : UPLOAD_LABEL[u.status]}
                      tone={u.status === 'failed' || u.status === 'blocked' ? 'danger' : u.status === 'uploading' ? 'info' : 'warning'}
                    />
                  </View>
                  <Txt muted size={12} style={{ marginTop: 2 }}>
                    {formatSize(u.size)}
                    {u.lastError && u.status !== 'uploading' ? ` · ${u.lastError}` : ''}
                  </Txt>
                  {(prog || u.status === 'uploading') && (
                    <View
                      accessibilityRole="progressbar"
                      accessibilityValue={{ min: 0, max: 100, now: pct }}
                      style={{ height: 4, backgroundColor: t.chip, borderRadius: 2, marginTop: 6 }}
                    >
                      <View style={{ width: `${pct}%`, height: 4, backgroundColor: t.primary, borderRadius: 2 }} />
                    </View>
                  )}
                  <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm }}>
                    {u.status === 'failed' || u.status === 'blocked' ? (
                      <Button compact kind="secondary" title="Retry" onPress={async () => {
                        await services.uploads.retry(u.id);
                        afterLocalChange(services);
                      }} />
                    ) : null}
                    {u.status !== 'uploading' ? <Button compact kind="ghost" title="Remove" onPress={() => removeUpload(u)} /> : null}
                  </View>
                </View>
              );
            })}
          </Card>
        </>
      ) : null}

      <SectionHeader title={`In SharePoint${listing ? ' · refreshing…' : ''}`} />
      {d.docs.length === 0 ? (
        <Card>
          <Txt muted>{d.folder ? (status.online ? 'No documents yet.' : 'No saved listing. Connect to see the files in SharePoint.') : 'No folder yet.'}</Txt>
        </Card>
      ) : (
        <Card style={{ paddingVertical: spacing.xs }}>
          {d.docs.map((doc) => (
            <Pressable
              key={doc.driveItemId}
              accessibilityRole="button"
              accessibilityLabel={`Open ${doc.name}`}
              onPress={() => open(doc)}
              style={({ pressed }) => ({ paddingVertical: spacing.md, borderBottomWidth: 1, borderBottomColor: t.border, opacity: pressed ? 0.6 : 1 })}
            >
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
                <Txt style={{ flex: 1 }} color={t.primary} numberOfLines={2}>
                  {doc.name}
                </Txt>
                {opening === doc.driveItemId ? <Badge label="Opening…" tone="info" /> : hasLocalCopy(doc) ? <Badge label="On device" /> : null}
              </View>
              <Txt muted size={12} style={{ marginTop: 2 }}>
                {[formatSize(doc.size), doc.modifiedBy, doc.modifiedAt ? new Date(doc.modifiedAt).toLocaleDateString() : ''].filter(Boolean).join(' · ')}
              </Txt>
            </Pressable>
          ))}
        </Card>
      )}
      <View style={{ height: spacing.xl * 2 }} />
    </ScrollView>
  );
}

function toPicked(
  uri: string,
  name: string | null | undefined,
  mimeType: string | null | undefined,
  size: number | null | undefined,
  blob: Blob | null | undefined,
): PickedFile {
  return { uri, name: ensureFileName(name, mimeType, Date.now()), mimeType: mimeType ?? null, size: size ?? null, blob: blob ?? undefined };
}

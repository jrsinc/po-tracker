import { Ionicons } from '@expo/vector-icons';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { confirm } from '../../../src/components/confirm';
import { FolderLink } from '../../../src/components/FolderLink';
import { FieldValueText, GroupTable, StatusPill } from '../../../src/components/fieldGrid';
import { spacing, useTheme } from '../../../src/components/theme';
import { Badge, Banner, Button, Card, EmptyState, ErrorState, LoadingState, Txt } from '../../../src/components/ui';
import type { SemanticKey } from '../../../src/config/schemaGroups';
import { useAsync, useDataVersion, useSchema, useServices } from '../../../src/hooks/services';
import { diffToGraph, displayValue, formFromFields, isEmpty, readRaw, validateForm, type FormValues, type ValidationErrors } from '../../../src/schema/values';
import { afterLocalChange } from '../../../src/services/coordinator';

export default function PODetail() {
  const t = useTheme();
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const services = useServices();
  const version = useDataVersion();
  const schemaState = useSchema();
  const [showEmpty, setShowEmpty] = useState(false);
  // In-place editing: the same table, with value cells turned into inputs.
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState<FormValues>({});
  const [initial, setInitial] = useState<FormValues>({});
  const [errors, setErrors] = useState<ValidationErrors>({});
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const people = useAsync(() => services.store.people.all(), [services]);

  const data = useAsync(async () => {
    const item = await services.store.items.get(id);
    const queued = await services.store.outbox.forItem(id);
    const uploads = await services.store.uploads.forItem(id);
    const folder = item ? await services.uploads.folderFor(item) : null;
    const docs = folder ? await services.store.docs.forFolder(folder) : [];
    return { item, queued, uploads, folder, docCount: docs.length };
  }, [services, id, version]);

  if (data.loading && !data.data) return <LoadingState />;
  if (data.error) return <ErrorState message={data.error.message} onRetry={data.reload} />;
  const d = data.data!;
  const schema = schemaState.data?.schema;
  const ctx = schemaState.data?.ctx;
  if (!d.item) {
    return <EmptyState title="PO not found" message="It may have been deleted." action={<Button title="Back to list" onPress={() => router.back()} />} />;
  }
  const item = d.item;
  const folderDef = schema?.bySemantic.folder;
  const folderText = folderDef && ctx ? displayValue(item.fields, folderDef, ctx) : '';
  const sem = (k: SemanticKey) => {
    const def = schema?.bySemantic[k];
    return def && ctx ? displayValue(item.fields, def, ctx) : '';
  };
  const keyDates = (['receivedDate', 'dispatchDate', 'expiry'] as SemanticKey[])
    .map((k) => schema?.bySemantic[k])
    .filter((def): def is NonNullable<typeof def> => !!def);
  // Shown in the summary card, so not repeated below (but editable in the table while editing).
  const inHero = new Set<SemanticKey>(['folder', 'line', 'status', 'customer', 'product', 'accountManager']);
  const tableGroups = (schema?.groups ?? []).map((g) => {
    const fields = editing ? g.fields : g.fields.filter((f) => !(f.semantic && inHero.has(f.semantic)));
    const filled = fields.filter((f) => !isEmpty(readRaw(item.fields, f)));
    return { key: g.key, title: g.title, all: fields, filled };
  });
  const hiddenEmpty = tableGroups.reduce((n, g) => n + g.all.length - g.filled.length, 0);

  const conflict = d.queued.find((q) => q.status === 'conflict');
  const failed = d.queued.find((q) => q.status === 'failed');
  const syncState = conflict ? 'Conflict' : failed ? 'Sync failed' : item.dirty ? 'Waiting to sync' : 'Synced';
  const pendingUploads = d.uploads.filter((u) => u.status !== 'done').length;

  const startEdit = () => {
    if (!schema || !ctx) return;
    const f = formFromFields(item.fields, schema, ctx);
    setInitial(f);
    setForm(f);
    setErrors({});
    setSaveError(null);
    setEditing(true);
  };
  const cancelEdit = () => {
    setEditing(false);
    setErrors({});
    setSaveError(null);
  };
  const saveEdit = async () => {
    if (!schema || !ctx) return;
    const errs = validateForm(form, schema);
    setErrors(errs);
    if (Object.keys(errs).length) {
      setSaveError(`Please fix ${Object.keys(errs).length} field${Object.keys(errs).length === 1 ? '' : 's'} marked in red.`);
      return;
    }
    const patch = diffToGraph(initial, form, schema, ctx);
    if (!Object.keys(patch).length) return cancelEdit();
    setSaving(true);
    setSaveError(null);
    try {
      await services.engine.updateItem(item.localId, patch);
      afterLocalChange(services);
      setEditing(false);
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };
  const editBar = (
    <View style={{ flexDirection: 'row', gap: spacing.sm, justifyContent: 'flex-end', marginBottom: spacing.md }}>
      <Button compact kind="ghost" title="Cancel" onPress={cancelEdit} />
      <Button compact title="Save changes" loading={saving} onPress={saveEdit} />
    </View>
  );

  const onDelete = async () => {
    const ok = await confirm(
      'Delete this PO?',
      item.spId ? 'It will be deleted from SharePoint at the next sync.' : 'This PO has not been uploaded yet and will be removed.',
      'Delete',
      true,
    );
    if (!ok) return;
    await services.engine.deleteItem(item.localId);
    afterLocalChange(services);
    router.back();
  };

  return (
    <>
      <Stack.Screen
        options={{
          title: folderText ? `Folder ${folderText}` : 'PO',
          headerRight: () =>
            editing ? (
              <View style={{ flexDirection: 'row', gap: 4 }}>
                <Button compact kind="ghost" title="Cancel" onPress={cancelEdit} />
                <Button compact title="Save" loading={saving} onPress={saveEdit} />
              </View>
            ) : (
              <Button compact kind="ghost" title="Edit" onPress={startEdit} />
            ),
        }}
      />
      <ScrollView style={{ flex: 1, backgroundColor: t.bg }} contentContainerStyle={{ padding: spacing.lg, maxWidth: 860, width: '100%', alignSelf: 'center' }}>
        {conflict ? (
          <Banner
            tone="danger"
            text="This PO was changed in SharePoint while you had unsynced edits."
            action={<Button compact kind="ghost" title="Resolve" onPress={() => router.push({ pathname: '/conflict/[outboxId]', params: { outboxId: String(conflict.id) } })} />}
          />
        ) : null}
        {failed ? <Banner tone="danger" text={`Could not sync: ${failed.lastError ?? 'unknown error'}. Retry from the Sync tab.`} /> : null}

        <Card style={{ padding: spacing.md }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm, flexWrap: 'wrap' }}>
            <Txt size={22} weight="800">
              {folderText ? `Folder ${folderText}` : 'PO'}
            </Txt>
            {sem('line') ? (
              <View style={{ backgroundColor: t.chipActive, borderRadius: 6, paddingHorizontal: 8, paddingVertical: 2 }}>
                <Txt size={12} weight="800" color={t.primary}>
                  LINE {sem('line')}
                </Txt>
              </View>
            ) : null}
            <View style={{ flex: 1 }} />
            <StatusPill status={sem('status')} large />
          </View>
          {sem('customer') ? (
            <Txt size={15} weight="600" muted style={{ marginTop: 6 }}>
              {sem('customer')}
            </Txt>
          ) : null}
          {sem('product') ? (
            <Txt size={16} weight="700" style={{ marginTop: 4 }}>
              {sem('product')}
            </Txt>
          ) : null}
          {sem('accountManager') ? (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 6 }}>
              <Ionicons name="person-circle-outline" size={16} color={t.muted} />
              <Txt size={13} muted>
                {sem('accountManager')}
              </Txt>
            </View>
          ) : null}
          {keyDates.length && ctx ? (
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.md }}>
              {keyDates.map((def) => (
                <View key={def.name} style={{ backgroundColor: t.chip, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 6, minWidth: 120 }}>
                  <Txt size={11} weight="600" muted>
                    {def.label}
                  </Txt>
                  <FieldValueText def={def} value={displayValue(item.fields, def, ctx)} />
                </View>
              ))}
            </View>
          ) : null}
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm, flexWrap: 'wrap', marginTop: spacing.md }}>
            <Badge label={syncState} tone={conflict || failed ? 'danger' : item.dirty ? 'warning' : 'success'} />
            {!item.spId ? <Badge label="Not yet in SharePoint" tone="warning" /> : null}
            <Txt muted size={12} style={{ flex: 1, minWidth: 180 }}>
              Modified{item.modifiedBy ? ` by ${item.modifiedBy}` : ''}
              {item.modifiedAt ? ` · ${new Date(item.modifiedAt).toLocaleString()}` : ''}
            </Txt>
          </View>
        </Card>

        <Pressable
          accessibilityRole="button"
          onPress={() => router.push({ pathname: '/po/[id]/documents', params: { id: item.localId } })}
          style={({ pressed }) => ({
            flexDirection: 'row',
            alignItems: 'center',
            gap: spacing.sm,
            padding: spacing.md,
            borderRadius: 12,
            borderWidth: 1,
            borderColor: t.border,
            backgroundColor: pressed ? t.chip : t.card,
            marginBottom: spacing.md,
          })}
        >
          <Ionicons name="folder-open" size={20} color={t.warning} />
          <Txt style={{ flex: 1 }} size={14}>
            {d.folder ? `Documents · ${d.docCount} file${d.docCount === 1 ? '' : 's'}` : 'Enter a Folder # to store documents.'}
            {pendingUploads ? <Txt size={13} color={t.warning}>{`  · ${pendingUploads} upload${pendingUploads === 1 ? '' : 's'} pending`}</Txt> : null}
          </Txt>
          {folderText ? <FolderLink folder={folderText} label="Open in SharePoint" /> : null}
          <Ionicons name="chevron-forward" size={18} color={t.muted} />
        </Pressable>

        {editing ? (
          <>
            <Banner tone="info" text="Editing: change the values in the table, then tap Save changes. Changes sync to SharePoint." />
            {saveError ? <Banner tone="danger" text={saveError} /> : null}
            {editBar}
          </>
        ) : null}

        {schema && ctx ? (
          <GroupTable
            values={item.fields}
            ctx={ctx}
            edit={
              editing
                ? { values: form, errors, people: people.data ?? [], onChange: (name, v) => setForm((p) => ({ ...p, [name]: v })) }
                : undefined
            }
            groups={tableGroups
              .map((g) => ({ key: g.key, title: g.title, fields: showEmpty || editing ? g.all : g.filled }))
              .filter((g) => g.fields.length)}
          />
        ) : null}

        {editing ? editBar : null}

        {schema && !editing && (showEmpty || hiddenEmpty) ? (
          <Pressable accessibilityRole="button" onPress={() => setShowEmpty((v) => !v)} style={{ alignSelf: 'center', padding: spacing.sm }}>
            <Txt size={13} color={t.primary}>
              {showEmpty ? 'Hide empty fields' : `Show ${hiddenEmpty} empty field${hiddenEmpty === 1 ? '' : 's'}`}
            </Txt>
          </Pressable>
        ) : null}

        <Button kind="danger" title="Delete PO" onPress={onDelete} disabled={editing} style={{ marginTop: spacing.xl, marginBottom: spacing.xl * 2 }} />
      </ScrollView>
    </>
  );
}

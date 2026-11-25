import { useRef, useState, type ComponentRef } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, View } from 'react-native';
import type { Person } from '../db/repositories/misc';
import type { Schema } from '../schema/columnMapper';
import { validateForm, type FormValues, type ValidationErrors } from '../schema/values';
import { FieldInput } from './FieldInput';
import { spacing, useTheme } from './theme';
import { Banner, Button, Card, SectionHeader } from './ui';

/** Add / edit form generated from the live SharePoint schema, grouped like the detail screen. */
export function POForm({
  schema,
  initial,
  people,
  submitLabel,
  onSubmit,
  onCancel,
}: {
  schema: Schema;
  initial: FormValues;
  people: Person[];
  submitLabel: string;
  onSubmit: (values: FormValues) => Promise<void>;
  onCancel: () => void;
}) {
  const t = useTheme();
  const [values, setValues] = useState<FormValues>(initial);
  const [errors, setErrors] = useState<ValidationErrors>({});
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const scroll = useRef<ComponentRef<typeof ScrollView>>(null);

  const submit = async () => {
    const errs = validateForm(values, schema);
    setErrors(errs);
    if (Object.keys(errs).length) {
      scroll.current?.scrollTo({ y: 0, animated: true });
      return;
    }
    setSaving(true);
    setSaveError(null);
    try {
      await onSubmit(values);
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  const errorCount = Object.keys(errors).length;

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView ref={scroll} style={{ flex: 1, backgroundColor: t.bg }} contentContainerStyle={{ padding: spacing.lg, maxWidth: 860, width: '100%', alignSelf: 'center' }} keyboardShouldPersistTaps="handled">
        {errorCount ? <Banner tone="danger" text={`Please fix ${errorCount} field${errorCount === 1 ? '' : 's'} below.`} /> : null}
        {saveError ? <Banner tone="danger" text={saveError} /> : null}
        {schema.groups.map((g) => {
          const editable = g.fields.filter((f) => !f.readOnly);
          if (!editable.length) return null;
          return (
            <View key={g.key}>
              <SectionHeader title={g.title} />
              <Card>
                {editable.map((f) => (
                  <FieldInput
                    key={f.name}
                    def={f}
                    value={values[f.name] ?? null}
                    error={errors[f.name]}
                    people={people}
                    onChange={(v) => {
                      setValues((prev) => ({ ...prev, [f.name]: v }));
                      if (errors[f.name]) setErrors(({ [f.name]: _, ...rest }) => rest);
                    }}
                  />
                ))}
              </Card>
            </View>
          );
        })}
        <View style={{ flexDirection: 'row', gap: spacing.md, marginTop: spacing.md, marginBottom: spacing.xl * 2 }}>
          <Button kind="secondary" title="Cancel" onPress={onCancel} style={{ flex: 1 }} />
          <Button title={submitLabel} onPress={submit} loading={saving} style={{ flex: 2 }} />
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

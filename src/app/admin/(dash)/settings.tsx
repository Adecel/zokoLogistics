import { useState } from 'react';
import { Text, View } from 'react-native';
import { RequirePermission } from '../../../components/admin/shell';
import { Badge, Button, Card, FieldRow, FormError, Notice, Page, TextField, Toggle, ui } from '../../../components/admin/ui';
import { LoadError, Loading } from '../../../components/load-state';
import { PAYMENT_METHODS, type PaymentMethod } from '../../../lib/admin/labels';
import { errorMessage, unwrap, useLoad } from '../../../lib/admin/use-load';
import { supabase } from '../../../lib/supabase';

type Json = string | number | boolean | null | Json[] | { [k: string]: Json };
type Setting = { key: string; value: Json; description: string | null; is_public: boolean };

type MethodSetting = {
  method: PaymentMethod;
  label: string;
  enabled: boolean;
  account_name: string;
  account_number: string;
  bank_name?: string;
  instructions: string;
};

const GROUPS: { title: string; keys: string[] }[] = [
  { title: 'Général', keys: ['city', 'timezone', 'utc_offset', 'currency_label', 'support_phone', 'support_whatsapp'] },
  {
    title: 'Règles de réservation',
    keys: ['min_days_ahead', 'max_days_ahead', 'booking_hours', 'included_fuel_liters', 'free_cancel_until_days_before', 'same_day_cancel_refund_pct', 'booking_conditions'],
  },
  { title: 'Courses immédiates', keys: ['rides_enabled', 'ride_hours', 'ride_pickup_minutes'] },
  { title: 'Zoko Partenaire', keys: ['partners_enabled', 'partner_share_pct_owner_drives', 'partner_share_pct_zoko_drives', 'partner_fee_note'] },
  { title: 'Paiement', keys: ['payment_methods', 'payment_note'] },
  { title: 'Textes de l’application', keys: ['welcome_tagline', 'home_subtitle', 'home_banner', 'pricing_note'] },
];

export default function SettingsScreen() {
  return (
    <RequirePermission permission="settings">
      <Settings />
    </RequirePermission>
  );
}

function Settings() {
  const { data, error, loading, reload } = useLoad(
    async () => unwrap(await supabase.from('app_settings').select('key, value, description, is_public').order('key')) as Setting[],
    [],
  );

  const known = new Set(GROUPS.flatMap((g) => g.keys));
  const others = (data ?? []).filter((s) => !known.has(s.key));

  return (
    <Page title="Paramètres" subtitle="Règles et textes de l’application, modifiables sans toucher au code" onRefresh={reload} refreshing={false}>
      <Notice text="Les changements s’appliquent aux clients à la prochaine ouverture de l’application." />
      {loading && <Loading />}
      {error && <LoadError message={error} onRetry={reload} />}
      {data &&
        [...GROUPS, { title: 'Autres', keys: others.map((s) => s.key) }].map((g) => {
          const items = g.keys.map((k) => data.find((s) => s.key === k)).filter((s): s is Setting => !!s);
          if (!items.length) return null;
          return (
            <Card key={g.title} title={g.title}>
              {items.map((s) => (
                <SettingEditor key={s.key + JSON.stringify(s.value)} setting={s} onSaved={reload} />
              ))}
            </Card>
          );
        })}
    </Page>
  );
}

// One editor per value type: text, number, yes/no, list, payment methods, or raw JSON
function SettingEditor({ setting, onSaved }: { setting: Setting; onSaved: () => void }) {
  const [value, setValue] = useState<Json>(setting.value);
  const [jsonText, setJsonText] = useState(() => JSON.stringify(setting.value, null, 2));
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [ok, setOk] = useState(false);

  const v = setting.value;
  const kind =
    setting.key === 'payment_methods'
      ? 'methods'
      : typeof v === 'string'
        ? 'text'
        : typeof v === 'number'
          ? 'number'
          : typeof v === 'boolean'
            ? 'bool'
            : Array.isArray(v) && v.every((x) => typeof x === 'string')
              ? 'list'
              : v && typeof v === 'object' && !Array.isArray(v) && Object.values(v).every((x) => typeof x === 'string' || typeof x === 'number')
                ? 'object'
                : 'json';

  async function save() {
    let next: Json = value;
    // Drop empty lines from lists
    if (kind === 'list') next = (value as string[]).map((x) => x.trim()).filter(Boolean);
    if (kind === 'json') {
      try {
        next = JSON.parse(jsonText);
      } catch {
        return setErr('JSON invalide.');
      }
    }
    setSaving(true);
    setErr(null);
    setOk(false);
    const { error } = await supabase.from('app_settings').update({ value: next }).eq('key', setting.key);
    setSaving(false);
    if (error) return setErr(errorMessage(error));
    setOk(true);
    onSaved();
  }

  const dirty = kind === 'json' ? jsonText !== JSON.stringify(setting.value, null, 2) : JSON.stringify(value) !== JSON.stringify(setting.value);
  const label = setting.description ?? setting.key;

  return (
    <View style={{ gap: 8, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: '#E3EAF2' }}>
      <View style={ui.between}>
        <Text style={ui.small}>{setting.key}</Text>
        {!setting.is_public && <Badge label="Interne" tone="neutral" />}
      </View>

      {kind === 'text' && <TextField label={label} value={value as string} onChangeText={setValue} multiline={(v as string).length > 60 || (v as string).includes('\n')} />}
      {kind === 'number' && (
        <TextField label={label} keyboardType="number-pad" value={String(value)} onChangeText={(t) => setValue(Number(t.replace(/[^\d.-]/g, '')) || 0)} />
      )}
      {kind === 'bool' && <Toggle label={label} value={value as boolean} onChange={setValue} />}
      {kind === 'list' && (
        <TextField
          label={label}
          multiline
          value={(value as string[]).join('\n')}
          onChangeText={(t) => setValue(t.split('\n'))}
          hint="Une ligne par élément"
        />
      )}
      {kind === 'object' && (
        <>
          <Text style={ui.strong}>{label}</Text>
          <FieldRow>
            {Object.entries(value as Record<string, string | number>).map(([k, x]) => (
              <TextField
                key={k}
                label={k}
                value={String(x)}
                keyboardType={typeof x === 'number' ? 'number-pad' : undefined}
                onChangeText={(t) => setValue({ ...(value as Record<string, Json>), [k]: typeof x === 'number' ? Number(t) || 0 : t })}
              />
            ))}
          </FieldRow>
        </>
      )}
      {kind === 'methods' && <MethodsEditor value={value as MethodSetting[]} onChange={setValue} />}
      {kind === 'json' && <TextField label={label} multiline value={jsonText} onChangeText={setJsonText} />}

      <FormError message={err} />
      <View style={ui.row}>
        <Button
          title="Enregistrer"
          small
          disabled={!dirty}
          loading={saving}
          onPress={save}
        />
        {ok && !dirty && <Text style={[ui.small, { color: '#22A55B' }]}>Enregistré ✓</Text>}
      </View>
    </View>
  );
}

function MethodsEditor({ value, onChange }: { value: MethodSetting[]; onChange: (v: MethodSetting[]) => void }) {
  const set = (i: number, patch: Partial<MethodSetting>) => onChange(value.map((m, j) => (j === i ? { ...m, ...patch } : m)));
  return (
    <View style={{ gap: 12 }}>
      <Text style={ui.strong}>Moyens de paiement affichés aux clients</Text>
      {value.map((m, i) => (
        <View key={m.method} style={{ gap: 8, padding: 12, borderRadius: 12, borderWidth: 1, borderColor: '#E3EAF2' }}>
          <Toggle label={PAYMENT_METHODS[m.method] ?? m.method} value={m.enabled} onChange={(enabled) => set(i, { enabled })} />
          <FieldRow>
            <TextField label="Nom affiché" value={m.label} onChangeText={(label) => set(i, { label })} />
            {m.method !== 'cash' && <TextField label={m.method === 'bank_transfer' ? 'N° de compte' : 'Numéro'} value={m.account_number} onChangeText={(account_number) => set(i, { account_number })} />}
          </FieldRow>
          {m.method !== 'cash' && (
            <FieldRow>
              <TextField label="Titulaire" value={m.account_name} onChangeText={(account_name) => set(i, { account_name })} />
              {m.method === 'bank_transfer' && <TextField label="Banque" value={m.bank_name ?? ''} onChangeText={(bank_name) => set(i, { bank_name })} />}
            </FieldRow>
          )}
          <TextField label="Instructions" multiline value={m.instructions} onChangeText={(instructions) => set(i, { instructions })} />
        </View>
      ))}
    </View>
  );
}

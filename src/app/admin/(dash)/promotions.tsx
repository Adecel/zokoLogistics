import { useState } from 'react';
import { Text, View } from 'react-native';
import { RequirePermission } from '../../../components/admin/shell';
import {
  Badge,
  Button,
  Card,
  Choice,
  Empty,
  FieldRow,
  FormError,
  ListRow,
  Page,
  Sheet,
  TextField,
  Toggle,
  ui,
  useConfirm,
} from '../../../components/admin/ui';
import { LoadError, Loading } from '../../../components/load-state';
import { formatDate, formatMoney } from '../../../lib/admin/labels';
import { can } from '../../../lib/admin/roles';
import { errorMessage, unwrap, useLoad } from '../../../lib/admin/use-load';
import { useAuth } from '../../../lib/auth';
import { supabase } from '../../../lib/supabase';

type Promo = {
  id: string;
  code: string;
  description: string | null;
  discount_type: 'percent' | 'fixed';
  discount_value: number;
  starts_at: string;
  ends_at: string | null;
  max_uses: number | null;
  is_active: boolean;
};

type Form = {
  id?: string;
  code: string;
  description: string;
  discount_type: 'percent' | 'fixed';
  discount_value: string;
  starts: string;
  ends: string;
  max_uses: string;
  is_active: boolean;
};

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const toDay = (iso: string | null) => (iso ? iso.slice(0, 10) : '');

function promoState(p: Promo, uses: number): { label: string; tone: 'success' | 'neutral' | 'warning' | 'danger' } {
  const now = Date.now();
  if (!p.is_active) return { label: 'Désactivé', tone: 'neutral' };
  if (new Date(p.starts_at).getTime() > now) return { label: 'À venir', tone: 'warning' };
  if (p.ends_at && new Date(p.ends_at).getTime() <= now) return { label: 'Expiré', tone: 'danger' };
  if (p.max_uses != null && uses >= p.max_uses) return { label: 'Épuisé', tone: 'danger' };
  return { label: 'Actif', tone: 'success' };
}

export default function PromotionsScreen() {
  return (
    <RequirePermission permission="promotions">
      <Promotions />
    </RequirePermission>
  );
}

function Promotions() {
  const { profile } = useAuth();
  const confirm = useConfirm();
  const [form, setForm] = useState<Form | null>(null);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const { data, error, loading, reload } = useLoad(async () => {
    const [promos, used] = await Promise.all([
      supabase.from('promotions').select('*').order('starts_at', { ascending: false }).then(unwrap),
      supabase.from('reservations').select('promotion_id').not('promotion_id', 'is', null).not('status', 'in', '(cancelled,rejected)').then(unwrap),
    ]);
    const uses = new Map<string, number>();
    for (const r of used as { promotion_id: string }[]) uses.set(r.promotion_id, (uses.get(r.promotion_id) ?? 0) + 1);
    return { promos: promos as Promo[], uses };
  }, []);

  function open(p?: Promo) {
    setErr(null);
    setForm(
      p
        ? {
            id: p.id,
            code: p.code,
            description: p.description ?? '',
            discount_type: p.discount_type,
            discount_value: String(p.discount_value),
            starts: toDay(p.starts_at),
            ends: toDay(p.ends_at),
            max_uses: p.max_uses ? String(p.max_uses) : '',
            is_active: p.is_active,
          }
        : { code: '', description: '', discount_type: 'percent', discount_value: '', starts: new Date().toISOString().slice(0, 10), ends: '', max_uses: '', is_active: true },
    );
  }

  async function save() {
    if (!form) return;
    const code = form.code.trim().toUpperCase();
    const value = parseInt(form.discount_value, 10);
    if (code.length < 3) return setErr('Code d’au moins 3 caractères.');
    if (!value || value <= 0 || (form.discount_type === 'percent' && value > 100)) return setErr('Valeur de réduction invalide.');
    if (!DATE_RE.test(form.starts) || (form.ends && !DATE_RE.test(form.ends))) return setErr('Dates au format AAAA-MM-JJ.');
    if (form.ends && form.ends <= form.starts) return setErr('La date de fin doit être après la date de début.');
    setSaving(true);
    setErr(null);
    const values = {
      code,
      description: form.description.trim() || null,
      discount_type: form.discount_type,
      discount_value: value,
      starts_at: `${form.starts}T00:00:00+01:00`,
      ends_at: form.ends ? `${form.ends}T23:59:59+01:00` : null,
      max_uses: form.max_uses ? parseInt(form.max_uses, 10) : null,
      is_active: form.is_active,
    };
    const { error: e } = form.id ? await supabase.from('promotions').update(values).eq('id', form.id) : await supabase.from('promotions').insert(values);
    setSaving(false);
    if (e) return setErr(errorMessage(e, 'Enregistrement impossible.'));
    setForm(null);
    reload();
  }

  async function remove(p: Promo) {
    const ok = await confirm({
      title: `Supprimer ${p.code}`,
      message: 'Les réservations qui l’ont utilisé gardent leur réduction. Pour simplement l’arrêter, désactivez-le.',
      danger: true,
      confirmLabel: 'Supprimer',
    });
    if (ok === null) return;
    const { error: e } = await supabase.from('promotions').delete().eq('id', p.id);
    if (e) setErr(errorMessage(e));
    else reload();
  }

  return (
    <Page
      title="Promotions"
      subtitle="Codes promo proposés aux clients"
      onRefresh={reload}
      refreshing={false}
      actions={<Button title="Nouveau code" icon="add" onPress={() => open()} />}
    >
      {loading && <Loading />}
      {error && <LoadError message={error} onRetry={reload} />}
      {!form && <FormError message={err} />}
      {data && (
        <Card>
          {data.promos.length === 0 && <Empty icon="pricetag-outline" text="Aucun code promo." />}
          {data.promos.map((p) => {
            const uses = data.uses.get(p.id) ?? 0;
            const st = promoState(p, uses);
            return (
              <ListRow key={p.id} onPress={() => open(p)}>
                <View style={ui.flex1}>
                  <Text style={ui.strong}>
                    {p.code} · {p.discount_type === 'percent' ? `${p.discount_value} %` : formatMoney(p.discount_value)}
                  </Text>
                  <Text style={ui.small}>
                    {p.description ? `${p.description} · ` : ''}du {formatDate(p.starts_at)}
                    {p.ends_at ? ` au ${formatDate(p.ends_at)}` : ', sans fin'} · utilisé {uses}
                    {p.max_uses ? ` / ${p.max_uses}` : ''} fois
                  </Text>
                </View>
                <Badge label={st.label} tone={st.tone} />
                {can(profile?.role, 'delete') && <Button title="Supprimer" small variant="ghost" icon="trash-outline" onPress={() => remove(p)} />}
              </ListRow>
            );
          })}
        </Card>
      )}

      <Sheet
        visible={!!form}
        title={form?.id ? `Modifier ${form.code}` : 'Nouveau code promo'}
        onClose={() => setForm(null)}
        footer={
          <>
            <Button title="Annuler" variant="ghost" onPress={() => setForm(null)} />
            <Button title="Enregistrer" onPress={save} loading={saving} />
          </>
        }
      >
        {form && (
          <>
            <FieldRow>
              <TextField label="Code" placeholder="BIENVENUE" autoCapitalize="characters" value={form.code} onChangeText={(t) => setForm({ ...form, code: t })} />
              <TextField label="Description (visible par le client)" value={form.description} onChangeText={(t) => setForm({ ...form, description: t })} />
            </FieldRow>
            <Choice
              label="Type de réduction"
              options={[
                { value: 'percent', label: 'Pourcentage' },
                { value: 'fixed', label: 'Montant fixe (FCFA)' },
              ]}
              value={form.discount_type}
              onChange={(v) => setForm({ ...form, discount_type: v })}
            />
            <FieldRow>
              <TextField
                label={form.discount_type === 'percent' ? 'Réduction (%)' : 'Réduction (FCFA)'}
                keyboardType="number-pad"
                value={form.discount_value}
                onChangeText={(t) => setForm({ ...form, discount_value: t.replace(/\D/g, '') })}
              />
              <TextField
                label="Utilisations max (facultatif)"
                keyboardType="number-pad"
                value={form.max_uses}
                onChangeText={(t) => setForm({ ...form, max_uses: t.replace(/\D/g, '') })}
              />
            </FieldRow>
            <FieldRow>
              <TextField label="Début" placeholder="AAAA-MM-JJ" value={form.starts} onChangeText={(t) => setForm({ ...form, starts: t })} />
              <TextField label="Fin (facultatif)" placeholder="AAAA-MM-JJ" value={form.ends} onChangeText={(t) => setForm({ ...form, ends: t })} />
            </FieldRow>
            <Toggle label="Actif" value={form.is_active} onChange={(v) => setForm({ ...form, is_active: v })} />
            <FormError message={err} />
          </>
        )}
      </Sheet>
    </Page>
  );
}

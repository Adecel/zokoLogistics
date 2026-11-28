import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Linking, Text, View } from 'react-native';
import { RequirePermission } from '../../../../components/admin/shell';
import {
  Avatar,
  Badge,
  Button,
  Card,
  Empty,
  FieldRow,
  FormError,
  Grid,
  ListRow,
  Notice,
  Page,
  Stat,
  TextField,
  Toggle,
  ui,
  useConfirm,
} from '../../../../components/admin/ui';
import { LoadError, Loading } from '../../../../components/load-state';
import { formatDate, formatDateTime, formatMoney, paymentState, RESERVATION_STATUS, type ReservationStatus } from '../../../../lib/admin/labels';
import { can, ROLE_LABELS, type Role } from '../../../../lib/admin/roles';
import { errorMessage, unwrap, useLoad } from '../../../../lib/admin/use-load';
import { useAuth } from '../../../../lib/auth';
import { supabase } from '../../../../lib/supabase';

type Client = {
  id: string;
  full_name: string;
  phone: string | null;
  email: string | null;
  role: Role;
  is_active: boolean;
  created_at: string;
};

type Res = {
  id: string;
  reference: string;
  status: ReservationStatus;
  start_at: string;
  duration_hours: number;
  model_name: string;
  amount_due: number;
  amount_paid: number;
  balance: number;
};

export default function ClientScreen() {
  return (
    <RequirePermission permission="clients">
      <ClientDetail />
    </RequirePermission>
  );
}

function ClientDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { profile } = useAuth();
  // Reservation history and amounts: not for the manager
  const seeReservations = can(profile?.role, 'reservations');
  const { data, error, loading, reload } = useLoad(async () => {
    const [client, reservations] = await Promise.all([
      supabase.from('profiles').select('id, full_name, phone, email, role, is_active, created_at').eq('id', id).maybeSingle().then(unwrap),
      !seeReservations
        ? Promise.resolve([])
        : supabase
        .from('reservation_details')
        .select('id, reference, status, start_at, duration_hours, model_name, amount_due, amount_paid, balance')
        .eq('client_id', id)
        .order('start_at', { ascending: false })
        .then(unwrap),
    ]);
    return { client: client as Client | null, reservations: reservations as Res[] };
  }, [id]);

  if (loading) return <Loading />;
  if (error) return <LoadError message={error} onRetry={reload} />;
  if (!data?.client) return <LoadError message="Client introuvable." />;

  const c = data.client;
  const res = data.reservations;
  const done = res.filter((r) => r.status === 'completed').length;
  const cancelled = res.filter((r) => ['cancelled', 'no_show', 'rejected'].includes(r.status)).length;
  const spent = res.reduce((s, r) => s + r.amount_paid, 0);
  const owed = res.filter((r) => !['cancelled', 'rejected'].includes(r.status)).reduce((s, r) => s + Math.max(0, r.balance), 0);

  return (
    <Page
      title={c.full_name}
      subtitle={`${ROLE_LABELS[c.role]} · inscrit le ${formatDate(c.created_at)}`}
      onRefresh={reload}
      refreshing={false}
      actions={<Button title="Retour" variant="ghost" icon="arrow-back" onPress={() => (router.canGoBack() ? router.back() : router.replace('/admin/clients'))} />}
    >
      {seeReservations && (
      <Grid min={200}>
        <Stat label="Réservations" value={res.length} icon="calendar-outline" />
        <Stat label="Terminées" value={done} icon="flag-outline" tone="success" />
        <Stat label="Annulées / absences" value={cancelled} icon="close-circle-outline" tone={cancelled ? 'warning' : 'neutral'} />
        <Stat label="Payé" value={formatMoney(spent)} icon="wallet-outline" tone="success" hint={owed ? `Reste dû : ${formatMoney(owed)}` : undefined} />
      </Grid>
      )}

      <Grid min={340}>
        <ClientForm key={`${c.id}-${c.is_active}`} client={c} onSaved={reload} />
        {seeReservations && (
        <Card title="Réservations">
          {res.length === 0 && <Empty icon="calendar-outline" text="Aucune réservation." />}
          {res.map((r) => {
            const st = RESERVATION_STATUS[r.status];
            const ps = paymentState(r);
            return (
              <ListRow key={r.id} onPress={() => router.push(`/admin/reservations/${r.id}`)}>
                <View style={ui.flex1}>
                  <Text style={ui.strong}>
                    {r.reference} · {formatMoney(r.amount_due)}
                  </Text>
                  <Text style={ui.small}>
                    {formatDateTime(r.start_at)} · {r.duration_hours} h · {r.model_name}
                  </Text>
                </View>
                <View style={{ alignItems: 'flex-end', gap: 6 }}>
                  <Badge label={st.label} tone={st.tone} />
                  <Badge label={ps.label} tone={ps.tone} />
                </View>
              </ListRow>
            );
          })}
        </Card>
        )}
      </Grid>
    </Page>
  );
}

function ClientForm({ client: c, onSaved }: { client: Client; onSaved: () => void }) {
  const { profile } = useAuth();
  const confirm = useConfirm();
  const manage = can(profile?.role, 'clients.manage');
  const [fullName, setFullName] = useState(c.full_name);
  const [phone, setPhone] = useState(c.phone ?? '');
  const [active, setActive] = useState(c.is_active);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  async function save() {
    if (fullName.trim().length < 2) return setErr('Nom trop court.');
    setSaving(true);
    setErr(null);
    setInfo(null);
    const { error } = await supabase
      .from('profiles')
      .update({ full_name: fullName.trim(), phone: phone.trim() || null, is_active: active })
      .eq('id', c.id);
    setSaving(false);
    if (error) return setErr(errorMessage(error, 'Enregistrement impossible.'));
    setInfo('Enregistré.');
    onSaved();
  }

  async function remove() {
    const ok = await confirm({
      title: 'Supprimer ce client',
      message:
        'Sans réservation, le compte est supprimé. Avec un historique, il est anonymisé et bloqué (la comptabilité garde les réservations). Ses demandes en attente sont annulées.',
      danger: true,
      confirmLabel: 'Supprimer',
    });
    if (ok === null) return;
    const { data, error } = await supabase.rpc('admin_delete_user', { p_user_id: c.id });
    if (error) return setErr(errorMessage(error, 'Suppression impossible.'));
    if (data === 'anonymized') onSaved();
    else router.replace('/admin/clients');
  }

  return (
    <Card title="Compte" actions={can(profile?.role, 'delete') ? <Button title="Supprimer" small variant="danger" icon="trash-outline" onPress={remove} /> : undefined}>
      <View style={ui.row}>
        <Avatar name={c.full_name} size={56} />
        <View style={ui.flex1}>
          <Text style={ui.muted}>{c.email ?? 'Pas d’e-mail'}</Text>
          {!c.is_active && <Badge label="Compte désactivé" tone="danger" />}
        </View>
      </View>
      <FieldRow>
        <TextField label="Nom complet" value={fullName} onChangeText={setFullName} editable={manage} />
        <TextField label="Téléphone" keyboardType="phone-pad" value={phone} onChangeText={setPhone} editable={manage} />
      </FieldRow>
      {c.phone ? (
        <View style={ui.wrap}>
          <Button title="Appeler" small variant="outline" icon="call-outline" onPress={() => Linking.openURL(`tel:${c.phone!.replace(/\s/g, '')}`)} />
          <Button title="WhatsApp" small variant="outline" icon="logo-whatsapp" onPress={() => Linking.openURL(`https://wa.me/${c.phone!.replace(/\D/g, '')}`)} />
        </View>
      ) : null}
      {manage && (
        <>
          <Toggle label="Compte actif" hint="Désactivé = le client ne peut plus réserver" value={active} onChange={setActive} />
          <FormError message={err} />
          {info && <Notice tone="success" text={info} />}
          <View style={ui.row}>
            <Button title="Enregistrer" icon="save-outline" onPress={save} loading={saving} />
          </View>
        </>
      )}
    </Card>
  );
}

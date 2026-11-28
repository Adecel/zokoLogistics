import Ionicons from '@expo/vector-icons/Ionicons';
import { Image } from 'expo-image';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import { RequirePermission } from '../../../../components/admin/shell';
import {
  Badge,
  Button,
  Card,
  Choice,
  Empty,
  FieldRow,
  FormError,
  Grid,
  InfoRow,
  ListRow,
  Notice,
  Page,
  Sheet,
  TextField,
  ui,
  useConfirm,
} from '../../../../components/admin/ui';
import { LoadError, Loading } from '../../../../components/load-state';
import { Colors } from '../../../../constants/zoko';
import {
  CHARGE_TYPES,
  formatDateTime,
  formatMoney,
  PAYMENT_METHODS,
  PAYMENT_STATUS,
  paymentState,
  RESERVATION_STATUS,
  type PaymentMethod,
  type PaymentStatus,
  type ReservationStatus,
} from '../../../../lib/admin/labels';
import { can } from '../../../../lib/admin/roles';
import { errorMessage, unwrap, useLoad } from '../../../../lib/admin/use-load';
import { useAuth } from '../../../../lib/auth';
import { supabase } from '../../../../lib/supabase';

type Details = {
  id: string;
  reference: string;
  status: ReservationStatus;
  start_at: string;
  end_at: string;
  duration_hours: number;
  pickup_address: string;
  dropoff_address: string | null;
  contact_phone: string;
  client_id: string;
  client_name: string;
  client_phone: string | null;
  model_id: string;
  model_name: string;
  vehicle_id: string | null;
  plate_number: string | null;
  driver_id: string | null;
  driver_name: string | null;
  driver_phone: string | null;
  with_driver: boolean;
  client_license_number: string | null;
  base_price: number;
  discount_amount: number;
  promotion_code: string | null;
  extra_charges: number;
  amount_due: number;
  amount_paid: number;
  amount_refunded: number;
  balance: number;
  created_at: string;
  confirmed_at: string | null;
  cancelled_at: string | null;
  cancellation_reason: string | null;
  actual_start_at: string | null;
  actual_end_at: string | null;
  kind: 'rental' | 'ride';
  from_zone_name: string | null;
  to_zone_name: string | null;
  ride_city: string | null;
  ride_minutes: number | null;
  driven_by_owner: boolean;
  partner_share_pct: number | null;
  owner_contact: { name: string; phone: string | null } | null;
};

type Extra = { client_notes: string | null; internal_notes: string | null };

type Payment = {
  id: string;
  kind: 'payment' | 'refund';
  method: PaymentMethod;
  status: PaymentStatus;
  amount: number;
  transaction_reference: string | null;
  payer_phone: string | null;
  proof_path: string | null;
  notes: string | null;
  created_at: string;
  verified_at: string | null;
};

type Charge = { id: string; type: keyof typeof CHARGE_TYPES; description: string | null; amount: number; created_at: string };

type History = {
  id: number;
  from_status: ReservationStatus | null;
  to_status: ReservationStatus;
  note: string | null;
  changed_at: string;
  changer: { full_name: string } | null;
};

export default function ReservationDetailScreen() {
  return (
    <RequirePermission permission="reservations">
      <ReservationDetail />
    </RequirePermission>
  );
}

function ReservationDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { profile } = useAuth();
  const role = profile?.role;
  const confirm = useConfirm();

  const { data, error, loading, reload } = useLoad(async () => {
    const [details, extra, payments, charges, history] = await Promise.all([
      supabase.from('reservation_details').select('*').eq('id', id).maybeSingle().then(unwrap),
      supabase.from('reservations').select('client_notes, internal_notes').eq('id', id).maybeSingle().then(unwrap),
      supabase
        .from('payments')
        .select('id, kind, method, status, amount, transaction_reference, payer_phone, proof_path, notes, created_at, verified_at')
        .eq('reservation_id', id)
        .order('created_at')
        .then(unwrap),
      supabase.from('reservation_charges').select('id, type, description, amount, created_at').eq('reservation_id', id).order('created_at').then(unwrap),
      supabase
        .from('reservation_status_history')
        .select('id, from_status, to_status, note, changed_at, changer:changed_by(full_name)')
        .eq('reservation_id', id)
        .order('changed_at', { ascending: false })
        .then(unwrap),
    ]);
    return {
      r: details as Details | null,
      extra: extra as Extra | null,
      payments: payments as Payment[],
      charges: charges as Charge[],
      history: history as unknown as History[],
    };
  }, [id]);

  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [assignOpen, setAssignOpen] = useState(false);
  const [paymentSheet, setPaymentSheet] = useState<'payment' | 'refund' | null>(null);
  const [chargeOpen, setChargeOpen] = useState(false);
  const [proofUrl, setProofUrl] = useState<string | null>(null);

  if (loading) return <Loading />;
  if (error) return <LoadError message={error} onRetry={reload} />;
  if (!data?.r) return <LoadError message="Réservation introuvable." />;

  const r = data.r;
  const st = RESERVATION_STATUS[r.status];
  const ps = paymentState(r);
  const operate = can(role, 'reservations.operate');
  const finance = can(role, 'payments');
  const isAdmin = can(role, 'delete');
  const ride = r.kind === 'ride';

  async function run(action: () => PromiseLike<{ error: unknown }>, fallback?: string) {
    setBusy(true);
    setActionError(null);
    const { error: e } = await action();
    setBusy(false);
    if (e) {
      setActionError(errorMessage(e, fallback));
      return false;
    }
    reload();
    return true;
  }

  async function setStatus(status: ReservationStatus, opts: { title: string; message?: string; reason?: boolean; danger?: boolean }) {
    const answer = await confirm({
      title: opts.title,
      message: opts.message,
      danger: opts.danger,
      confirmLabel: opts.title,
      input: opts.reason ? { label: 'Motif (visible par le client)', required: true } : undefined,
    });
    if (answer === null) return;
    await run(() =>
      supabase
        .from('reservations')
        .update({ status, ...(opts.reason && { cancellation_reason: answer }) })
        .eq('id', r.id),
    );
  }

  async function deleteReservation() {
    const ok = await confirm({
      title: 'Supprimer la réservation',
      message: `${r.reference} sera supprimée définitivement avec ses frais et son historique. Les paiements doivent être supprimés avant.`,
      danger: true,
      confirmLabel: 'Supprimer',
    });
    if (ok === null) return;
    if (await run(() => supabase.from('reservations').delete().eq('id', r.id))) router.replace('/admin/reservations');
  }

  async function setPaymentStatus(p: Payment, status: PaymentStatus) {
    const ok = await confirm({
      title: status === 'succeeded' ? 'Valider ce paiement' : 'Refuser ce paiement',
      message: `${formatMoney(p.amount)} · ${PAYMENT_METHODS[p.method]}${
        status === 'succeeded' ? '. Confirmez que l’argent a bien été reçu.' : '. Le client sera invité à payer à nouveau.'
      }`,
      danger: status !== 'succeeded',
      confirmLabel: status === 'succeeded' ? 'Argent reçu' : 'Refuser',
    });
    if (ok === null) return;
    await run(() => supabase.from('payments').update({ status }).eq('id', p.id));
  }

  async function deletePayment(p: Payment) {
    const ok = await confirm({ title: 'Supprimer ce paiement', message: formatMoney(p.amount), danger: true, confirmLabel: 'Supprimer' });
    if (ok !== null) await run(() => supabase.from('payments').delete().eq('id', p.id));
  }

  async function deleteCharge(c: Charge) {
    const ok = await confirm({ title: 'Supprimer ces frais', message: formatMoney(c.amount), danger: true, confirmLabel: 'Supprimer' });
    if (ok !== null) await run(() => supabase.from('reservation_charges').delete().eq('id', c.id));
  }

  async function openProof(path: string) {
    const { data: signed, error: e } = await supabase.storage.from('payment-proofs').createSignedUrl(path, 600);
    if (e || !signed) setActionError(errorMessage(e, 'Impossible d’ouvrir la preuve.'));
    else setProofUrl(signed.signedUrl);
  }

  return (
    <Page
      title={r.reference}
      subtitle={`Créée le ${formatDateTime(r.created_at)}`}
      onRefresh={reload}
      refreshing={false}
      actions={
        <>
          <Button title="Retour" variant="ghost" icon="arrow-back" onPress={() => (router.canGoBack() ? router.back() : router.replace('/admin/reservations'))} />
          {isAdmin && <Button title="Supprimer" variant="danger" icon="trash-outline" onPress={deleteReservation} small />}
        </>
      }
    >
      <View style={ui.wrap}>
        <Badge label={st.label} tone={st.tone} />
        <Badge label={ps.label} tone={ps.tone} />
        {ride ? <Badge label="Course immédiate" tone="info" /> : <Badge label={r.with_driver ? 'Avec chauffeur' : 'Sans chauffeur'} tone="info" />}
      </View>

      <FormError message={actionError} />

      {/* Actions by status */}
      {operate && ['pending', 'confirmed', 'in_progress'].includes(r.status) && (
        <Card title="Actions">
          {ride && r.status === 'pending' && (
            <Notice
              tone="info"
              text={`Course immédiate : attribuez un véhicule et un chauffeur tout de suite. Le client paie au chauffeur à l’arrivée ; ${finance ? 'encaissez ensuite avec « Encaisser »' : 'Finance enregistre ensuite le paiement'}.`}
            />
          )}
          {!ride && r.status === 'pending' && r.balance > 0 && (
            <Notice tone="warning" text={`Paiement non soldé : reste ${formatMoney(r.balance)}. Vérifiez les paiements avant de confirmer.`} />
          )}
          <View style={ui.wrap}>
            {r.status === 'pending' && (
              <>
                <Button title="Confirmer et attribuer" icon="checkmark-circle-outline" variant="success" onPress={() => setAssignOpen(true)} loading={busy} />
                <Button title="Refuser" icon="close-circle-outline" variant="danger" onPress={() => setStatus('rejected', { title: 'Refuser', reason: true, danger: true })} />
              </>
            )}
            {r.status === 'confirmed' && (
              <>
                <Button
                  title={ride ? 'Démarrer la course' : 'Démarrer la location'}
                  icon="play-outline"
                  variant="success"
                  onPress={() =>
                    setStatus('in_progress', {
                      title: ride ? 'Démarrer la course' : 'Démarrer la location',
                      message: ride ? 'Le chauffeur a pris le client.' : 'Le client a pris le véhicule.',
                    })
                  }
                  loading={busy}
                />
                <Button title="Changer véhicule / chauffeur" icon="swap-horizontal-outline" variant="outline" onPress={() => setAssignOpen(true)} />
                <Button title="Client absent" icon="alert-circle-outline" variant="outline" onPress={() => setStatus('no_show', { title: 'Client absent', message: 'Le client ne s’est pas présenté.', danger: true })} />
              </>
            )}
            {r.status === 'in_progress' && (
              <Button
                title={ride ? 'Terminer la course' : 'Terminer la location'}
                icon="flag-outline"
                variant="success"
                onPress={() =>
                  setStatus('completed', {
                    title: ride ? 'Terminer la course' : 'Terminer la location',
                    message: ride
                      ? `Le client est arrivé. ${formatMoney(Math.max(0, r.balance))} à encaisser par le chauffeur, puis à enregistrer par Finance.`
                      : 'Le véhicule a été rendu. Ajoutez d’éventuels frais (dépassement, carburant) avant ou après.',
                  })
                }
                loading={busy}
              />
            )}
            {(r.status === 'pending' || r.status === 'confirmed') && (
              <Button title="Annuler" icon="ban-outline" variant="danger" onPress={() => setStatus('cancelled', { title: ride ? 'Annuler la course' : 'Annuler la réservation', reason: true, danger: true })} />
            )}
          </View>
        </Card>
      )}

      <Grid min={300}>
        <Card title={ride ? 'Course' : 'Location'}>
          {ride && <InfoRow label="Trajet" value={`${r.from_zone_name} → ${r.to_zone_name} · ${r.ride_city ?? ''}`} />}
          <InfoRow label={ride ? 'Commandée' : 'Début'} value={formatDateTime(r.start_at)} />
          <InfoRow
            label={ride ? 'Véhicule bloqué jusqu’à' : 'Fin prévue'}
            value={ride ? `${formatDateTime(r.end_at)} · ${r.ride_minutes} min (approche + trajet)` : `${formatDateTime(r.end_at)} · ${r.duration_hours} h`}
          />
          {r.actual_start_at ? <InfoRow label="Début réel" value={formatDateTime(r.actual_start_at)} /> : null}
          {r.actual_end_at ? <InfoRow label="Fin réelle" value={formatDateTime(r.actual_end_at)} /> : null}
          <InfoRow label={ride ? 'Point de départ' : 'Prise en charge'} value={r.pickup_address} />
          <InfoRow label={ride ? 'Destination précise' : 'Restitution'} value={r.dropoff_address ?? (ride ? '—' : 'Même lieu')} />
          {data.extra?.client_notes ? <InfoRow label="Remarque du client" value={data.extra.client_notes} /> : null}
          {r.cancellation_reason ? <InfoRow label="Motif d’annulation / refus" value={r.cancellation_reason} /> : null}
        </Card>

        <Card title="Client">
          <InfoRow label="Nom">
            <Text style={ui.link} onPress={() => router.push(`/admin/clients/${r.client_id}`)}>
              {r.client_name}
            </Text>
          </InfoRow>
          <InfoRow label="Téléphone du compte" value={r.client_phone} />
          <InfoRow label="Téléphone de contact" value={r.contact_phone} />
          <View style={ui.wrap}>
            <Button title="Appeler" small variant="outline" icon="call-outline" onPress={() => Linking.openURL(`tel:${r.contact_phone.replace(/\s/g, '')}`)} />
            <Button title="WhatsApp" small variant="outline" icon="logo-whatsapp" onPress={() => Linking.openURL(`https://wa.me/${r.contact_phone.replace(/\D/g, '')}`)} />
          </View>
        </Card>

        <Card title="Véhicule et chauffeur">
          <InfoRow label="Modèle réservé" value={r.model_name} />
          <InfoRow label="Véhicule attribué" value={r.plate_number ?? 'Pas encore attribué'} />
          {r.partner_share_pct != null && (
            <InfoRow label="Véhicule partenaire" value={`Part du partenaire : ${r.partner_share_pct} % · ${formatMoney((r.base_price - r.discount_amount) * r.partner_share_pct / 100)}`} />
          )}
          {r.driven_by_owner ? (
            <InfoRow
              label="Chauffeur"
              value={`${r.owner_contact?.name ?? 'Le propriétaire'}${r.owner_contact?.phone ? ` · ${r.owner_contact.phone}` : ''} (propriétaire)`}
            />
          ) : r.with_driver ? (
            <InfoRow
              label="Chauffeur"
              value={
                r.driver_name
                  ? `${r.driver_name}${r.driver_phone ? ` · ${r.driver_phone}` : ''}${r.status === 'pending' ? ' (choisi par le client)' : ''}`
                  : 'À attribuer'
              }
            />
          ) : (
            <InfoRow label="Sans chauffeur · permis du client" value={r.client_license_number} />
          )}
        </Card>
      </Grid>

      <Grid min={340}>
        <Card title="Montants">
          <MoneyLine label={ride ? 'Prix du trajet' : 'Tarif'} value={r.base_price} />
          {r.discount_amount > 0 && <MoneyLine label={`Réduction${r.promotion_code ? ` (${r.promotion_code})` : ''}`} value={-r.discount_amount} />}
          {r.extra_charges > 0 && <MoneyLine label="Frais supplémentaires" value={r.extra_charges} />}
          <MoneyLine label="Total dû" value={r.amount_due} bold />
          <MoneyLine label="Encaissé" value={r.amount_paid} />
          {r.amount_refunded > 0 && <MoneyLine label="Remboursé" value={-r.amount_refunded} />}
          <View style={styles.divider} />
          <MoneyLine label={r.balance >= 0 ? 'Reste à payer' : 'Trop-perçu à rembourser'} value={Math.abs(r.balance)} bold tone={r.balance > 0 ? 'danger' : r.balance < 0 ? 'warning' : 'success'} />
        </Card>

        <Card
          title="Paiements"
          actions={
            finance ? (
              <>
                <Button title="Encaisser" small icon="add" onPress={() => setPaymentSheet('payment')} />
                <Button title="Rembourser" small variant="outline" icon="return-down-back-outline" onPress={() => setPaymentSheet('refund')} />
              </>
            ) : undefined
          }
        >
          {data.payments.length === 0 && <Empty icon="wallet-outline" text="Aucun paiement déclaré." />}
          {data.payments.map((p) => {
            const pst = PAYMENT_STATUS[p.status];
            return (
              <View key={p.id} style={styles.payment}>
                <View style={ui.between}>
                  <View style={ui.flex1}>
                    <Text style={ui.strong}>
                      {p.kind === 'refund' ? 'Remboursement · ' : ''}
                      {formatMoney(p.amount)} · {PAYMENT_METHODS[p.method] ?? p.method}
                    </Text>
                    <Text style={ui.small}>
                      {formatDateTime(p.created_at)}
                      {p.transaction_reference ? ` · Réf. ${p.transaction_reference}` : ''}
                      {p.payer_phone ? ` · ${p.payer_phone}` : ''}
                    </Text>
                    {p.notes ? <Text style={ui.small}>{p.notes}</Text> : null}
                  </View>
                  <Badge label={pst.label} tone={pst.tone} />
                </View>
                <View style={ui.wrap}>
                  {p.proof_path ? <Button title="Voir la preuve" small variant="outline" icon="image-outline" onPress={() => openProof(p.proof_path!)} /> : null}
                  {finance && p.status === 'pending' && (
                    <>
                      <Button title="Argent reçu" small variant="success" icon="checkmark" onPress={() => setPaymentStatus(p, 'succeeded')} />
                      <Button title="Refuser" small variant="danger" icon="close" onPress={() => setPaymentStatus(p, 'failed')} />
                    </>
                  )}
                  {isAdmin && <Button title="Supprimer" small variant="ghost" icon="trash-outline" onPress={() => deletePayment(p)} />}
                </View>
              </View>
            );
          })}
        </Card>
      </Grid>

      <Grid min={340}>
        <Card title="Frais supplémentaires" actions={finance ? <Button title="Ajouter" small icon="add" onPress={() => setChargeOpen(true)} /> : undefined}>
          {data.charges.length === 0 && <Text style={ui.muted}>Aucun frais (dépassement horaire, carburant…).</Text>}
          {data.charges.map((c) => (
            <ListRow key={c.id}>
              <View style={ui.flex1}>
                <Text style={ui.strong}>
                  {CHARGE_TYPES[c.type]} · {formatMoney(c.amount)}
                </Text>
                <Text style={ui.small}>
                  {formatDateTime(c.created_at)}
                  {c.description ? ` · ${c.description}` : ''}
                </Text>
              </View>
              {isAdmin && (
                <Pressable onPress={() => deleteCharge(c)} hitSlop={8} accessibilityLabel="Supprimer">
                  <Ionicons name="trash-outline" size={18} color={Colors.danger} />
                </Pressable>
              )}
            </ListRow>
          ))}
        </Card>

        {operate ? (
          <InternalNotes id={r.id} initial={data.extra?.internal_notes ?? ''} onSaved={reload} />
        ) : (
          <Card title="Notes internes">
            <Text style={ui.body}>{data.extra?.internal_notes || '—'}</Text>
          </Card>
        )}
      </Grid>

      <Card title="Historique">
        {data.history.map((h) => (
          <View key={h.id} style={styles.history}>
            <View style={styles.dot} />
            <View style={ui.flex1}>
              <Text style={ui.body}>
                {h.from_status ? `${RESERVATION_STATUS[h.from_status].label} → ` : ''}
                {RESERVATION_STATUS[h.to_status].label}
              </Text>
              <Text style={ui.small}>
                {formatDateTime(h.changed_at)}
                {h.changer?.full_name ? ` · par ${h.changer.full_name}` : ''}
                {h.note ? ` · ${h.note}` : ''}
              </Text>
            </View>
          </View>
        ))}
      </Card>

      <AssignSheet visible={assignOpen} reservation={r} onClose={() => setAssignOpen(false)} onDone={reload} />
      <PaymentSheet kind={paymentSheet} reservation={r} onClose={() => setPaymentSheet(null)} onDone={reload} />
      <ChargeSheet visible={chargeOpen} reservationId={r.id} onClose={() => setChargeOpen(false)} onDone={reload} />
      <Sheet visible={!!proofUrl} title="Preuve de paiement" onClose={() => setProofUrl(null)}>
        {proofUrl ? <Image source={{ uri: proofUrl }} style={styles.proof} contentFit="contain" /> : null}
        {proofUrl ? <Button title="Ouvrir dans un nouvel onglet" variant="outline" icon="open-outline" onPress={() => Linking.openURL(proofUrl)} /> : null}
      </Sheet>
    </Page>
  );
}

function MoneyLine({ label, value, bold, tone }: { label: string; value: number; bold?: boolean; tone?: 'danger' | 'success' | 'warning' }) {
  const color = tone === 'danger' ? Colors.danger : tone === 'success' ? Colors.success : tone === 'warning' ? '#B45309' : Colors.text;
  return (
    <View style={ui.between}>
      <Text style={bold ? ui.strong : ui.muted}>{label}</Text>
      <Text style={[bold ? ui.strong : ui.body, { color }]}>{formatMoney(value)}</Text>
    </View>
  );
}

function InternalNotes({ id, initial, onSaved }: { id: string; initial: string; onSaved: () => void }) {
  const [text, setText] = useState(initial);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const changed = text !== initial;
  return (
    <Card title="Notes internes">
      <TextField label="Visible uniquement par l’équipe" value={text} onChangeText={setText} multiline placeholder="Ex. client à rappeler la veille…" />
      <FormError message={err} />
      <View style={ui.row}>
        <Button
          title="Enregistrer"
          small
          disabled={!changed}
          loading={saving}
          onPress={async () => {
            setSaving(true);
            const { error } = await supabase.from('reservations').update({ internal_notes: text.trim() || null }).eq('id', id);
            setSaving(false);
            if (error) setErr(errorMessage(error));
            else onSaved();
          }}
        />
      </View>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Confirm: pick the vehicle (and the driver when one is wanted)

type VehicleOption = {
  vehicle_id: string;
  plate_number: string;
  color: string | null;
  status: string;
  is_free: boolean;
  owner_name: string | null; // partner vehicle
  drive_mode: 'owner' | 'zoko' | 'either';
  partner_free: boolean;
};
type DriverOption = { driver_id: string; full_name: string };

function AssignSheet({ visible, reservation: r, onClose, onDone }: { visible: boolean; reservation: Details; onClose: () => void; onDone: () => void }) {
  const [vehicleId, setVehicleId] = useState<string | null>(r.vehicle_id);
  const [driverId, setDriverId] = useState<string | null>(r.driver_id);
  const [ownerDrives, setOwnerDrives] = useState(r.driven_by_owner);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const options = useLoad(async () => {
    if (!visible) return null;
    const [vehicles, drivers] = await Promise.all([
      supabase.rpc('vehicles_for_reservation', { p_reservation_id: r.id }).then(unwrap),
      r.with_driver
        ? supabase.rpc('available_drivers', { p_start: r.start_at, p_duration: r.duration_hours, p_exclude_reservation: r.id }).then(unwrap)
        : Promise.resolve([]),
    ]);
    return { vehicles: vehicles as VehicleOption[], drivers: drivers as DriverOption[] };
  }, [visible, r.id]);

  async function save() {
    if (!vehicleId) return setErr('Choisissez un véhicule.');
    setSaving(true);
    setErr(null);
    // The database also enforces who drives a partner vehicle (owner / Zoko)
    const byOwner = r.with_driver && (selected?.drive_mode === 'owner' || (selected?.drive_mode === 'either' && !!selected.owner_name && ownerDrives));
    const { error } = await supabase
      .from('reservations')
      .update({
        status: 'confirmed',
        vehicle_id: vehicleId,
        driven_by_owner: byOwner,
        driver_id: r.with_driver && !byOwner ? driverId : null,
      })
      .eq('id', r.id);
    setSaving(false);
    if (error) return setErr(errorMessage(error, 'Confirmation impossible.'));
    onClose();
    onDone();
  }

  const selected = options.data?.vehicles.find((v) => v.vehicle_id === vehicleId);
  const partnerVehicle = !!selected?.owner_name;
  const byOwnerNow = r.with_driver && partnerVehicle && (selected?.drive_mode === 'owner' || (selected?.drive_mode === 'either' && ownerDrives));
  const drivers = options.data?.drivers ?? [];
  // Keep the client's (or current) driver in the list even if the RPC filtered it out
  const driverChoices: { value: string; label: string }[] = [
    ...(r.driver_id && !drivers.some((d) => d.driver_id === r.driver_id) && r.driver_name
      ? [{ value: r.driver_id, label: `${r.driver_name} (actuel)` }]
      : []),
    ...drivers.map((d) => ({ value: d.driver_id, label: d.full_name + (d.driver_id === r.driver_id ? ' (demandé)' : '') })),
  ];

  return (
    <Sheet
      visible={visible}
      title={r.status === 'pending' ? 'Confirmer la réservation' : 'Changer l’attribution'}
      onClose={onClose}
      footer={
        <>
          <Button title="Annuler" variant="ghost" onPress={onClose} />
          <Button title={r.status === 'pending' ? 'Confirmer' : 'Enregistrer'} variant="success" onPress={save} loading={saving} />
        </>
      }
    >
      <Text style={ui.muted}>
        {r.model_name} · {formatDateTime(r.start_at)} · {r.kind === 'ride' ? `course ${r.from_zone_name} → ${r.to_zone_name} (${r.ride_city})` : `${r.duration_hours} h`}
      </Text>
      {options.loading && <Loading />}
      {options.error && <LoadError message={options.error} onRetry={options.reload} />}
      {options.data && (
        <>
          <Text style={ui.strong}>Véhicule</Text>
          {options.data.vehicles.length === 0 && (
            <Notice
              tone="danger"
              text={
                r.kind === 'ride'
                  ? `Aucun véhicule de ce modèle basé à ${r.ride_city}. Vérifiez la ville des plaques dans Véhicules.`
                  : 'Aucun véhicule de ce modèle dans la flotte. Ajoutez-en un dans Véhicules.'
              }
            />
          )}
          {options.data.vehicles.map((v) => (
            <Pressable
              key={v.vehicle_id}
              onPress={() => setVehicleId(v.vehicle_id)}
              disabled={!v.is_free && v.vehicle_id !== r.vehicle_id}
              style={[styles.option, vehicleId === v.vehicle_id && styles.optionSelected, !v.is_free && v.vehicle_id !== r.vehicle_id && { opacity: 0.45 }]}
            >
              <Ionicons name={vehicleId === v.vehicle_id ? 'radio-button-on' : 'radio-button-off'} size={20} color={Colors.primary} />
              <View style={ui.flex1}>
                <Text style={ui.strong}>
                  {v.plate_number}
                  {v.owner_name ? ` · partenaire ${v.owner_name}` : ''}
                </Text>
                <Text style={ui.small}>
                  {v.color ?? ''}{' '}
                  {v.is_free
                    ? '· libre'
                    : v.status !== 'available'
                      ? '· indisponible (entretien / hors service)'
                      : v.owner_name && !v.partner_free
                        ? '· le partenaire n’est pas disponible sur ce créneau'
                        : '· déjà pris sur ce créneau'}
                  {v.owner_name ? ` · ${v.drive_mode === 'owner' ? 'le propriétaire conduit' : v.drive_mode === 'zoko' ? 'confié à Zoko' : 'propriétaire ou Zoko'}` : ''}
                </Text>
              </View>
            </Pressable>
          ))}

          {r.with_driver && partnerVehicle && selected?.drive_mode === 'either' && (
            <Choice
              label="Qui conduit ce véhicule partenaire ?"
              options={[
                { value: 'owner', label: `Le propriétaire (${selected.owner_name})` },
                { value: 'zoko', label: 'Un chauffeur Zoko' },
              ]}
              value={ownerDrives ? 'owner' : 'zoko'}
              onChange={(v) => setOwnerDrives(v === 'owner')}
            />
          )}
          {byOwnerNow ? (
            <Notice text={`${selected?.owner_name} conduit son véhicule : il est notifié et peut refuser la mission.`} />
          ) : r.with_driver ? (
            <>
              <Text style={ui.strong}>Chauffeur</Text>
              {driverChoices.length === 0 ? (
                <Notice tone="warning" text="Aucun chauffeur libre sur ce créneau. Vous pouvez confirmer et l’attribuer plus tard." />
              ) : (
                <Choice
                  options={[{ value: '', label: 'Plus tard' }, ...driverChoices]}
                  value={driverId ?? ''}
                  onChange={(v) => setDriverId(v || null)}
                />
              )}
            </>
          ) : (
            <Notice text={`Sans chauffeur : vérifiez le permis du client (${r.client_license_number ?? '—'}) à la remise du véhicule.`} />
          )}
        </>
      )}
      <FormError message={err} />
    </Sheet>
  );
}

// ---------------------------------------------------------------------------
// Record a payment received, or a refund

function PaymentSheet({ kind, reservation: r, onClose, onDone }: { kind: 'payment' | 'refund' | null; reservation: Details; onClose: () => void; onDone: () => void }) {
  const [method, setMethod] = useState<PaymentMethod>('cash');
  const [amount, setAmount] = useState('');
  const [reference, setReference] = useState('');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const suggested = kind === 'refund' ? Math.max(0, -r.balance) : Math.max(0, r.balance);

  async function save() {
    const value = parseInt(amount.replace(/\D/g, '') || String(suggested), 10);
    if (!value || value <= 0) return setErr('Indiquez un montant.');
    setSaving(true);
    setErr(null);
    const { error } = await supabase.from('payments').insert({
      reservation_id: r.id,
      kind,
      method,
      amount: value,
      status: 'succeeded',
      transaction_reference: reference.trim() || null,
      notes: notes.trim() || null,
    });
    setSaving(false);
    if (error) return setErr(errorMessage(error, 'Enregistrement impossible.'));
    setAmount('');
    setReference('');
    setNotes('');
    onClose();
    onDone();
  }

  return (
    <Sheet
      visible={!!kind}
      title={kind === 'refund' ? 'Enregistrer un remboursement' : 'Enregistrer un paiement reçu'}
      onClose={onClose}
      footer={
        <>
          <Button title="Annuler" variant="ghost" onPress={onClose} />
          <Button title="Enregistrer" onPress={save} loading={saving} />
        </>
      }
    >
      <Choice
        label="Moyen"
        options={(Object.keys(PAYMENT_METHODS) as PaymentMethod[]).map((m) => ({ value: m, label: PAYMENT_METHODS[m] }))}
        value={method}
        onChange={setMethod}
      />
      <FieldRow>
        <TextField label="Montant (FCFA)" keyboardType="number-pad" placeholder={String(suggested)} value={amount} onChangeText={setAmount} hint={`Proposé : ${formatMoney(suggested)}`} />
        <TextField label="N° de transaction (facultatif)" value={reference} onChangeText={setReference} />
      </FieldRow>
      <TextField label="Note (facultatif)" value={notes} onChangeText={setNotes} multiline />
      <Notice text={kind === 'refund' ? 'Le remboursement est enregistré comme effectué et le client est notifié.' : 'Le paiement est enregistré comme reçu (validé) et le client est notifié.'} />
      <FormError message={err} />
    </Sheet>
  );
}

function ChargeSheet({ visible, reservationId, onClose, onDone }: { visible: boolean; reservationId: string; onClose: () => void; onDone: () => void }) {
  const [type, setType] = useState<keyof typeof CHARGE_TYPES>('overtime');
  const [amount, setAmount] = useState('');
  const [description, setDescription] = useState('');
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function save() {
    const value = parseInt(amount.replace(/\D/g, ''), 10);
    if (!value) return setErr('Indiquez un montant.');
    setSaving(true);
    setErr(null);
    const { error } = await supabase
      .from('reservation_charges')
      .insert({ reservation_id: reservationId, type, amount: value, description: description.trim() || null });
    setSaving(false);
    if (error) return setErr(errorMessage(error));
    setAmount('');
    setDescription('');
    onClose();
    onDone();
  }

  return (
    <Sheet
      visible={visible}
      title="Ajouter des frais"
      onClose={onClose}
      footer={
        <>
          <Button title="Annuler" variant="ghost" onPress={onClose} />
          <Button title="Ajouter" onPress={save} loading={saving} />
        </>
      }
    >
      <Choice
        label="Type"
        options={(Object.keys(CHARGE_TYPES) as (keyof typeof CHARGE_TYPES)[]).map((t) => ({ value: t, label: CHARGE_TYPES[t] }))}
        value={type}
        onChange={setType}
      />
      <TextField label="Montant (FCFA)" keyboardType="number-pad" value={amount} onChangeText={setAmount} />
      <TextField label="Détail (facultatif)" placeholder="Ex. 2 h de dépassement, 10 L d’essence…" value={description} onChangeText={setDescription} />
      <FormError message={err} />
    </Sheet>
  );
}

const styles = StyleSheet.create({
  divider: { height: 1, backgroundColor: Colors.border },
  payment: { gap: 8, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: Colors.border },
  history: { flexDirection: 'row', gap: 12, paddingVertical: 6 },
  dot: { width: 10, height: 10, borderRadius: 5, backgroundColor: Colors.primary, marginTop: 6 },
  proof: { width: '100%', height: 480, backgroundColor: '#F3F6FA', borderRadius: 12 },
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 12,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: Colors.border,
  },
  optionSelected: { borderColor: Colors.primary, backgroundColor: '#F0F8FE' },
});

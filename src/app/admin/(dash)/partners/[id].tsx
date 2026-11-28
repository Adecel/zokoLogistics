import { Image } from 'expo-image';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Linking, StyleSheet, Text, View } from 'react-native';
import { RequirePermission } from '../../../../components/admin/shell';
import {
  Badge,
  Button,
  Card,
  Choice,
  Empty,
  FormError,
  Grid,
  InfoRow,
  Notice,
  Page,
  Sheet,
  ui,
  useConfirm,
} from '../../../../components/admin/ui';
import { LoadError, Loading } from '../../../../components/load-state';
import { Radius } from '../../../../constants/zoko';
import { formatDate, formatDateTime } from '../../../../lib/admin/labels';
import { DRIVE_MODE_LABELS, PARTNER_LABELS, PARTNER_TONES, type AdminPartnerStatus } from '../../../../lib/admin/partner-labels';
import { errorMessage, unwrap, useLoad } from '../../../../lib/admin/use-load';
import { supabase } from '../../../../lib/supabase';

type Partner = {
  profile_id: string;
  status: AdminPartnerStatus;
  city: string;
  drives_self: boolean;
  license_number: string | null;
  message: string | null;
  review_note: string | null;
  reviewed_at: string | null;
  created_at: string;
  profile: { full_name: string; phone: string | null; email: string | null } | null;
};

type PartnerVehicle = {
  id: string;
  brand: string;
  name: string;
  year: number | null;
  color: string | null;
  plate_number: string;
  seats: number;
  transmission: 'manual' | 'automatic';
  city: string;
  drive_mode: keyof typeof DRIVE_MODE_LABELS;
  photos: string[];
  notes: string | null;
  status: 'pending' | 'approved' | 'rejected';
  review_note: string | null;
  vehicle_id: string | null;
  created_at: string;
};

type Fleet = {
  id: string;
  model_id: string;
  status: string;
  drive_mode: keyof typeof DRIVE_MODE_LABELS;
  available_now: boolean;
  available_now_at: string | null;
  model: { brand: string; name: string; is_active: boolean } | null;
};

type Model = { id: string; brand: string; name: string; is_active: boolean };

const VEHICLE_TONES = { pending: 'warning', approved: 'success', rejected: 'danger' } as const;
const VEHICLE_LABELS = { pending: 'À valider', approved: 'Validé', rejected: 'Refusé' } as const;

export default function PartnerScreen() {
  return (
    <RequirePermission permission="partners">
      <PartnerDetail />
    </RequirePermission>
  );
}

function PartnerDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const confirm = useConfirm();
  const [err, setErr] = useState<string | null>(null);
  const [approving, setApproving] = useState<PartnerVehicle | null>(null);

  const { data, error, loading, reload } = useLoad(async () => {
    const [partner, vehicles, fleet, models, slots] = await Promise.all([
      supabase
        .from('partners')
        .select('profile_id, status, city, drives_self, license_number, message, review_note, reviewed_at, created_at, profile:profile_id(full_name, phone, email)')
        .eq('profile_id', id)
        .maybeSingle()
        .then(unwrap),
      supabase
        .from('partner_vehicles')
        .select('id, brand, name, year, color, plate_number, seats, transmission, city, drive_mode, photos, notes, status, review_note, vehicle_id, created_at')
        .eq('owner_id', id)
        .order('created_at', { ascending: false })
        .then(unwrap),
      supabase
        .from('vehicles')
        .select('id, model_id, status, drive_mode, available_now, available_now_at, model:model_id(brand, name, is_active)')
        .eq('owner_id', id)
        .then(unwrap),
      supabase.from('vehicle_models').select('id, brand, name, is_active').order('brand').order('name').then(unwrap),
      supabase.from('vehicle_availability').select('vehicle_id').gte('end_at', new Date().toISOString()).then(unwrap),
    ]);
    return {
      partner: partner as unknown as Partner | null,
      vehicles: vehicles as PartnerVehicle[],
      fleet: fleet as unknown as Fleet[],
      models: models as Model[],
      slots: slots as { vehicle_id: string }[],
    };
  }, [id]);

  if (loading) return <Loading />;
  if (error) return <LoadError message={error} onRetry={reload} />;
  if (!data?.partner) return <LoadError message="Partenaire introuvable." />;
  const p = data.partner;

  async function setStatus(status: AdminPartnerStatus, title: string, withReason: boolean, danger = false) {
    const answer = await confirm({
      title,
      danger,
      confirmLabel: title,
      input: withReason ? { label: 'Motif (visible par le partenaire)', required: true } : undefined,
    });
    if (answer === null) return;
    setErr(null);
    const { error: e } = await supabase
      .from('partners')
      .update({ status, review_note: withReason ? answer : null })
      .eq('profile_id', p.profile_id);
    if (e) setErr(errorMessage(e));
    else reload();
  }

  async function rejectVehicle(v: PartnerVehicle) {
    const answer = await confirm({
      title: `Refuser ${v.brand} ${v.name}`,
      danger: true,
      confirmLabel: 'Refuser',
      input: { label: 'Motif (visible par le partenaire)', required: true },
    });
    if (answer === null) return;
    const { error: e } = await supabase.from('partner_vehicles').update({ status: 'rejected', review_note: answer }).eq('id', v.id);
    if (e) setErr(errorMessage(e));
    else reload();
  }

  const phone = p.profile?.phone?.replace(/\D/g, '');

  return (
    <Page
      title={p.profile?.full_name ?? 'Partenaire'}
      subtitle={`Demande du ${formatDate(p.created_at)}`}
      onRefresh={reload}
      refreshing={false}
      actions={<Button title="Retour" variant="ghost" icon="arrow-back" onPress={() => router.replace('/admin/partners')} />}
    >
      <View style={ui.wrap}>
        <Badge label={PARTNER_LABELS[p.status]} tone={PARTNER_TONES[p.status]} />
      </View>
      <FormError message={err} />

      <Grid min={320}>
        <Card title="Partenaire">
          <InfoRow label="Téléphone" value={p.profile?.phone} />
          <InfoRow label="E-mail" value={p.profile?.email} />
          <InfoRow label="Ville" value={p.city} />
          <InfoRow label="Conduit lui-même" value={p.drives_self ? `Oui · permis ${p.license_number ?? '—'}` : 'Non, confie à Zoko'} />
          {p.message ? <InfoRow label="Message" value={p.message} /> : null}
          {p.review_note ? <InfoRow label="Motif (refus / suspension)" value={p.review_note} /> : null}
          {phone ? (
            <View style={ui.wrap}>
              <Button title="Appeler" small variant="outline" icon="call-outline" onPress={() => Linking.openURL(`tel:+${phone}`)} />
              <Button title="WhatsApp" small variant="outline" icon="logo-whatsapp" onPress={() => Linking.openURL(`https://wa.me/${phone}`)} />
            </View>
          ) : null}
        </Card>

        <Card title="Décision">
          {p.status === 'pending' && (
            <Notice text="Vérifiez l’identité et, s’il conduit, le permis avant de valider. Le partenaire pourra ensuite proposer ses véhicules." />
          )}
          <View style={ui.wrap}>
            {p.status !== 'approved' && (
              <Button title="Valider le partenaire" variant="success" icon="checkmark-circle-outline" onPress={() => setStatus('approved', 'Valider le partenaire', false)} />
            )}
            {p.status === 'pending' && (
              <Button title="Refuser" variant="danger" icon="close-circle-outline" onPress={() => setStatus('rejected', 'Refuser la demande', true, true)} />
            )}
            {p.status === 'approved' && (
              <Button title="Suspendre" variant="danger" icon="pause-circle-outline" onPress={() => setStatus('suspended', 'Suspendre le partenaire', true, true)} />
            )}
          </View>
          {p.status === 'approved' && <Text style={ui.muted}>Suspendu : ses véhicules ne sont plus proposés, les missions confirmées restent à gérer.</Text>}
        </Card>
      </Grid>

      <Card title={`Véhicules (${data.vehicles.length})`}>
        {data.vehicles.length === 0 && <Empty icon="car-outline" text="Aucun véhicule proposé pour le moment." />}
        {data.vehicles.map((v) => {
          const fleet = data.fleet.find((f) => f.id === v.vehicle_id);
          const slots = fleet ? data.slots.filter((s) => s.vehicle_id === fleet.id).length : 0;
          return (
            <View key={v.id} style={styles.vehicle}>
              <View style={ui.between}>
                <View style={ui.flex1}>
                  <Text style={ui.title}>
                    {v.brand} {v.name} · {v.plate_number}
                  </Text>
                  <Text style={ui.small}>
                    {[v.year, v.color, `${v.seats} places`, v.transmission === 'automatic' ? 'Automatique' : 'Manuelle', v.city].filter(Boolean).join(' · ')}
                  </Text>
                  <Text style={ui.small}>
                    {DRIVE_MODE_LABELS[fleet?.drive_mode ?? v.drive_mode]} · proposé le {formatDate(v.created_at)}
                  </Text>
                  {v.notes ? <Text style={ui.small}>« {v.notes} »</Text> : null}
                </View>
                <Badge label={VEHICLE_LABELS[v.status]} tone={VEHICLE_TONES[v.status]} />
              </View>

              {v.photos.length > 0 && (
                <View style={styles.photos}>
                  {v.photos.map((url) => (
                    <Image key={url} source={{ uri: url }} style={styles.photo} contentFit="cover" />
                  ))}
                </View>
              )}

              {v.status === 'rejected' && v.review_note ? <Text style={ui.small}>Motif : {v.review_note}</Text> : null}

              {v.status === 'pending' && (
                <View style={ui.wrap}>
                  <Button
                    title="Valider et ajouter à la flotte"
                    small
                    variant="success"
                    icon="checkmark"
                    onPress={() => setApproving(v)}
                    disabled={p.status !== 'approved'}
                  />
                  <Button title="Refuser" small variant="danger" icon="close" onPress={() => rejectVehicle(v)} />
                </View>
              )}
              {v.status === 'pending' && p.status !== 'approved' && <Text style={ui.small}>Validez d’abord le partenaire.</Text>}

              {fleet && (
                <>
                  <Text style={ui.small}>
                    Modèle : {fleet.model ? `${fleet.model.brand} ${fleet.model.name}` : '—'}
                    {fleet.model && !fleet.model.is_active ? ' (masqué : ajoutez les tarifs puis rendez-le visible)' : ''}
                    {' · '}
                    {fleet.available_now ? 'Disponible maintenant' : 'Pas disponible maintenant'}
                    {fleet.available_now_at ? ` (depuis ${formatDateTime(fleet.available_now_at)})` : ''} · {slots} plage(s) à venir
                  </Text>
                  <View style={ui.wrap}>
                    <Button title="Tarifs et fiche du modèle" small variant="outline" icon="pricetag-outline" onPress={() => router.push(`/admin/vehicles/${fleet.model_id}`)} />
                  </View>
                </>
              )}
            </View>
          );
        })}
      </Card>

      <ApproveSheet
        vehicle={approving}
        models={data.models}
        onClose={() => setApproving(null)}
        onDone={(modelId, created) => {
          setApproving(null);
          if (created) router.push(`/admin/vehicles/${modelId}`);
          else reload();
        }}
      />
    </Page>
  );
}

// Validate a vehicle: attach it to a catalog model (its prices) or create a new model
function ApproveSheet({
  vehicle,
  models,
  onClose,
  onDone,
}: {
  vehicle: PartnerVehicle | null;
  models: Model[];
  onClose: () => void;
  onDone: (modelId: string, created: boolean) => void;
}) {
  const [choice, setChoice] = useState<string>('new');
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  if (!vehicle) return null;
  const existing = models.find((m) => m.brand.toLowerCase() === vehicle.brand.trim().toLowerCase() && m.name.toLowerCase() === vehicle.name.trim().toLowerCase());

  async function approve() {
    if (!vehicle) return;
    setSaving(true);
    setErr(null);
    const modelId = choice === 'new' ? (existing?.id ?? null) : choice;
    const { data, error } = await supabase.rpc('approve_partner_vehicle', { p_partner_vehicle_id: vehicle.id, p_model_id: modelId });
    setSaving(false);
    if (error) return setErr(errorMessage(error, 'Validation impossible.'));
    onDone(data as string, choice === 'new' && !existing);
  }

  return (
    <Sheet
      visible
      title={`Valider ${vehicle.brand} ${vehicle.name}`}
      onClose={onClose}
      footer={
        <>
          <Button title="Annuler" variant="ghost" onPress={onClose} />
          <Button title="Valider" variant="success" onPress={approve} loading={saving} />
        </>
      }
    >
      <Text style={ui.muted}>
        Le prix dépend du modèle. Rattachez ce véhicule à un modèle existant (mêmes tarifs), ou créez un modèle à part pour lui donner ses propres
        prix (location et courses).
      </Text>
      <Choice
        label="Modèle"
        options={[
          { value: 'new', label: existing ? `${existing.brand} ${existing.name} (même nom)` : `Nouveau : ${vehicle.brand} ${vehicle.name}` },
          ...models.filter((m) => m.id !== existing?.id).map((m) => ({ value: m.id, label: `${m.brand} ${m.name}${m.is_active ? '' : ' (masqué)'}` })),
        ]}
        value={choice}
        onChange={setChoice}
      />
      {choice === 'new' && !existing && (
        <Notice tone="warning" text="Le nouveau modèle est créé masqué, avec les photos du partenaire. Ajoutez ensuite ses tarifs (location et courses) puis rendez-le visible." />
      )}
      <FormError message={err} />
    </Sheet>
  );
}

const styles = StyleSheet.create({
  vehicle: { gap: 8, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: '#E3EAF2' },
  photos: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  photo: { width: 120, height: 90, borderRadius: Radius.md, backgroundColor: '#EEF2F7' },
});

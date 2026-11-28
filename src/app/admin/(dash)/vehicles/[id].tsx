import Ionicons from '@expo/vector-icons/Ionicons';
import { Image } from 'expo-image';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
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
  ListRow,
  Notice,
  Page,
  Sheet,
  TextField,
  Toggle,
  ui,
  useConfirm,
} from '../../../../components/admin/ui';
import { LoadError, Loading } from '../../../../components/load-state';
import { FUEL_LABELS, TRANSMISSION_LABELS } from '../../../../constants/vehicles';
import { Colors, Radius } from '../../../../constants/zoko';
import { formatDate, formatMoney, VEHICLE_STATUS, type VehicleStatus } from '../../../../lib/admin/labels';
import { can } from '../../../../lib/admin/roles';
import { pickImage, removePublicImage, uploadPublicImage } from '../../../../lib/admin/upload';
import { errorMessage, unwrap, useLoad } from '../../../../lib/admin/use-load';
import { useAuth } from '../../../../lib/auth';
import { supabase } from '../../../../lib/supabase';

type Transmission = keyof typeof TRANSMISSION_LABELS;
type Fuel = keyof typeof FUEL_LABELS;

type Model = {
  id: string;
  brand: string;
  name: string;
  seats: number;
  transmission: Transmission;
  fuel_type: Fuel;
  features: string[];
  description: string | null;
  is_active: boolean;
};
type Photo = { id: string; url: string; position: number };
type Rate = { id: string; duration_hours: number; price: number; valid_from: string; valid_to: string | null };
type Vehicle = {
  id: string;
  plate_number: string;
  color: string | null;
  year: number | null;
  status: VehicleStatus;
  mileage_km: number | null;
  notes: string | null;
  city: string;
  owner_id: string | null;
};

export default function VehicleScreen() {
  return (
    <RequirePermission permission="fleet">
      <VehicleEditor />
    </RequirePermission>
  );
}

function VehicleEditor() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const isNew = id === 'new';

  const { data, error, loading, reload } = useLoad(async () => {
    if (isNew) return null;
    const [model, photos, rates, vehicles, zones] = await Promise.all([
      supabase.from('vehicle_models').select('id, brand, name, seats, transmission, fuel_type, features, description, is_active').eq('id', id).maybeSingle().then(unwrap),
      supabase.from('vehicle_photos').select('id, url, position').eq('model_id', id).order('position').then(unwrap),
      supabase.from('rates').select('id, duration_hours, price, valid_from, valid_to').eq('model_id', id).order('valid_from', { ascending: false }).then(unwrap),
      supabase.from('vehicles').select('id, plate_number, color, year, status, mileage_km, notes, city, owner_id').eq('model_id', id).order('plate_number').then(unwrap),
      supabase.from('ride_zones').select('city').then(unwrap),
    ]);
    return {
      model: model as Model | null,
      photos: photos as Photo[],
      rates: rates as Rate[],
      vehicles: vehicles as Vehicle[],
      // Cities known from the ride zones, plus the ones already used by plates
      cities: [...new Set([...(zones as { city: string }[]).map((z) => z.city), ...(vehicles as Vehicle[]).map((v) => v.city)])].sort(),
      now: Date.now(), // "now" for current prices, taken when the data is fetched
    };
  }, [id]);

  if (!isNew && loading) return <Loading />;
  if (error) return <LoadError message={error} onRetry={reload} />;
  if (!isNew && !data?.model) return <LoadError message="Véhicule introuvable." />;

  const model = data?.model ?? null;

  return (
    <Page
      title={model ? `${model.brand} ${model.name}` : 'Nouveau véhicule'}
      subtitle={model ? 'Caractéristiques, photos, tarifs et plaques' : 'Créez le modèle, puis ajoutez photos, tarifs et plaques'}
      actions={<Button title="Retour" variant="ghost" icon="arrow-back" onPress={() => router.replace('/admin/vehicles')} />}
    >
      <ModelForm key={model?.id ?? 'new'} model={model} onSaved={(newId) => (isNew ? router.replace(`/admin/vehicles/${newId}`) : reload())} />
      {model && data && (
        <>
          <Photos modelId={model.id} photos={data.photos} onChanged={reload} />
          <Grid min={360}>
            <Rates modelId={model.id} rates={data.rates} now={data.now} onChanged={reload} />
            <Fleet modelId={model.id} vehicles={data.vehicles} cities={data.cities} onChanged={reload} />
          </Grid>
        </>
      )}
    </Page>
  );
}

// ---------------------------------------------------------------------------

function ModelForm({ model, onSaved }: { model: Model | null; onSaved: (id: string) => void }) {
  const { profile } = useAuth();
  const confirm = useConfirm();
  const [brand, setBrand] = useState(model?.brand ?? '');
  const [name, setName] = useState(model?.name ?? '');
  const [seats, setSeats] = useState(String(model?.seats ?? 4));
  const [transmission, setTransmission] = useState<Transmission>(model?.transmission ?? 'manual');
  const [fuel, setFuel] = useState<Fuel>(model?.fuel_type ?? 'petrol');
  const [features, setFeatures] = useState((model?.features ?? []).join(', '));
  const [description, setDescription] = useState(model?.description ?? '');
  const [active, setActive] = useState(model?.is_active ?? true);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  async function save() {
    if (!brand.trim() || !name.trim()) return setErr('Indiquez la marque et le modèle.');
    const seatCount = parseInt(seats, 10);
    if (!seatCount || seatCount < 1) return setErr('Nombre de places invalide.');
    setSaving(true);
    setErr(null);
    setSaved(false);
    const values = {
      brand: brand.trim(),
      name: name.trim(),
      seats: seatCount,
      transmission,
      fuel_type: fuel,
      features: features.split(',').map((f) => f.trim()).filter(Boolean),
      description: description.trim() || null,
      is_active: active,
    };
    const res = model
      ? await supabase.from('vehicle_models').update(values).eq('id', model.id).select('id').single()
      : await supabase.from('vehicle_models').insert(values).select('id').single();
    setSaving(false);
    if (res.error) return setErr(errorMessage(res.error, 'Enregistrement impossible.'));
    setSaved(true);
    onSaved((res.data as { id: string }).id);
  }

  async function remove() {
    if (!model) return;
    const ok = await confirm({
      title: 'Supprimer ce véhicule',
      message: 'Le modèle, ses photos, ses tarifs et ses plaques seront supprimés. Impossible s’il a déjà des réservations : masquez-le plutôt.',
      danger: true,
      confirmLabel: 'Supprimer',
    });
    if (ok === null) return;
    // Check first, so plates are never removed when the model must stay
    const { count, error: countError } = await supabase
      .from('reservations')
      .select('id', { count: 'exact', head: true })
      .eq('model_id', model.id);
    if (countError) return setErr(errorMessage(countError));
    if (count) return setErr(`Ce véhicule a ${count} réservation(s) : décochez « Visible » pour le masquer au lieu de le supprimer.`);
    const { error } = await supabase.from('vehicles').delete().eq('model_id', model.id);
    const res = error ? { error } : await supabase.from('vehicle_models').delete().eq('id', model.id);
    if (res.error) setErr(errorMessage(res.error, 'Suppression impossible.'));
    else router.replace('/admin/vehicles');
  }

  return (
    <Card
      title="Caractéristiques"
      actions={model && can(profile?.role, 'delete') ? <Button title="Supprimer" small variant="danger" icon="trash-outline" onPress={remove} /> : undefined}
    >
      <FieldRow>
        <TextField label="Marque" placeholder="Suzuki" value={brand} onChangeText={setBrand} />
        <TextField label="Modèle" placeholder="Jimny" value={name} onChangeText={setName} />
        <TextField label="Places" keyboardType="number-pad" value={seats} onChangeText={setSeats} />
      </FieldRow>
      <FieldRow>
        <Choice
          label="Boîte de vitesses"
          options={(Object.keys(TRANSMISSION_LABELS) as Transmission[]).map((t) => ({ value: t, label: TRANSMISSION_LABELS[t] }))}
          value={transmission}
          onChange={setTransmission}
        />
        <Choice
          label="Carburant"
          options={(Object.keys(FUEL_LABELS) as Fuel[]).map((f) => ({ value: f, label: FUEL_LABELS[f] }))}
          value={fuel}
          onChange={setFuel}
        />
      </FieldRow>
      <TextField
        label="Équipements"
        placeholder="Climatisation, Bluetooth, GPS"
        value={features}
        onChangeText={setFeatures}
        hint="Séparés par des virgules"
      />
      <TextField label="Description" multiline value={description} onChangeText={setDescription} placeholder="Présentation affichée aux clients" />
      <Toggle label="Visible dans l’application" hint="Masqué = les clients ne peuvent plus le réserver" value={active} onChange={setActive} />
      <FormError message={err} />
      {saved && <Notice tone="success" text="Enregistré." />}
      <View style={ui.row}>
        <Button title={model ? 'Enregistrer' : 'Créer le véhicule'} icon="save-outline" onPress={save} loading={saving} />
      </View>
    </Card>
  );
}

// ---------------------------------------------------------------------------

function Photos({ modelId, photos, onChanged }: { modelId: string; photos: Photo[]; onChanged: () => void }) {
  const confirm = useConfirm();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function add() {
    setErr(null);
    const image = await pickImage();
    if (!image) return;
    setBusy(true);
    try {
      const url = await uploadPublicImage(`models/${modelId}`, image);
      const position = photos.length ? Math.max(...photos.map((p) => p.position)) + 1 : 0;
      const { error } = await supabase.from('vehicle_photos').insert({ model_id: modelId, url, position });
      if (error) throw error;
      onChanged();
    } catch (e) {
      setErr(errorMessage(e, 'Envoi de la photo impossible.'));
    } finally {
      setBusy(false);
    }
  }

  async function makeMain(photo: Photo) {
    setBusy(true);
    // Put this photo first, keep the order of the others
    const ordered = [photo, ...photos.filter((p) => p.id !== photo.id)];
    const results = await Promise.all(ordered.map((p, i) => supabase.from('vehicle_photos').update({ position: i }).eq('id', p.id)));
    setBusy(false);
    const failed = results.find((r) => r.error);
    if (failed) setErr(errorMessage(failed.error));
    else onChanged();
  }

  async function remove(photo: Photo) {
    const ok = await confirm({ title: 'Retirer cette photo', danger: true, confirmLabel: 'Retirer' });
    if (ok === null) return;
    const { error } = await supabase.from('vehicle_photos').delete().eq('id', photo.id);
    if (error) return setErr(errorMessage(error));
    await removePublicImage(photo.url);
    onChanged();
  }

  return (
    <Card title="Photos" actions={<Button title="Ajouter une photo" small icon="cloud-upload-outline" onPress={add} loading={busy} />}>
      {photos.length === 0 && <Empty icon="images-outline" text="Aucune photo. La première photo est celle affichée dans l’application." />}
      <View style={styles.photos}>
        {photos.map((p, i) => (
          <View key={p.id} style={styles.photo}>
            <Image source={{ uri: p.url }} style={StyleSheet.absoluteFill} contentFit="cover" />
            {i === 0 && (
              <View style={styles.mainTag}>
                <Text style={styles.mainText}>Principale</Text>
              </View>
            )}
            <View style={styles.photoActions}>
              {i > 0 && (
                <Pressable onPress={() => makeMain(p)} style={styles.photoBtn} accessibilityLabel="Mettre en principale">
                  <Ionicons name="star-outline" size={16} color={Colors.white} />
                </Pressable>
              )}
              <Pressable onPress={() => remove(p)} style={styles.photoBtn} accessibilityLabel="Retirer">
                <Ionicons name="trash-outline" size={16} color={Colors.white} />
              </Pressable>
            </View>
          </View>
        ))}
      </View>
      <FormError message={err} />
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Rates: a price change closes the current rate and opens a new one (history kept)

function Rates({ modelId, rates, now, onChanged }: { modelId: string; rates: Rate[]; now: number; onChanged: () => void }) {
  const confirm = useConfirm();
  const [editing, setEditing] = useState<{ duration: string; price: string; current: Rate | null } | null>(null);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [showHistory, setShowHistory] = useState(false);

  const current = rates
    .filter((r) => new Date(r.valid_from).getTime() <= now && (!r.valid_to || new Date(r.valid_to).getTime() > now))
    .sort((a, b) => a.duration_hours - b.duration_hours);
  const past = rates.filter((r) => !current.includes(r));

  async function save() {
    if (!editing) return;
    const duration = parseInt(editing.duration, 10);
    const price = parseInt(editing.price.replace(/\D/g, ''), 10);
    if (!duration || duration < 1 || duration > 72) return setErr('Durée entre 1 et 72 heures.');
    if (!price) return setErr('Indiquez un prix.');
    const existing = editing.current ?? current.find((r) => r.duration_hours === duration) ?? null;
    setSaving(true);
    setErr(null);
    const stamp = new Date().toISOString();
    if (existing) {
      const { error } = await supabase.from('rates').update({ valid_to: stamp }).eq('id', existing.id);
      if (error) {
        setSaving(false);
        return setErr(errorMessage(error));
      }
    }
    const { error } = await supabase.from('rates').insert({ model_id: modelId, duration_hours: duration, price, valid_from: stamp });
    setSaving(false);
    if (error) return setErr(errorMessage(error));
    setEditing(null);
    onChanged();
  }

  async function stop(rate: Rate) {
    const ok = await confirm({
      title: `Ne plus proposer ${rate.duration_hours} h`,
      message: 'Les clients ne pourront plus choisir cette durée. Les réservations existantes gardent leur prix.',
      danger: true,
      confirmLabel: 'Retirer',
    });
    if (ok === null) return;
    const { error } = await supabase.from('rates').update({ valid_to: new Date().toISOString() }).eq('id', rate.id);
    if (error) setErr(errorMessage(error));
    else onChanged();
  }

  return (
    <Card title="Tarifs" actions={<Button title="Ajouter une durée" small icon="add" onPress={() => setEditing({ duration: '', price: '', current: null })} />}>
      {current.length === 0 && <Notice tone="warning" text="Aucun tarif en vigueur : ce véhicule ne peut pas être réservé." />}
      {current.map((r) => (
        <ListRow key={r.id}>
          <View style={ui.flex1}>
            <Text style={ui.strong}>
              {r.duration_hours} h · {formatMoney(r.price)}
            </Text>
            <Text style={ui.small}>Depuis le {formatDate(r.valid_from)}</Text>
          </View>
          <Button title="Changer le prix" small variant="outline" onPress={() => setEditing({ duration: String(r.duration_hours), price: String(r.price), current: r })} />
          <Pressable onPress={() => stop(r)} hitSlop={8} accessibilityLabel="Retirer cette durée">
            <Ionicons name="close-circle-outline" size={20} color={Colors.danger} />
          </Pressable>
        </ListRow>
      ))}
      {past.length > 0 && (
        <Text style={ui.link} onPress={() => setShowHistory((s) => !s)}>
          {showHistory ? 'Masquer' : 'Voir'} l’historique des prix ({past.length})
        </Text>
      )}
      {showHistory &&
        past.map((r) => (
          <Text key={r.id} style={ui.small}>
            {r.duration_hours} h · {formatMoney(r.price)} · du {formatDate(r.valid_from)} au {formatDate(r.valid_to)}
          </Text>
        ))}
      <FormError message={err} />

      <Sheet
        visible={!!editing}
        title={editing?.current ? `Nouveau prix · ${editing.current.duration_hours} h` : 'Ajouter une durée'}
        onClose={() => setEditing(null)}
        footer={
          <>
            <Button title="Annuler" variant="ghost" onPress={() => setEditing(null)} />
            <Button title="Enregistrer" onPress={save} loading={saving} />
          </>
        }
      >
        {editing && (
          <>
            <FieldRow>
              <TextField
                label="Durée (heures)"
                keyboardType="number-pad"
                value={editing.duration}
                editable={!editing.current}
                onChangeText={(t) => setEditing({ ...editing, duration: t })}
              />
              <TextField label="Prix (FCFA)" keyboardType="number-pad" value={editing.price} onChangeText={(t) => setEditing({ ...editing, price: t })} />
            </FieldRow>
            <Notice text="Le nouveau prix s’applique aux nouvelles réservations. Les réservations déjà faites gardent leur prix." />
            <FormError message={err} />
          </>
        )}
      </Sheet>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Physical vehicles (one plate = one row)

function Fleet({ modelId, vehicles, cities, onChanged }: { modelId: string; vehicles: Vehicle[]; cities: string[]; onChanged: () => void }) {
  const { profile } = useAuth();
  const confirm = useConfirm();
  const [form, setForm] = useState<Partial<Vehicle> & { open: boolean }>({ open: false });
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  function open(v?: Vehicle) {
    setErr(null);
    setForm(v ? { ...v, open: true } : { open: true, status: 'available', city: cities[0] ?? 'Pointe-Noire' });
  }

  async function save() {
    if (!form.plate_number?.trim()) return setErr('Indiquez la plaque.');
    setSaving(true);
    setErr(null);
    const values = {
      model_id: modelId,
      plate_number: form.plate_number.trim().toUpperCase(),
      color: form.color?.trim() || null,
      year: form.year ? Number(form.year) : null,
      status: form.status ?? 'available',
      mileage_km: form.mileage_km != null && String(form.mileage_km) !== '' ? Number(form.mileage_km) : null,
      notes: form.notes?.trim() || null,
      city: form.city?.trim() || 'Pointe-Noire',
    };
    const { error } = form.id
      ? await supabase.from('vehicles').update(values).eq('id', form.id)
      : await supabase.from('vehicles').insert(values);
    setSaving(false);
    if (error) return setErr(errorMessage(error));
    setForm({ open: false });
    onChanged();
  }

  async function remove(v: Vehicle) {
    const ok = await confirm({
      title: `Supprimer ${v.plate_number}`,
      message: 'Impossible si ce véhicule a déjà été attribué à une réservation : mettez-le « Hors service » plutôt.',
      danger: true,
      confirmLabel: 'Supprimer',
    });
    if (ok === null) return;
    const { error } = await supabase.from('vehicles').delete().eq('id', v.id);
    if (error) setErr(errorMessage(error));
    else onChanged();
  }

  return (
    <Card title="Flotte (plaques)" actions={<Button title="Ajouter une plaque" small icon="add" onPress={() => open()} />}>
      {vehicles.length === 0 && <Notice tone="warning" text="Aucun véhicule réel : les réservations ne pourront pas être confirmées." />}
      {vehicles.map((v) => (
        <ListRow key={v.id} onPress={() => open(v)}>
          <View style={ui.flex1}>
            <Text style={ui.strong}>{v.plate_number}</Text>
            <Text style={ui.small}>
              {[v.city, v.color, v.year, v.mileage_km != null ? `${v.mileage_km.toLocaleString('fr-FR')} km` : null].filter(Boolean).join(' · ') || '—'}
            </Text>
          </View>
          {v.owner_id && <Badge label="Partenaire" tone="info" />}
          <Badge label={VEHICLE_STATUS[v.status].label} tone={VEHICLE_STATUS[v.status].tone} />
          {can(profile?.role, 'delete') && (
            <Pressable onPress={() => remove(v)} hitSlop={8} accessibilityLabel="Supprimer">
              <Ionicons name="trash-outline" size={18} color={Colors.danger} />
            </Pressable>
          )}
        </ListRow>
      ))}
      {!form.open && <FormError message={err} />}

      <Sheet
        visible={form.open}
        title={form.id ? `Modifier ${form.plate_number}` : 'Ajouter une plaque'}
        onClose={() => setForm({ open: false })}
        footer={
          <>
            <Button title="Annuler" variant="ghost" onPress={() => setForm({ open: false })} />
            <Button title="Enregistrer" onPress={save} loading={saving} />
          </>
        }
      >
        <FieldRow>
          <TextField label="Plaque" placeholder="CG-123-AB" autoCapitalize="characters" value={form.plate_number ?? ''} onChangeText={(t) => setForm({ ...form, plate_number: t })} />
          <TextField label="Couleur" value={form.color ?? ''} onChangeText={(t) => setForm({ ...form, color: t })} />
        </FieldRow>
        <FieldRow>
          <TextField label="Année" keyboardType="number-pad" value={form.year ? String(form.year) : ''} onChangeText={(t) => setForm({ ...form, year: t ? Number(t.replace(/\D/g, '')) : null })} />
          <TextField
            label="Kilométrage"
            keyboardType="number-pad"
            value={form.mileage_km != null ? String(form.mileage_km) : ''}
            onChangeText={(t) => setForm({ ...form, mileage_km: t ? Number(t.replace(/\D/g, '')) : null })}
          />
        </FieldRow>
        <Choice
          label="État"
          options={(Object.keys(VEHICLE_STATUS) as VehicleStatus[]).map((s) => ({ value: s, label: VEHICLE_STATUS[s].label }))}
          value={form.status ?? 'available'}
          onChange={(s) => setForm({ ...form, status: s })}
        />
        {cities.length > 0 && (
          <Choice
            label="Ville (courses)"
            options={[...new Set([...cities, ...(form.city ? [form.city] : [])])].map((c) => ({ value: c, label: c }))}
            value={form.city ?? cities[0]}
            onChange={(c) => setForm({ ...form, city: c })}
          />
        )}
        <TextField label="Notes" multiline value={form.notes ?? ''} onChangeText={(t) => setForm({ ...form, notes: t })} />
        <FormError message={err} />
      </Sheet>
    </Card>
  );
}

const styles = StyleSheet.create({
  photos: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  photo: { width: 180, height: 130, borderRadius: Radius.md, overflow: 'hidden', backgroundColor: '#E3F2FC' },
  mainTag: { position: 'absolute', left: 8, top: 8, backgroundColor: Colors.primary, borderRadius: Radius.pill, paddingHorizontal: 8, paddingVertical: 2 },
  mainText: { color: Colors.white, fontSize: 11, fontWeight: '600' },
  photoActions: { position: 'absolute', right: 8, bottom: 8, flexDirection: 'row', gap: 6 },
  photoBtn: { backgroundColor: 'rgba(11,37,69,0.7)', borderRadius: Radius.pill, padding: 7 },
});

import { Image } from 'expo-image';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
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
  TextField,
  Toggle,
  ui,
  useConfirm,
} from '../../../../components/admin/ui';
import { LoadError, Loading } from '../../../../components/load-state';
import { formatDateTime, RESERVATION_STATUS, type ReservationStatus } from '../../../../lib/admin/labels';
import { can } from '../../../../lib/admin/roles';
import { pickImage, uploadPublicImage } from '../../../../lib/admin/upload';
import { errorMessage, unwrap, useLoad } from '../../../../lib/admin/use-load';
import { useAuth } from '../../../../lib/auth';
import { supabase } from '../../../../lib/supabase';
import { licenseState, type DriverRow } from '../../../../lib/admin/drivers';

type Ride = { id: string; reference: string; status: ReservationStatus; start_at: string; duration_hours: number; model_name: string; client_name: string };

// yyyy-mm-dd typed by hand (no native date picker on the web)
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export default function DriverScreen() {
  return (
    <RequirePermission permission="drivers">
      <DriverEditor />
    </RequirePermission>
  );
}

function DriverEditor() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const isNew = id === 'new';

  const { data, error, loading, reload } = useLoad(async () => {
    if (isNew) return null;
    const [driver, rides] = await Promise.all([
      supabase
        .from('drivers')
        .select('profile_id, license_number, license_expires_on, is_available, notes, profile:profile_id(full_name, phone, email, avatar_url, is_active)')
        .eq('profile_id', id)
        .maybeSingle()
        .then(unwrap),
      supabase
        .from('reservation_details')
        .select('id, reference, status, start_at, duration_hours, model_name, client_name')
        .eq('driver_id', id)
        .order('start_at', { ascending: false })
        .limit(30)
        .then(unwrap),
    ]);
    return { driver: driver as unknown as DriverRow | null, rides: rides as Ride[] };
  }, [id]);

  if (!isNew && loading) return <Loading />;
  if (error) return <LoadError message={error} onRetry={reload} />;
  if (!isNew && !data?.driver) return <LoadError message="Chauffeur introuvable." />;

  const driver = data?.driver ?? null;
  const upcoming = (data?.rides ?? []).filter((r) => ['pending', 'confirmed', 'in_progress'].includes(r.status));
  const past = (data?.rides ?? []).filter((r) => !upcoming.includes(r));

  return (
    <Page
      title={driver?.profile?.full_name ?? 'Nouveau chauffeur'}
      subtitle={driver ? 'Fiche chauffeur' : 'Le chauffeur sera proposé aux clients dès qu’il est disponible'}
      actions={<Button title="Retour" variant="ghost" icon="arrow-back" onPress={() => router.replace('/admin/drivers')} />}
    >
      <DriverForm key={driver?.profile_id ?? 'new'} driver={driver} onSaved={(newId) => (isNew ? router.replace(`/admin/drivers/${newId}`) : reload())} />
      {driver && (
        <Grid min={340}>
          <Card title={`Locations à venir (${upcoming.length})`}>
            {upcoming.length === 0 && <Empty icon="calendar-outline" text="Aucune location prévue." />}
            {upcoming.map((r) => (
              <RideRow key={r.id} ride={r} />
            ))}
          </Card>
          <Card title="Dernières locations">
            {past.length === 0 && <Text style={ui.muted}>Aucune.</Text>}
            {past.map((r) => (
              <RideRow key={r.id} ride={r} />
            ))}
          </Card>
        </Grid>
      )}
    </Page>
  );
}

function RideRow({ ride: r }: { ride: Ride }) {
  const st = RESERVATION_STATUS[r.status];
  return (
    <ListRow onPress={() => router.push(`/admin/reservations/${r.id}`)}>
      <View style={ui.flex1}>
        <Text style={ui.strong}>
          {r.reference} · {r.client_name}
        </Text>
        <Text style={ui.small}>
          {formatDateTime(r.start_at)} · {r.duration_hours} h · {r.model_name}
        </Text>
      </View>
      <Badge label={st.label} tone={st.tone} />
    </ListRow>
  );
}

function DriverForm({ driver, onSaved }: { driver: DriverRow | null; onSaved: (id: string) => void }) {
  const { profile } = useAuth();
  const confirm = useConfirm();
  const [fullName, setFullName] = useState(driver?.profile?.full_name ?? '');
  const [phone, setPhone] = useState(driver?.profile?.phone ?? '');
  const [email, setEmail] = useState(driver?.profile?.email ?? '');
  const [license, setLicense] = useState(driver?.license_number ?? '');
  const [expires, setExpires] = useState(driver?.license_expires_on ?? '');
  const [notes, setNotes] = useState(driver?.notes ?? '');
  const [available, setAvailable] = useState(driver?.is_available ?? true);
  const [accountActive, setAccountActive] = useState(driver?.profile?.is_active ?? true);
  const [avatar, setAvatar] = useState<string | null>(driver?.profile?.avatar_url ?? null);
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  async function changePhoto() {
    const image = await pickImage();
    if (!image) return;
    setUploading(true);
    setErr(null);
    try {
      setAvatar(await uploadPublicImage(`drivers/${driver?.profile_id ?? 'new'}`, image));
    } catch (e) {
      setErr(errorMessage(e, 'Envoi de la photo impossible.'));
    } finally {
      setUploading(false);
    }
  }

  async function save() {
    if (fullName.trim().length < 2) return setErr('Indiquez le nom du chauffeur.');
    if (!phone.trim()) return setErr('Indiquez le téléphone du chauffeur.');
    if (expires && !DATE_RE.test(expires)) return setErr('Date d’expiration au format AAAA-MM-JJ (ex. 2027-06-30).');
    setSaving(true);
    setErr(null);
    setSaved(false);

    if (!driver) {
      const { data, error } = await supabase.rpc('admin_create_driver', {
        p_full_name: fullName.trim(),
        p_phone: phone.trim(),
        p_email: email.trim() || null,
        p_license_number: license.trim() || null,
        p_license_expires_on: expires || null,
        p_notes: notes.trim() || null,
        p_avatar_url: avatar,
      });
      setSaving(false);
      if (error) return setErr(errorMessage(error, 'Création impossible.'));
      if (!available) await supabase.from('drivers').update({ is_available: false }).eq('profile_id', data as string);
      return onSaved(data as string);
    }

    const [p, d] = await Promise.all([
      supabase
        .from('profiles')
        .update({ full_name: fullName.trim(), phone: phone.trim(), avatar_url: avatar, is_active: accountActive })
        .eq('id', driver.profile_id),
      supabase
        .from('drivers')
        .update({ license_number: license.trim() || null, license_expires_on: expires || null, notes: notes.trim() || null, is_available: available })
        .eq('profile_id', driver.profile_id),
    ]);
    setSaving(false);
    const e = p.error ?? d.error;
    if (e) return setErr(errorMessage(e, 'Enregistrement impossible.'));
    setSaved(true);
    onSaved(driver.profile_id);
  }

  async function remove() {
    if (!driver) return;
    const ok = await confirm({
      title: 'Supprimer ce chauffeur',
      message:
        'Sans historique, le compte est supprimé. S’il a déjà conduit, il est anonymisé (les locations passées restent). Ses demandes en attente reviennent à « Zoko choisit ».',
      danger: true,
      confirmLabel: 'Supprimer',
    });
    if (ok === null) return;
    const { error } = await supabase.rpc('admin_delete_user', { p_user_id: driver.profile_id });
    if (error) setErr(errorMessage(error, 'Suppression impossible.'));
    else router.replace('/admin/drivers');
  }

  const lic = licenseState(expires && DATE_RE.test(expires) ? expires : null);

  return (
    <Card
      title="Informations"
      actions={driver && can(profile?.role, 'delete') ? <Button title="Supprimer" small variant="danger" icon="trash-outline" onPress={remove} /> : undefined}
    >
      <View style={ui.row}>
        {avatar ? <Image source={{ uri: avatar }} style={styles.avatar} contentFit="cover" /> : <Avatar name={fullName || '?'} size={72} />}
        <View style={ui.gapSm}>
          <Button title={avatar ? 'Changer la photo' : 'Ajouter une photo'} small variant="outline" icon="camera-outline" onPress={changePhoto} loading={uploading} />
          <Text style={ui.small}>Visible par les clients au moment de choisir.</Text>
        </View>
      </View>
      <FieldRow>
        <TextField label="Nom complet" value={fullName} onChangeText={setFullName} />
        <TextField label="Téléphone" keyboardType="phone-pad" value={phone} onChangeText={setPhone} placeholder="06 123 45 67" />
      </FieldRow>
      <FieldRow>
        <TextField
          label="E-mail (facultatif)"
          keyboardType="email-address"
          autoCapitalize="none"
          value={email}
          onChangeText={setEmail}
          editable={!driver}
          hint={driver ? 'L’e-mail de connexion ne se change pas ici.' : 'Pour une future app chauffeur'}
        />
        <TextField label="N° de permis" autoCapitalize="characters" value={license} onChangeText={setLicense} />
        <TextField label="Permis valable jusqu’au" placeholder="AAAA-MM-JJ" value={expires} onChangeText={setExpires} />
      </FieldRow>
      {expires ? <Badge label={lic.label} tone={lic.tone} /> : null}
      <TextField label="Notes internes" multiline value={notes} onChangeText={setNotes} placeholder="Langues parlées, zones connues…" />
      <Toggle label="Disponible" hint="Indisponible = n’apparaît plus dans la liste proposée aux clients" value={available} onChange={setAvailable} />
      {driver && <Toggle label="Compte actif" hint="Désactiver bloque le compte sans le supprimer" value={accountActive} onChange={setAccountActive} />}
      <FormError message={err} />
      {saved && <Notice tone="success" text="Enregistré." />}
      <View style={ui.row}>
        <Button title={driver ? 'Enregistrer' : 'Créer le chauffeur'} icon="save-outline" onPress={save} loading={saving} />
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  avatar: { width: 72, height: 72, borderRadius: 36 },
});

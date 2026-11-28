import Ionicons from '@expo/vector-icons/Ionicons';
import { Image } from 'expo-image';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LoadError, Loading } from '../../components/load-state';
import { Segmented } from '../../components/pickers';
import { ScreenHeader } from '../../components/screen-header';
import { ZokoButton } from '../../components/zoko-button';
import { ZokoInput } from '../../components/zoko-input';
import { Colors, Fonts, Radius, Spacing } from '../../constants/zoko';
import { pickImage, uploadPublicImage } from '../../lib/admin/upload';
import { useAuth } from '../../lib/auth';
import { dbMessage, DRIVE_MODES, type DriveMode, type Partner, type PartnerVehicle } from '../../lib/partner';
import { citiesOf, useRideZones } from '../../lib/rides';
import { useSettings } from '../../lib/settings';
import { supabase } from '../../lib/supabase';

const MAX_PHOTOS = 4;

// Propose a vehicle (or fix one that is pending / not accepted)
export default function PartnerVehicleForm() {
  const { id } = useLocalSearchParams<{ id?: string }>();
  const { session } = useAuth();
  const userId = session?.user.id;
  const [data, setData] = useState<{ partner: Partner; vehicle: PartnerVehicle | null } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!userId) return;
    let active = true;
    (async () => {
      const [p, v] = await Promise.all([
        supabase.from('partners').select('profile_id, status, city, drives_self, license_number, message, review_note, created_at').eq('profile_id', userId).maybeSingle(),
        id
          ? supabase
              .from('partner_vehicles')
              .select('id, brand, name, year, color, plate_number, seats, transmission, city, drive_mode, photos, notes, status, review_note, vehicle_id, created_at')
              .eq('id', id)
              .maybeSingle()
          : Promise.resolve({ data: null, error: null }),
      ]);
      if (!active) return;
      if (p.error || v.error || !p.data) setError('Impossible de charger le formulaire. Vérifiez votre connexion.');
      else setData({ partner: p.data as Partner, vehicle: v.data as PartnerVehicle | null });
    })();
    return () => {
      active = false;
    };
  }, [id, userId]);

  return (
    <SafeAreaView style={styles.flex} edges={['top', 'bottom']}>
      <View style={styles.inner}>
        <ScreenHeader title={id ? 'Mon véhicule' : 'Ajouter un véhicule'} fallback="/partner" />
      </View>
      {data && userId ? <Form userId={userId} partner={data.partner} vehicle={data.vehicle} /> : error ? <LoadError message={error} /> : <Loading />}
    </SafeAreaView>
  );
}

function Form({ userId, partner, vehicle }: { userId: string; partner: Partner; vehicle: PartnerVehicle | null }) {
  const { settings } = useSettings();
  const { zones } = useRideZones();
  const cities = [...new Set([partner.city, ...(settings?.city ? [settings.city] : []), ...(zones ? citiesOf(zones) : [])])];

  const [brand, setBrand] = useState(vehicle?.brand ?? '');
  const [name, setName] = useState(vehicle?.name ?? '');
  const [year, setYear] = useState(vehicle?.year ? String(vehicle.year) : '');
  const [color, setColor] = useState(vehicle?.color ?? '');
  const [plate, setPlate] = useState(vehicle?.plate_number ?? '');
  const [seats, setSeats] = useState(String(vehicle?.seats ?? 4));
  const [transmission, setTransmission] = useState<'manual' | 'automatic'>(vehicle?.transmission ?? 'manual');
  const [city, setCity] = useState(vehicle?.city ?? partner.city);
  // A partner who does not drive can only hand the vehicle to Zoko
  const modes: DriveMode[] = partner.drives_self ? ['either', 'owner', 'zoko'] : ['zoko'];
  const [mode, setMode] = useState<DriveMode>(vehicle?.drive_mode && modes.includes(vehicle.drive_mode) ? vehicle.drive_mode : modes[0]);
  const [photos, setPhotos] = useState<string[]>(vehicle?.photos ?? []);
  const [notes, setNotes] = useState(vehicle?.notes ?? '');
  const [busy, setBusy] = useState<'photo' | 'save' | 'delete' | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const readOnly = vehicle?.status === 'approved';

  async function addPhoto() {
    setErr(null);
    const image = await pickImage();
    if (!image) return;
    setBusy('photo');
    try {
      const url = await uploadPublicImage(`partners/${userId}`, image);
      setPhotos((p) => [...p, url]);
    } catch {
      setErr('Envoi de la photo impossible. Réessayez.');
    } finally {
      setBusy(null);
    }
  }

  async function save() {
    if (!brand.trim() || !name.trim()) return setErr('Indiquez la marque et le modèle.');
    if (!plate.trim()) return setErr('Indiquez la plaque d’immatriculation.');
    const seatCount = parseInt(seats, 10);
    if (!seatCount || seatCount < 1 || seatCount > 30) return setErr('Nombre de places invalide.');
    const yearNum = year ? parseInt(year, 10) : null;
    if (yearNum !== null && (yearNum < 1990 || yearNum > 2100)) return setErr('Année invalide.');
    setBusy('save');
    setErr(null);
    const values = {
      brand: brand.trim(),
      name: name.trim(),
      year: yearNum,
      color: color.trim() || null,
      plate_number: plate.trim(),
      seats: seatCount,
      transmission,
      city,
      drive_mode: mode,
      photos,
      notes: notes.trim() || null,
    };
    const { error } = vehicle
      ? await supabase.from('partner_vehicles').update(values).eq('id', vehicle.id)
      : await supabase.from('partner_vehicles').insert(values);
    setBusy(null);
    if (error) return setErr(dbMessage(error, 'Enregistrement impossible. Vérifiez votre connexion.'));
    router.back();
  }

  async function remove() {
    if (!vehicle) return;
    setBusy('delete');
    const { error } = await supabase.from('partner_vehicles').delete().eq('id', vehicle.id);
    setBusy(null);
    if (error) return setErr(dbMessage(error, 'Suppression impossible.'));
    router.back();
  }

  return (
    <ScrollView contentContainerStyle={[styles.inner, styles.content]} keyboardShouldPersistTaps="handled">
      {vehicle?.status === 'rejected' && (
        <Text style={styles.notice}>
          Non retenu{vehicle.review_note ? ` : ${vehicle.review_note}` : ''}. Corrigez puis renvoyez pour une nouvelle vérification.
        </Text>
      )}
      {vehicle?.status === 'pending' && <Text style={styles.info}>En vérification par le gérant. Vous pouvez encore corriger la fiche.</Text>}
      {readOnly && <Text style={styles.info}>Véhicule validé : contactez Zoko pour modifier ces informations.</Text>}

      <View style={styles.card}>
        <ZokoInput label="Marque" icon="car-outline" placeholder="Toyota" value={brand} onChangeText={setBrand} editable={!readOnly} />
        <ZokoInput label="Modèle" icon="car-sport-outline" placeholder="Corolla" value={name} onChangeText={setName} editable={!readOnly} />
        <ZokoInput
          label="Plaque d’immatriculation"
          icon="pricetag-outline"
          placeholder="001-AB-4"
          autoCapitalize="characters"
          value={plate}
          onChangeText={setPlate}
          editable={!readOnly}
        />
        <View style={styles.row}>
          <View style={styles.flex1}>
            <ZokoInput label="Année" icon="calendar-outline" keyboardType="number-pad" value={year} onChangeText={setYear} editable={!readOnly} />
          </View>
          <View style={styles.flex1}>
            <ZokoInput label="Places" icon="people-outline" keyboardType="number-pad" value={seats} onChangeText={setSeats} editable={!readOnly} />
          </View>
        </View>
        <ZokoInput label="Couleur" icon="color-palette-outline" placeholder="Blanc" value={color} onChangeText={setColor} editable={!readOnly} />
        <View style={styles.field}>
          <Text style={styles.label}>Boîte de vitesses</Text>
          <Segmented
            options={[
              { value: 'manual', label: 'Manuelle' },
              { value: 'automatic', label: 'Automatique' },
            ]}
            value={transmission}
            onChange={(t) => !readOnly && setTransmission(t)}
          />
        </View>
        {cities.length > 1 && (
          <View style={styles.field}>
            <Text style={styles.label}>Ville où il est basé</Text>
            <Segmented options={cities.map((c) => ({ value: c, label: c }))} value={city} onChange={(c) => !readOnly && setCity(c)} />
          </View>
        )}
      </View>

      {!readOnly && (
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Qui conduit ?</Text>
          {modes.map((m) => {
            const selected = m === mode;
            return (
              <Pressable key={m} onPress={() => setMode(m)} style={[styles.option, selected && styles.optionSelected]} accessibilityState={{ selected }}>
                <Ionicons name={selected ? 'radio-button-on' : 'radio-button-off'} size={20} color={Colors.primary} />
                <View style={styles.flex1}>
                  <Text style={styles.label}>{DRIVE_MODES[m].label}</Text>
                  <Text style={styles.muted}>{DRIVE_MODES[m].hint}</Text>
                </View>
              </Pressable>
            );
          })}
          {!partner.drives_self && <Text style={styles.muted}>Vous avez indiqué ne pas conduire vous-même : le véhicule est confié à Zoko.</Text>}
        </View>
      )}

      <View style={styles.card}>
        <Text style={styles.cardTitle}>Photos ({photos.length}/{MAX_PHOTOS})</Text>
        <Text style={styles.muted}>Extérieur et intérieur : elles aident le gérant à fixer le prix.</Text>
        <View style={styles.photos}>
          {photos.map((url) => (
            <View key={url} style={styles.photo}>
              <Image source={{ uri: url }} style={StyleSheet.absoluteFill} contentFit="cover" />
              {!readOnly && (
                <Pressable onPress={() => setPhotos((p) => p.filter((x) => x !== url))} style={styles.photoRemove} accessibilityLabel="Retirer">
                  <Ionicons name="close" size={16} color={Colors.white} />
                </Pressable>
              )}
            </View>
          ))}
          {!readOnly && photos.length < MAX_PHOTOS && (
            <Pressable onPress={addPhoto} style={[styles.photo, styles.photoAdd]} disabled={busy === 'photo'} accessibilityLabel="Ajouter une photo">
              <Ionicons name={busy === 'photo' ? 'hourglass-outline' : 'camera-outline'} size={26} color={Colors.primary} />
            </Pressable>
          )}
        </View>
      </View>

      {!readOnly && (
        <ZokoInput label="Remarque (facultatif)" icon="chatbox-outline" placeholder="Climatisation, état, kilométrage…" value={notes} onChangeText={setNotes} multiline />
      )}

      {err ? <Text style={styles.error}>{err}</Text> : null}
      {!readOnly && <ZokoButton title={vehicle ? 'Renvoyer pour vérification' : 'Envoyer pour vérification'} onPress={save} loading={busy === 'save'} />}
      {vehicle && !readOnly && (
        <Pressable onPress={remove} disabled={busy === 'delete'} style={styles.deleteLink} hitSlop={8}>
          <Text style={styles.deleteText}>{busy === 'delete' ? 'Suppression…' : 'Retirer ce véhicule'}</Text>
        </Pressable>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: Colors.background },
  flex1: { flex: 1 },
  row: { flexDirection: 'row', gap: Spacing.sm },
  inner: { width: '100%', maxWidth: 520, alignSelf: 'center', paddingHorizontal: Spacing.lg },
  content: { gap: Spacing.md, paddingBottom: Spacing.xl },
  card: {
    padding: Spacing.md,
    gap: Spacing.md,
    borderRadius: Radius.lg,
    backgroundColor: Colors.white,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  cardTitle: { fontFamily: Fonts.semibold, fontSize: 15, color: Colors.navy },
  field: { gap: Spacing.xs },
  label: { fontFamily: Fonts.medium, fontSize: 14, color: Colors.text },
  muted: { fontFamily: Fonts.regular, fontSize: 13, lineHeight: 19, color: Colors.textMuted },
  error: { fontFamily: Fonts.medium, fontSize: 13, color: Colors.danger, textAlign: 'center' },
  info: { fontFamily: Fonts.medium, fontSize: 13, color: Colors.primaryDark, backgroundColor: '#E3F2FC', padding: Spacing.md, borderRadius: Radius.md },
  notice: { fontFamily: Fonts.medium, fontSize: 13, color: Colors.danger, backgroundColor: '#FDECEC', padding: Spacing.md, borderRadius: Radius.md },
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    padding: Spacing.sm + 2,
    borderRadius: Radius.md,
    borderWidth: 1.5,
    borderColor: Colors.border,
  },
  optionSelected: { borderColor: Colors.primary, backgroundColor: '#E3F2FC' },
  photos: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm },
  photo: { width: 96, height: 72, borderRadius: Radius.md, overflow: 'hidden', backgroundColor: '#EEF2F7' },
  photoAdd: { alignItems: 'center', justifyContent: 'center', borderWidth: 1.5, borderStyle: 'dashed', borderColor: Colors.primary },
  photoRemove: {
    position: 'absolute',
    top: 4,
    right: 4,
    width: 24,
    height: 24,
    borderRadius: Radius.pill,
    backgroundColor: 'rgba(0,0,0,0.55)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  deleteLink: { alignSelf: 'center', paddingVertical: Spacing.xs },
  deleteText: { fontFamily: Fonts.semibold, fontSize: 14, color: Colors.danger },
});

import Ionicons from '@expo/vector-icons/Ionicons';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LoadError, Loading } from '../../components/load-state';
import { Segmented } from '../../components/pickers';
import { ZokoButton } from '../../components/zoko-button';
import { ZokoInput } from '../../components/zoko-input';
import { formatBusinessDateTime } from '../../constants/dates';
import { formatPrice } from '../../constants/vehicles';
import { Colors, Fonts, Radius, Spacing } from '../../constants/zoko';
import { useAuth } from '../../lib/auth';
import {
  dbMessage,
  loadPartnerSpace,
  MISSION_STATUS,
  monthEarnings,
  PARTNER_STATUS,
  VEHICLE_STATUS,
  type FleetVehicle,
  type Partner,
  type PartnerSpace,
} from '../../lib/partner';
import { useRideZones, citiesOf } from '../../lib/rides';
import { useSettings, type Settings } from '../../lib/settings';
import { supabase } from '../../lib/supabase';

export default function PartnerTab() {
  const { session } = useAuth();
  const { settings, error: settingsError, reload: reloadSettings } = useSettings();
  const [space, setSpace] = useState<PartnerSpace | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const userId = session?.user.id;

  const load = useCallback(async () => {
    if (!userId) return;
    try {
      setSpace(await loadPartnerSpace(userId));
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, [userId]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  async function refresh() {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }

  let body;
  if (!space || !settings) {
    const message = error ?? settingsError;
    body = message ? (
      <LoadError
        message={message}
        onRetry={() => {
          reloadSettings();
          load();
        }}
      />
    ) : (
      <Loading />
    );
  } else if (!space.partner) {
    body = settings.partners_enabled ? (
      <Apply settings={settings} partner={null} onDone={load} />
    ) : (
      <Info icon="time-outline" title="Bientôt disponible" text="Le programme Zoko Partenaire ouvrira prochainement." />
    );
  } else if (space.partner.status === 'pending') {
    body = (
      <Info
        icon="hourglass-outline"
        title="Demande envoyée"
        text="Le gérant vérifie votre demande. Vous recevrez une notification dès qu’elle est validée."
      />
    );
  } else if (space.partner.status === 'rejected') {
    body = (
      <>
        <Info icon="close-circle-outline" title={PARTNER_STATUS.rejected} text={space.partner.review_note ?? 'Contactez Zoko pour en savoir plus.'} />
        <Apply settings={settings} partner={space.partner} onDone={load} />
      </>
    );
  } else if (space.partner.status === 'suspended') {
    body = <Info icon="pause-circle-outline" title={PARTNER_STATUS.suspended} text={space.partner.review_note ?? 'Contactez Zoko pour en savoir plus.'} />;
  } else {
    body = <Dashboard space={space} settings={settings} onChanged={load} />;
  }

  return (
    <SafeAreaView style={styles.flex} edges={['top']}>
      <ScrollView
        contentContainerStyle={[styles.inner, styles.content]}
        keyboardShouldPersistTaps="handled"
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={Colors.primary} />}
      >
        <Text style={styles.title}>Zoko Partenaire</Text>
        {body}
      </ScrollView>
    </SafeAreaView>
  );
}

function Info({ icon, title, text }: { icon: 'time-outline' | 'hourglass-outline' | 'close-circle-outline' | 'pause-circle-outline'; title: string; text: string }) {
  return (
    <View style={[styles.card, styles.center]}>
      <Ionicons name={icon} size={40} color={Colors.primary} />
      <Text style={styles.cardTitle}>{title}</Text>
      <Text style={[styles.muted, styles.centerText]}>{text}</Text>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Sign-up (or new request after a refusal)

function Apply({ settings, partner, onDone }: { settings: Settings; partner: Partner | null; onDone: () => void }) {
  const { zones } = useRideZones();
  const cities = [...new Set([settings.city, ...(zones ? citiesOf(zones) : [])].filter(Boolean))];
  const [city, setCity] = useState(partner?.city ?? cities[0] ?? 'Pointe-Noire');
  const [drivesSelf, setDrivesSelf] = useState(partner?.drives_self ?? true);
  const [license, setLicense] = useState(partner?.license_number ?? '');
  const [message, setMessage] = useState(partner?.message ?? '');
  const [accepted, setAccepted] = useState(false);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submit() {
    if (drivesSelf && !license.trim()) return setErr('Indiquez votre numéro de permis pour conduire vous-même.');
    if (!accepted) return setErr('Acceptez les conditions Zoko Partenaire.');
    setSaving(true);
    setErr(null);
    const values = {
      city,
      drives_self: drivesSelf,
      license_number: license.trim() || null,
      message: message.trim() || null,
    };
    const { error } = partner
      ? await supabase.from('partners').update({ ...values, status: 'pending' }).eq('profile_id', partner.profile_id)
      : await supabase.from('partners').insert(values);
    setSaving(false);
    if (error) return setErr(dbMessage(error, 'Envoi impossible. Vérifiez votre connexion.'));
    onDone();
  }

  return (
    <>
      {!partner && (
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Gagnez de l’argent avec votre véhicule</Text>
          <Benefit icon="car-sport-outline" text="Inscrivez votre voiture : Zoko la propose pour des réservations et des courses." />
          <Benefit icon="toggle-outline" text="Vous décidez quand elle est disponible : tout de suite, ou à des dates précises." />
          <Benefit icon="person-outline" text="Conduisez vous-même, ou confiez le véhicule à Zoko." />
          <Benefit
            icon="cash-outline"
            text={`Vous recevez ${settings.partner_share_pct_owner_drives} % du prix quand vous conduisez, ${settings.partner_share_pct_zoko_drives} % quand Zoko conduit.`}
          />
          {settings.partner_fee_note ? <Text style={styles.note}>{settings.partner_fee_note}</Text> : null}
        </View>
      )}

      <View style={styles.card}>
        <Text style={styles.cardTitle}>{partner ? 'Envoyer une nouvelle demande' : 'Devenir partenaire'}</Text>
        {cities.length > 1 && (
          <View style={styles.field}>
            <Text style={styles.label}>Ville</Text>
            <Segmented options={cities.map((c) => ({ value: c, label: c }))} value={city} onChange={setCity} />
          </View>
        )}
        <View style={styles.switchRow}>
          <View style={styles.flex1}>
            <Text style={styles.label}>Je peux conduire moi-même</Text>
            <Text style={styles.muted}>Sinon, un chauffeur Zoko conduira votre véhicule.</Text>
          </View>
          <Switch value={drivesSelf} onValueChange={setDrivesSelf} trackColor={{ true: Colors.primary }} />
        </View>
        {drivesSelf && (
          <ZokoInput label="Numéro de permis de conduire" icon="card-outline" value={license} onChangeText={setLicense} autoCapitalize="characters" />
        )}
        <ZokoInput
          label="Message (facultatif)"
          icon="chatbox-outline"
          placeholder="Votre véhicule, vos disponibilités…"
          value={message}
          onChangeText={setMessage}
          multiline
        />
        <Pressable style={styles.terms} onPress={() => setAccepted((a) => !a)} accessibilityRole="checkbox" accessibilityState={{ checked: accepted }}>
          <View style={[styles.checkbox, accepted && styles.checkboxOn]}>
            {accepted && <Ionicons name="checkmark" size={16} color={Colors.white} />}
          </View>
          <Text style={styles.termsText}>
            {'J’accepte les '}
            <Text style={styles.link} onPress={() => router.push('/legal/partner')} accessibilityRole="link">
              conditions Zoko Partenaire
            </Text>
          </Text>
        </Pressable>
        {err ? <Text style={styles.error}>{err}</Text> : null}
        <ZokoButton title="Envoyer ma demande" onPress={submit} loading={saving} />
      </View>
    </>
  );
}

function Benefit({ icon, text }: { icon: 'car-sport-outline' | 'toggle-outline' | 'person-outline' | 'cash-outline'; text: string }) {
  return (
    <View style={styles.benefit}>
      <Ionicons name={icon} size={20} color={Colors.primary} />
      <Text style={[styles.muted, styles.flex1]}>{text}</Text>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Approved partner

function Dashboard({ space, settings, onChanged }: { space: PartnerSpace; settings: Settings; onChanged: () => void }) {
  const currency = settings.currency_label;
  const offset = settings.utc_offset;
  const upcoming = space.missions.filter((m) => m.status === 'confirmed' || m.status === 'in_progress').reverse();
  const history = space.missions.filter((m) => m.status !== 'confirmed' && m.status !== 'in_progress').slice(0, 10);

  return (
    <>
      <View style={[styles.card, styles.earnings]}>
        <Text style={styles.earningsLabel}>Gains estimés ce mois-ci</Text>
        <Text style={styles.earningsValue}>{formatPrice(monthEarnings(space.missions), currency)}</Text>
        <Text style={styles.earningsHint}>
          {settings.partner_share_pct_owner_drives} % quand vous conduisez · {settings.partner_share_pct_zoko_drives} % quand Zoko conduit
        </Text>
      </View>

      <View style={styles.rowBetween}>
        <Text style={styles.section}>Mes véhicules</Text>
        <Pressable onPress={() => router.push('/partner/vehicle-form')} hitSlop={8}>
          <Text style={styles.link}>+ Ajouter</Text>
        </Pressable>
      </View>
      {space.vehicles.length === 0 && (
        <View style={styles.card}>
          <Text style={styles.muted}>Ajoutez votre premier véhicule. Le gérant le vérifie avant qu’il soit proposé aux clients.</Text>
          <ZokoButton title="Ajouter un véhicule" onPress={() => router.push('/partner/vehicle-form')} />
        </View>
      )}
      {space.vehicles.map((v) => {
        const fleet = space.fleet.find((f) => f.id === v.vehicle_id);
        return (
          <Pressable
            key={v.id}
            onPress={() =>
              fleet
                ? router.push({ pathname: '/partner/vehicle/[id]', params: { id: fleet.id } })
                : router.push({ pathname: '/partner/vehicle-form', params: { id: v.id } })
            }
            style={({ pressed }) => [styles.card, pressed && { opacity: 0.9 }]}
          >
            <View style={styles.rowBetween}>
              <View style={styles.flex1}>
                <Text style={styles.vehicleName}>
                  {v.brand} {v.name}
                </Text>
                <Text style={styles.muted}>
                  {v.plate_number} · {v.city}
                </Text>
              </View>
              <Text style={[styles.pill, v.status === 'approved' ? styles.pillOk : v.status === 'rejected' ? styles.pillBad : styles.pillWait]}>
                {VEHICLE_STATUS[v.status]}
              </Text>
            </View>
            {v.status === 'rejected' && v.review_note ? <Text style={styles.error}>{v.review_note}</Text> : null}
            {fleet && <AvailableNow vehicle={fleet} onChanged={onChanged} />}
          </Pressable>
        );
      })}

      <Text style={styles.section}>Missions à venir</Text>
      {upcoming.length === 0 && (
        <View style={styles.card}>
          <Text style={styles.muted}>Aucune mission pour le moment. Rendez votre véhicule disponible pour en recevoir.</Text>
        </View>
      )}
      {upcoming.map((m) => (
        <MissionRow key={m.id} mission={m} currency={currency} offset={offset} />
      ))}

      {history.length > 0 && (
        <>
          <Text style={styles.section}>Historique</Text>
          {history.map((m) => (
            <MissionRow key={m.id} mission={m} currency={currency} offset={offset} />
          ))}
        </>
      )}
    </>
  );
}

function AvailableNow({ vehicle, onChanged }: { vehicle: FleetVehicle; onChanged: () => void }) {
  const [value, setValue] = useState(vehicle.available_now);
  const [err, setErr] = useState<string | null>(null);

  async function toggle(next: boolean) {
    setValue(next);
    setErr(null);
    const { error } = await supabase.rpc('partner_set_vehicle', { p_vehicle_id: vehicle.id, p_available_now: next });
    if (error) {
      setValue(!next);
      setErr(dbMessage(error, 'Changement impossible. Vérifiez votre connexion.'));
      return;
    }
    onChanged();
  }

  return (
    <>
      <View style={styles.switchRow}>
        <View style={styles.flex1}>
          <Text style={styles.label}>Disponible maintenant</Text>
          <Text style={styles.muted}>{value ? 'Proposé pour les courses immédiates' : 'Non proposé pour les courses'}</Text>
        </View>
        <Switch value={value} onValueChange={toggle} trackColor={{ true: Colors.success }} />
      </View>
      {err ? <Text style={styles.error}>{err}</Text> : null}
    </>
  );
}

function MissionRow({ mission: m, currency, offset }: { mission: PartnerSpace['missions'][number]; currency: string; offset: string }) {
  return (
    <Pressable
      onPress={() => router.push({ pathname: '/partner/mission/[id]', params: { id: m.id } })}
      style={({ pressed }) => [styles.card, styles.mission, pressed && { opacity: 0.9 }]}
    >
      <Ionicons name={m.kind === 'ride' ? 'flash-outline' : 'calendar-outline'} size={22} color={Colors.primary} />
      <View style={styles.flex1}>
        <Text style={styles.vehicleName}>
          {m.kind === 'ride' ? `Course ${m.from_zone_name ?? ''} → ${m.to_zone_name ?? ''}` : 'Location'} · {m.plate_number}
        </Text>
        <Text style={styles.muted}>
          {formatBusinessDateTime(m.start_at, offset)} · {MISSION_STATUS[m.status]} · {m.driven_by_owner ? 'vous conduisez' : 'Zoko conduit'}
        </Text>
      </View>
      <Text style={styles.amount}>{formatPrice(m.partner_amount, currency)}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: Colors.background },
  flex1: { flex: 1 },
  inner: { width: '100%', maxWidth: 520, alignSelf: 'center', paddingHorizontal: Spacing.lg },
  content: { gap: Spacing.md, paddingBottom: Spacing.xl, paddingTop: Spacing.md },
  title: { fontFamily: Fonts.bold, fontSize: 22, color: Colors.navy },
  section: { fontFamily: Fonts.bold, fontSize: 17, color: Colors.navy, marginTop: Spacing.sm },
  rowBetween: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.sm },
  center: { alignItems: 'center' },
  centerText: { textAlign: 'center' },
  muted: { fontFamily: Fonts.regular, fontSize: 13, lineHeight: 19, color: Colors.textMuted },
  note: { fontFamily: Fonts.semibold, fontSize: 13, color: Colors.success },
  error: { fontFamily: Fonts.medium, fontSize: 13, color: Colors.danger },
  link: { fontFamily: Fonts.semibold, fontSize: 14, color: Colors.primary },
  label: { fontFamily: Fonts.medium, fontSize: 14, color: Colors.text },
  field: { gap: Spacing.xs },

  card: {
    padding: Spacing.md,
    gap: Spacing.sm + 2,
    borderRadius: Radius.lg,
    backgroundColor: Colors.white,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  cardTitle: { fontFamily: Fonts.semibold, fontSize: 16, color: Colors.navy },
  benefit: { flexDirection: 'row', gap: Spacing.sm, alignItems: 'flex-start' },
  switchRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md },

  terms: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.sm },
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: Radius.sm - 2,
    borderWidth: 1.5,
    borderColor: Colors.border,
    backgroundColor: Colors.white,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 1,
  },
  checkboxOn: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  termsText: { flex: 1, fontFamily: Fonts.regular, fontSize: 13, lineHeight: 20, color: Colors.textMuted },

  earnings: { backgroundColor: Colors.navy, borderColor: Colors.navy },
  earningsLabel: { fontFamily: Fonts.medium, fontSize: 13, color: '#9FD4F7' },
  earningsValue: { fontFamily: Fonts.bold, fontSize: 26, color: Colors.white },
  earningsHint: { fontFamily: Fonts.regular, fontSize: 12, color: '#C9D6E6' },

  vehicleName: { fontFamily: Fonts.semibold, fontSize: 15, color: Colors.text },
  pill: { fontFamily: Fonts.semibold, fontSize: 11, paddingHorizontal: 8, paddingVertical: 2, borderRadius: Radius.pill, overflow: 'hidden' },
  pillOk: { color: Colors.success, backgroundColor: Colors.successBg },
  pillWait: { color: Colors.warning, backgroundColor: Colors.warningBg },
  pillBad: { color: Colors.danger, backgroundColor: '#FDECEC' },

  mission: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md },
  amount: { fontFamily: Fonts.bold, fontSize: 14, color: Colors.primary },
});

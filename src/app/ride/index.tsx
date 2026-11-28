import Ionicons from '@expo/vector-icons/Ionicons';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LoadError, Loading } from '../../components/load-state';
import { Segmented } from '../../components/pickers';
import { ScreenHeader } from '../../components/screen-header';
import { VehicleImage } from '../../components/vehicle-image';
import { ZokoButton } from '../../components/zoko-button';
import { ZokoInput } from '../../components/zoko-input';
import { ZonePicker } from '../../components/zone-picker';
import { formatPrice } from '../../constants/vehicles';
import { Colors, Fonts, Radius, Spacing } from '../../constants/zoko';
import { useAuth } from '../../lib/auth';
import { useCatalog } from '../../lib/catalog';
import { formatPhone, phoneDigits } from '../../lib/phone';
import { citiesOf, fetchRideQuote, useRideZones, type RideQuote } from '../../lib/rides';
import { useSettings, type Settings } from '../../lib/settings';
import { supabase } from '../../lib/supabase';

type Field = 'from' | 'to' | 'pickup' | 'phone' | 'vehicle' | 'form';

// Immediate ride: departure zone -> arrival zone, flat price per vehicle model
export default function RideScreen() {
  const { settings, error: settingsError, reload: reloadSettings } = useSettings();
  const { zones, error: zonesError, reload: reloadZones } = useRideZones();

  let body;
  if (settings && zones) {
    body =
      !settings.rides_enabled || zones.length === 0 ? (
        <View style={styles.closed}>
          <Ionicons name="time-outline" size={44} color={Colors.textMuted} />
          <Text style={styles.closedText}>Les courses ne sont pas disponibles pour le moment.</Text>
        </View>
      ) : (
        <RideForm settings={settings} zones={zones} />
      );
  } else if (settingsError || zonesError) {
    body = (
      <LoadError
        message={(settingsError ?? zonesError)!}
        onRetry={() => {
          reloadSettings();
          reloadZones();
        }}
      />
    );
  } else {
    body = <Loading />;
  }

  return (
    <SafeAreaView style={styles.flex} edges={['top', 'bottom']}>
      <View style={styles.inner}>
        <ScreenHeader title="Course immédiate" fallback="/home" />
      </View>
      {body}
    </SafeAreaView>
  );
}

function RideForm({ settings, zones }: { settings: Settings; zones: NonNullable<ReturnType<typeof useRideZones>['zones']> }) {
  const { profile } = useAuth();
  const { vehicles } = useCatalog();
  const cities = citiesOf(zones);
  const [city, setCity] = useState(cities.includes(settings.city) ? settings.city : cities[0]);
  const cityZones = zones.filter((z) => z.city === city);

  const [from, setFrom] = useState<string | null>(null);
  const [to, setTo] = useState<string | null>(null);
  const [pickup, setPickup] = useState('');
  const [dropoff, setDropoff] = useState('');
  const [phoneInput, setPhoneInput] = useState<string | null>(null);
  const phone = phoneInput ?? profile?.phone ?? '';
  const [notes, setNotes] = useState('');
  const [modelId, setModelId] = useState<string | null>(null);
  const [errors, setErrors] = useState<Partial<Record<Field, string>>>({});
  const [submitting, setSubmitting] = useState(false);

  // Prices and free vehicles for the chosen route (fetched again when it changes)
  const [quote, setQuote] = useState<{ key: string; items: RideQuote[] | null; error: string | null } | null>(null);
  const [quoteVersion, setQuoteVersion] = useState(0);
  const routeKey = from && to ? `${from}|${to}|${quoteVersion}` : null;

  useEffect(() => {
    if (!from || !to || !routeKey) return;
    let active = true;
    fetchRideQuote(from, to).then(
      (items) => active && setQuote({ key: routeKey, items, error: null }),
      (e: Error) => active && setQuote({ key: routeKey, items: null, error: e.message }),
    );
    return () => {
      active = false;
    };
  }, [from, to, routeKey]);

  const current = quote && quote.key === routeKey ? quote : null;
  const options = current?.items ?? [];
  const chosen = options.find((o) => o.model_id === modelId && o.available_count > 0);
  const noDriver = options.length > 0 && options[0].drivers_free === 0;

  function changeCity(c: string) {
    setCity(c);
    setFrom(null);
    setTo(null);
    setModelId(null);
  }

  async function submit() {
    const next: Partial<Record<Field, string>> = {};
    if (!from) next.from = 'Choisissez la zone de départ';
    if (!to) next.to = 'Choisissez la zone d’arrivée';
    if (!pickup.trim()) next.pickup = 'Indiquez où le chauffeur doit vous prendre';
    const digits = phoneDigits(phone);
    if (!digits) next.phone = 'Numéro invalide (ex. 06 123 45 67)';
    // No price for this route: the card already says so, no second message
    if (from && to && !chosen && options.length > 0) next.vehicle = 'Choisissez un véhicule disponible';
    setErrors(next);
    if (Object.keys(next).length > 0 || !from || !to || !chosen || !digits) return;

    setSubmitting(true);
    // The server sets the start (now), the price, the duration and the reference
    const { data, error } = await supabase
      .from('reservations')
      .insert({
        kind: 'ride',
        model_id: chosen.model_id,
        from_zone_id: from,
        to_zone_id: to,
        pickup_address: pickup.trim(),
        dropoff_address: dropoff.trim() || null,
        contact_phone: formatPhone(digits),
        client_notes: notes.trim() || null,
        start_at: new Date().toISOString(),
        duration_hours: 1,
        base_price: chosen.price,
      })
      .select('id')
      .single();
    setSubmitting(false);
    if (error) {
      setErrors({ form: error.code === 'P0001' ? error.message : 'Commande impossible. Vérifiez votre connexion et réessayez.' });
      setQuoteVersion((v) => v + 1); // availability may have changed
      return;
    }
    router.replace({ pathname: '/reservation/[id]', params: { id: (data as { id: string }).id } });
  }

  return (
    <ScrollView contentContainerStyle={[styles.inner, styles.content]} keyboardShouldPersistTaps="handled">
      <View style={styles.intro}>
        <Ionicons name="flash" size={18} color={Colors.primary} />
        <Text style={styles.introText}>
          Un véhicule avec chauffeur, tout de suite. Prix fixe selon le quartier de départ et d’arrivée, payé au chauffeur à
          l’arrivée.
        </Text>
      </View>

      <View style={styles.card}>
        {cities.length > 1 && <Segmented options={cities.map((c) => ({ value: c, label: c }))} value={city} onChange={changeCity} />}
        <ZonePicker
          label="Départ"
          icon="radio-button-on"
          zones={cityZones}
          value={from}
          onChange={(id) => {
            setFrom(id);
            setModelId(null);
          }}
          error={errors.from}
        />
        <ZonePicker
          label="Arrivée"
          icon="flag"
          zones={cityZones}
          value={to}
          onChange={(id) => {
            setTo(id);
            setModelId(null);
          }}
          error={errors.to}
        />
      </View>

      {from && to && (
        <View style={styles.card}>
          <View style={styles.rowBetween}>
            <Text style={styles.cardTitle}>Véhicule</Text>
            <Pressable onPress={() => setQuoteVersion((v) => v + 1)} hitSlop={8} accessibilityLabel="Actualiser">
              <Ionicons name="refresh" size={18} color={Colors.primary} />
            </Pressable>
          </View>
          {!current && <Loading label="Calcul du prix…" />}
          {current?.error && <LoadError message={current.error} onRetry={() => setQuoteVersion((v) => v + 1)} />}
          {current?.items && options.length === 0 && (
            <Text style={styles.muted}>
              Pas encore de prix pour ce trajet. Appelez-nous depuis Profil &gt; Aide et support, ou choisissez la zone la plus
              proche.
            </Text>
          )}
          {noDriver && <Text style={styles.warning}>Tous nos chauffeurs sont occupés : l’attente peut être plus longue.</Text>}
          {options.map((o) => {
            const v = vehicles?.find((x) => x.id === o.model_id);
            const free = o.available_count > 0;
            const selected = o.model_id === modelId && free;
            return (
              <Pressable
                key={o.model_id}
                onPress={() => free && setModelId(o.model_id)}
                disabled={!free}
                style={[styles.option, selected && styles.optionSelected, !free && styles.optionOff]}
                accessibilityState={{ selected, disabled: !free }}
              >
                <VehicleImage uri={v?.photos[0]} size={28} style={styles.optionImage} />
                <View style={styles.flex1}>
                  <Text style={styles.optionName}>{v ? `${v.brand} ${v.name}` : 'Véhicule'}</Text>
                  <Text style={styles.muted}>
                    {free ? `${v ? `${v.seats} places · ` : ''}environ ${o.ride_minutes} min` : 'Indisponible pour le moment'}
                  </Text>
                </View>
                <Text style={[styles.optionPrice, !free && styles.muted]}>{formatPrice(o.price, settings.currency_label)}</Text>
              </Pressable>
            );
          })}
          {errors.vehicle ? <Text style={styles.error}>{errors.vehicle}</Text> : null}
        </View>
      )}

      <View style={styles.card}>
        <ZokoInput
          label="Où le chauffeur vous prend-il ?"
          icon="location-outline"
          placeholder="Rue, point de repère (ex. devant la pharmacie…)"
          value={pickup}
          onChangeText={setPickup}
          error={errors.pickup}
        />
        <ZokoInput
          label="Destination précise (facultatif)"
          icon="navigate-outline"
          placeholder="Rue, point de repère"
          value={dropoff}
          onChangeText={setDropoff}
        />
        <ZokoInput
          label="Téléphone"
          icon="call-outline"
          keyboardType="phone-pad"
          placeholder="06 123 45 67"
          value={phone}
          onChangeText={setPhoneInput}
          error={errors.phone}
        />
        <ZokoInput label="Remarque (facultatif)" icon="chatbox-outline" placeholder="Bagages, nombre de passagers…" value={notes} onChangeText={setNotes} />
      </View>

      {errors.form ? <Text style={styles.formError}>{errors.form}</Text> : null}

      <View style={styles.summary}>
        <Text style={styles.muted}>À payer au chauffeur</Text>
        <Text style={styles.summaryPrice}>{chosen ? formatPrice(chosen.price, settings.currency_label) : '—'}</Text>
      </View>
      <ZokoButton title="Commander la course" onPress={submit} loading={submitting} />
      <Text style={styles.hint}>
        Courses de {settings.ride_hours.start} à {settings.ride_hours.end}. Un agent confirme et vous attribue un véhicule et un
        chauffeur ; vous recevez une notification.
      </Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: Colors.background },
  flex1: { flex: 1 },
  inner: { width: '100%', maxWidth: 520, alignSelf: 'center', paddingHorizontal: Spacing.lg },
  content: { gap: Spacing.md, paddingBottom: Spacing.xl },
  rowBetween: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  muted: { fontFamily: Fonts.regular, fontSize: 13, lineHeight: 19, color: Colors.textMuted },
  warning: { fontFamily: Fonts.medium, fontSize: 13, color: Colors.warning },
  error: { fontFamily: Fonts.regular, fontSize: 12, color: Colors.danger },
  hint: { fontFamily: Fonts.regular, fontSize: 12, lineHeight: 18, color: Colors.textMuted, textAlign: 'center' },

  closed: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: Spacing.sm, padding: Spacing.xl },
  closedText: { fontFamily: Fonts.regular, fontSize: 14, color: Colors.textMuted, textAlign: 'center' },

  intro: { flexDirection: 'row', gap: Spacing.sm, alignItems: 'flex-start' },
  introText: { flex: 1, fontFamily: Fonts.regular, fontSize: 13, lineHeight: 19, color: Colors.text },

  card: {
    padding: Spacing.md,
    gap: Spacing.md,
    borderRadius: Radius.lg,
    backgroundColor: Colors.white,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  cardTitle: { fontFamily: Fonts.semibold, fontSize: 15, color: Colors.navy },

  option: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    padding: Spacing.sm,
    borderRadius: Radius.md,
    borderWidth: 1.5,
    borderColor: Colors.border,
  },
  optionSelected: { borderColor: Colors.primary, backgroundColor: '#E3F2FC' },
  optionOff: { opacity: 0.5 },
  optionImage: { width: 72, height: 52 },
  optionName: { fontFamily: Fonts.semibold, fontSize: 15, color: Colors.text },
  optionPrice: { fontFamily: Fonts.bold, fontSize: 15, color: Colors.primary },

  summary: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  summaryPrice: { fontFamily: Fonts.bold, fontSize: 20, color: Colors.navy },
  formError: {
    fontFamily: Fonts.medium,
    fontSize: 13,
    color: Colors.danger,
    backgroundColor: '#FDECEC',
    padding: Spacing.md,
    borderRadius: Radius.md,
    textAlign: 'center',
  },
});

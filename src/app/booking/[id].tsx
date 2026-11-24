import Ionicons from '@expo/vector-icons/Ionicons';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState, type ReactNode } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LoadError, Loading } from '../../components/load-state';
import { DriverPicker, type Driver, type DriversState } from '../../components/driver-picker';
import { DayPicker, Segmented, TimePicker } from '../../components/pickers';
import { VehicleImage } from '../../components/vehicle-image';
import { ZokoButton } from '../../components/zoko-button';
import { ZokoInput } from '../../components/zoko-input';
import { bookableDays, fromISODate, offsetMinutes, timeSlots, toISODate, toTimestamp } from '../../constants/dates';
import { formatPrice } from '../../constants/vehicles';
import { Colors, Fonts, Radius, Spacing } from '../../constants/zoko';
import { useAuth } from '../../lib/auth';
import { useCatalog, type CatalogVehicle } from '../../lib/catalog';
import { formatPhone, phoneDigits } from '../../lib/phone';
import { useSettings, type Settings } from '../../lib/settings';
import { supabase } from '../../lib/supabase';

// edit = id of an existing reservation to modify
type Params = { id: string; date?: string; duration?: string; place?: string; edit?: string };

// Existing reservation (edit mode)
type Existing = {
  id: string;
  status: string;
  start_at: string;
  duration_hours: number;
  pickup_address: string;
  dropoff_address: string | null;
  contact_phone: string;
  client_notes: string | null;
  discount_amount: number;
  with_driver: boolean;
  driver_id: string | null;
  client_license_number: string | null;
};

// ISO timestamp -> { date: "2026-11-29", time: "08:30" } in the company's time zone
function splitBusiness(iso: string, utcOffset: string) {
  const d = new Date(new Date(iso).getTime() + offsetMinutes(utcOffset) * 60_000);
  const pad = (n: number) => String(n).padStart(2, '0');
  return {
    date: `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`,
    time: `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`,
  };
}

type Promo = {
  id: string;
  code: string;
  description: string | null;
  discount_type: 'percent' | 'fixed';
  discount_value: number;
};

type Availability = { state: 'loading' } | { state: 'ok'; count: number } | { state: 'error' };

type Errors = { pickup?: string; phone?: string; license?: string; promo?: string; form?: string };

const goBack = () => (router.canGoBack() ? router.back() : router.replace('/home'));

export default function BookingScreen() {
  const params = useLocalSearchParams<Params>();
  const catalog = useCatalog();
  const { settings, error: settingsError, reload: reloadSettings } = useSettings();
  const vehicle = catalog.vehicles?.find((v) => v.id === params.id);

  // Edit mode: load the reservation to modify
  const [existing, setExisting] = useState<Existing | null>(null);
  const [existingError, setExistingError] = useState<string | null>(null);
  useEffect(() => {
    if (!params.edit) return;
    let active = true;
    supabase
      .from('reservations')
      .select(
        'id, status, start_at, duration_hours, pickup_address, dropoff_address, contact_phone, client_notes, discount_amount, with_driver, driver_id, client_license_number',
      )
      .eq('id', params.edit)
      .maybeSingle()
      .then(({ data, error }) => {
        if (!active) return;
        if (error || !data) setExistingError('Impossible de charger la réservation à modifier.');
        else setExisting(data as Existing);
      });
    return () => {
      active = false;
    };
  }, [params.edit]);

  const waitingExisting = !!params.edit && !existing;

  if (!vehicle || !settings || waitingExisting) {
    const error = catalog.error ?? settingsError ?? existingError;
    return (
      <Screen title={params.edit ? 'Modifier la réservation' : 'Réservation'}>
        {error ? (
          <LoadError
            message={error}
            onRetry={() => {
              catalog.reload();
              reloadSettings();
            }}
          />
        ) : catalog.vehicles && !vehicle ? (
          <LoadError message="Ce véhicule n'est plus disponible." />
        ) : (
          <Loading />
        )}
      </Screen>
    );
  }

  return <BookingForm vehicle={vehicle} settings={settings} params={params} existing={existing} />;
}

type FormProps = { vehicle: CatalogVehicle; settings: Settings; params: Params; existing: Existing | null };

function BookingForm({ vehicle, settings, params, existing }: FormProps) {
  const editing = !!existing;
  const original = existing ? splitBusiness(existing.start_at, settings.utc_offset) : null;
  const { session, profile } = useAuth();
  const currency = settings.currency_label;

  // Choices offered all come from the database (settings + rates)
  const days = bookableDays(settings.utc_offset, settings.min_days_ahead, settings.max_days_ahead);
  const slots = timeSlots(settings.booking_hours);
  const durations = vehicle.durations;

  const [date, setDate] = useState(() => {
    if (original) return original.date;
    const wanted = fromISODate(params.date);
    const ok = wanted && days.some((d) => d.getTime() === wanted.getTime());
    return ok ? params.date! : days[0] ? toISODate(days[0]) : '';
  });
  const [time, setTime] = useState(original?.time ?? (slots.includes('08:00') ? '08:00' : (slots[0] ?? '')));
  const [duration, setDuration] = useState(
    existing?.duration_hours ?? durations.find((d) => String(d) === params.duration) ?? durations[0],
  );
  const [pickup, setPickup] = useState(existing?.pickup_address ?? params.place ?? '');
  const [dropoff, setDropoff] = useState(existing?.dropoff_address ?? '');
  const [phoneInput, setPhoneInput] = useState<string | null>(existing?.contact_phone ?? null);
  const phone = phoneInput ?? profile?.phone ?? '';
  const [notes, setNotes] = useState(existing?.client_notes ?? '');

  // With or without a driver; null driverId = let Zoko choose
  const [withDriver, setWithDriver] = useState(existing?.with_driver ?? true);
  const [driverId, setDriverId] = useState<string | null>(existing?.driver_id ?? null);
  const [license, setLicense] = useState(existing?.client_license_number ?? '');

  const [promoInput, setPromoInput] = useState('');
  const [promo, setPromo] = useState<Promo | null>(null);
  const [checkingPromo, setCheckingPromo] = useState(false);

  const [errors, setErrors] = useState<Errors>({});
  const [submitting, setSubmitting] = useState(false);

  // Real-time availability for the chosen slot
  const startAt = date && time ? toTimestamp(date, time, settings.utc_offset) : null;
  const slotKey = `${startAt}|${duration}`;
  const [checked, setChecked] = useState<{ key: string; result: Availability } | null>(null);
  // Answer for another slot = still checking the current one
  const availability: Availability = checked?.key === slotKey ? checked.result : { state: 'loading' };

  useEffect(() => {
    if (!startAt || !duration) return;
    let active = true;
    const args = { p_start: startAt, p_duration: duration, ...(existing && { p_exclude_reservation: existing.id }) };
    supabase.rpc('available_models', args).then(({ data, error }) => {
      if (!active) return;
      const row = (data as { model_id: string; available_count: number }[] | null)?.find(
        (r) => r.model_id === vehicle.id,
      );
      setChecked({
        key: `${startAt}|${duration}`,
        result: error ? { state: 'error' } : { state: 'ok', count: row?.available_count ?? 0 },
      });
    });
    return () => {
      active = false;
    };
  }, [startAt, duration, vehicle.id, existing]);

  const unavailable = availability.state === 'ok' && availability.count === 0;

  // Drivers free for the chosen slot (only fetched when a driver is wanted)
  const [driversChecked, setDriversChecked] = useState<{ key: string; result: DriversState } | null>(null);
  const drivers: DriversState = driversChecked?.key === slotKey ? driversChecked.result : { state: 'loading' };

  useEffect(() => {
    if (!withDriver || !startAt || !duration) return;
    let active = true;
    const args = { p_start: startAt, p_duration: duration, ...(existing && { p_exclude_reservation: existing.id }) };
    supabase.rpc('available_drivers', args).then(({ data, error }) => {
      if (!active) return;
      setDriversChecked({
        key: `${startAt}|${duration}`,
        result: error ? { state: 'error' } : { state: 'ok', drivers: (data as Driver[] | null) ?? [] },
      });
    });
    return () => {
      active = false;
    };
  }, [withDriver, startAt, duration, existing]);

  const driverTaken =
    withDriver &&
    driverId !== null &&
    drivers.state === 'ok' &&
    !drivers.drivers.some((d) => d.driver_id === driverId);

  // Estimated price (the database recalculates it when saving)
  const base = vehicle.prices[duration] ?? 0;
  const keptDiscount = existing && duration === existing.duration_hours ? Math.min(base, existing.discount_amount) : 0;
  const discount = existing
    ? keptDiscount
    : promo
      ? Math.min(
          base,
          promo.discount_type === 'percent' ? Math.floor((base * promo.discount_value) / 100) : promo.discount_value,
        )
      : 0;
  const total = base - discount;

  async function applyPromo() {
    const code = promoInput.trim();
    if (!code) return;
    setCheckingPromo(true);
    const { data, error } = await supabase.rpc('check_promo_code', { p_code: code });
    setCheckingPromo(false);
    const found = (data as Promo[] | null)?.[0];
    if (error || !found) {
      setPromo(null);
      setErrors((e) => ({
        ...e,
        promo: error ? 'Vérification impossible, réessayez' : 'Code promo invalide ou expiré',
      }));
      return;
    }
    setPromo(found);
    setErrors((e) => ({ ...e, promo: undefined }));
  }

  async function handleSubmit() {
    const next: Errors = {};
    if (!pickup.trim()) next.pickup = 'Indiquez le lieu de prise en charge';
    const digits = phoneDigits(phone);
    if (!digits) next.phone = 'Entrez un numéro valide (ex. 06 123 45 67)';
    if (!withDriver && !license.trim()) next.license = 'Indiquez votre numéro de permis de conduire';
    if (driverTaken) next.form = 'Le chauffeur choisi n’est pas libre à ce créneau. Choisissez-en un autre.';
    if (unavailable) next.form = 'Ce véhicule n’est plus disponible à ce créneau. Choisissez une autre date ou heure.';
    setErrors(next);
    if (Object.keys(next).length > 0 || !session || !startAt || !digits) return;

    setSubmitting(true);

    const driverChoice = {
      with_driver: withDriver,
      driver_id: withDriver ? driverId : null,
      client_license_number: withDriver ? null : license.trim(),
    };

    if (existing) {
      const { error } = await supabase
        .from('reservations')
        .update({
          start_at: startAt,
          duration_hours: duration,
          pickup_address: pickup.trim(),
          dropoff_address: dropoff.trim() || null,
          contact_phone: formatPhone(digits),
          client_notes: notes.trim() || null,
          ...driverChoice,
        })
        .eq('id', existing.id);
      setSubmitting(false);
      if (error) {
        setErrors({
          form:
            error.code === 'P0001' ? error.message : 'Modification impossible. Vérifiez votre connexion et réessayez.',
        });
        return;
      }
      // Back to the status page, which reloads itself
      if (router.canGoBack()) router.back();
      else router.replace({ pathname: '/reservation/[id]', params: { id: existing.id } });
      return;
    }

    const { data, error } = await supabase
      .from('reservations')
      .insert({
        client_id: session.user.id,
        model_id: vehicle.id,
        start_at: startAt,
        duration_hours: duration,
        pickup_address: pickup.trim(),
        dropoff_address: dropoff.trim() || null,
        contact_phone: formatPhone(digits),
        client_notes: notes.trim() || null,
        promotion_id: promo?.id ?? null,
        ...driverChoice,
        base_price: 0, // computed by the database
      })
      .select('id')
      .single();
    setSubmitting(false);

    if (error) {
      // Business-rule errors from the database are already written in French
      setErrors({
        form: error.code === 'P0001' ? error.message : 'Réservation impossible. Vérifiez votre connexion et réessayez.',
      });
      return;
    }
    // Next step: payment
    router.replace({ pathname: '/payment/[id]', params: { id: (data as { id: string }).id } });
  }

  const conditions = [
    ...(settings.included_fuel_liters > 0
      ? [`${settings.included_fuel_liters} L de carburant inclus, le reste est à votre charge`]
      : []),
    `Annulation remboursée jusqu’à ${settings.free_cancel_until_days_before} jour(s) avant` +
      (settings.same_day_cancel_refund_pct > 0
        ? ` ; le jour même, ${settings.same_day_cancel_refund_pct} % remboursé`
        : ''),
    ...settings.booking_conditions,
  ];

  const driverChanged =
    !!existing && (withDriver !== existing.with_driver || (withDriver && driverId !== existing.driver_id));
  const backToPending =
    existing?.status === 'confirmed' &&
    (date !== original?.date || time !== original?.time || duration !== existing.duration_hours || driverChanged);

  return (
    <Screen
      title={editing ? 'Modifier la réservation' : 'Réservation'}
      footer={
        <View style={styles.footer}>
          <View>
            <Text style={styles.footerLabel}>Prix estimé</Text>
            <Text style={styles.footerPrice}>{formatPrice(total, currency)}</Text>
          </View>
          <View style={styles.flex1}>
            <ZokoButton
              title={editing ? 'Enregistrer' : 'Continuer'}
              onPress={handleSubmit}
              loading={submitting}
              disabled={unavailable || driverTaken}
            />
          </View>
        </View>
      }
    >
      {/* Vehicle */}
      <View style={[styles.card, styles.vehicleRow]}>
        <VehicleImage uri={vehicle.photos[0]} size={40} style={styles.vehicleImage} />
        <View style={styles.flex1}>
          <Text style={styles.vehicleName}>
            {vehicle.brand} {vehicle.name}
          </Text>
          {durations.map((d) => (
            <Text key={d} style={styles.muted}>
              {formatPrice(vehicle.prices[d], currency)} / {d} h
            </Text>
          ))}
        </View>
      </View>

      {/* Date */}
      <Field label="Date de début">
        <DayPicker days={days} value={date} onChange={setDate} />
      </Field>

      {/* Time */}
      <Field label="Heure de début">
        <TimePicker slots={slots} value={time} onChange={setTime} />
      </Field>

      {/* Duration */}
      <Field label="Durée">
        <Segmented
          options={durations.map((h) => ({ value: h, label: `${h} h` }))}
          value={duration}
          onChange={setDuration}
        />
      </Field>

      {/* Availability */}
      <AvailabilityBadge availability={availability} />
      {backToPending && (
        <Text style={styles.warning}>
          Changer la date, l’heure, la durée ou le chauffeur remet votre réservation en attente : un agent devra la
          confirmer à nouveau.
        </Text>
      )}

      {/* Driver: with (choose one, or let Zoko choose) or without (client drives) */}
      <Field label="Chauffeur">
        <Segmented
          options={[
            { value: 'with', label: 'Avec chauffeur' },
            { value: 'without', label: 'Sans chauffeur' },
          ]}
          value={withDriver ? 'with' : 'without'}
          onChange={(v) => setWithDriver(v === 'with')}
        />
      </Field>
      {withDriver ? (
        <DriverPicker drivers={drivers} value={driverId} onChange={setDriverId} />
      ) : (
        <>
          <Text style={styles.muted}>
            Vous conduisez vous-même. Votre permis sera vérifié à la remise du véhicule ; le prix reste le même.
          </Text>
          <ZokoInput
            label="Numéro de permis de conduire"
            icon="card-outline"
            placeholder="N° inscrit sur votre permis"
            autoCapitalize="characters"
            value={license}
            onChangeText={setLicense}
            error={errors.license}
          />
        </>
      )}

      {/* Places + contact */}
      <ZokoInput
        label="Lieu de prise en charge"
        icon="location-outline"
        placeholder="Adresse de votre choix"
        value={pickup}
        onChangeText={setPickup}
        error={errors.pickup}
      />
      <ZokoInput
        label="Lieu de restitution (facultatif)"
        icon="flag-outline"
        placeholder="Si différent du lieu de prise en charge"
        value={dropoff}
        onChangeText={setDropoff}
      />
      <ZokoInput
        label="Téléphone de contact"
        icon="call-outline"
        placeholder="06 123 45 67"
        keyboardType="phone-pad"
        value={phone}
        onChangeText={setPhoneInput}
        error={errors.phone}
      />
      <ZokoInput
        label="Remarque pour l’agent (facultatif)"
        icon="chatbubble-ellipses-outline"
        placeholder="Ex. vol à l’arrivée, nombre de bagages…"
        value={notes}
        onChangeText={setNotes}
      />

      {/* Promo code (new bookings only: an existing booking keeps its promotion) */}
      {!editing && (
        <View style={styles.promoRow}>
          <View style={styles.flex1}>
            <ZokoInput
              label="Code promo (facultatif)"
              icon="pricetag-outline"
              placeholder="Ex. BIENVENUE"
              autoCapitalize="characters"
              value={promoInput}
              onChangeText={(t) => {
                setPromoInput(t);
                setPromo(null);
              }}
              error={errors.promo}
            />
          </View>
          <Pressable onPress={applyPromo} style={styles.promoButton} disabled={checkingPromo || !promoInput.trim()}>
            <Text style={styles.promoButtonText}>{checkingPromo ? '…' : 'Appliquer'}</Text>
          </Pressable>
        </View>
      )}
      {promo && (
        <Text style={styles.promoOk}>
          ✓ {promo.code} appliqué{promo.description ? ` : ${promo.description}` : ''}
        </Text>
      )}

      {/* Price summary */}
      <View style={styles.card}>
        <Row label={`Location ${duration} h`} value={formatPrice(base, currency)} />
        {discount > 0 && <Row label="Réduction" value={`- ${formatPrice(discount, currency)}`} accent />}
        <View style={styles.divider} />
        <Row label="Total estimé" value={formatPrice(total, currency)} bold />
        {existing && existing.discount_amount > 0 && duration !== existing.duration_hours && (
          <Text style={styles.muted}>Votre réduction sera recalculée pour la nouvelle durée.</Text>
        )}
        {editing && <Text style={styles.muted}>Si le prix change, le solde à payer ou à rembourser sera ajusté.</Text>}
      </View>

      {/* Conditions */}
      <View style={styles.conditions}>
        <Text style={styles.conditionsTitle}>Bon à savoir</Text>
        {conditions.map((c) => (
          <View key={c} style={styles.conditionRow}>
            <Ionicons name="information-circle-outline" size={16} color={Colors.primary} />
            <Text style={styles.conditionText}>{c}</Text>
          </View>
        ))}
      </View>

      {errors.form ? <Text style={styles.formError}>{errors.form}</Text> : null}
    </Screen>
  );
}

function AvailabilityBadge({ availability }: { availability: Availability }) {
  if (availability.state === 'loading') {
    return (
      <View style={[styles.badge, styles.badgeNeutral]}>
        <Ionicons name="time-outline" size={16} color={Colors.textMuted} />
        <Text style={[styles.badgeText, { color: Colors.textMuted }]}>Vérification de la disponibilité…</Text>
      </View>
    );
  }
  if (availability.state === 'error') {
    return (
      <View style={[styles.badge, styles.badgeNeutral]}>
        <Ionicons name="cloud-offline-outline" size={16} color={Colors.textMuted} />
        <Text style={[styles.badgeText, { color: Colors.textMuted }]}>Disponibilité non vérifiée (connexion)</Text>
      </View>
    );
  }
  const free = availability.count > 0;
  return (
    <View style={[styles.badge, { backgroundColor: free ? Colors.successBg : '#FDECEC' }]}>
      <Ionicons
        name={free ? 'checkmark-circle' : 'close-circle'}
        size={16}
        color={free ? Colors.success : Colors.danger}
      />
      <Text style={[styles.badgeText, { color: free ? Colors.success : Colors.danger }]}>
        {free ? 'Disponible à ce créneau' : 'Indisponible à ce créneau'}
      </Text>
    </View>
  );
}

function Screen({ title, children, footer }: { title: string; children: ReactNode; footer?: ReactNode }) {
  return (
    <SafeAreaView style={styles.flex} edges={['top']}>
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={[styles.inner, styles.header]}>
          <Pressable onPress={goBack} style={styles.back} hitSlop={10} accessibilityLabel="Retour">
            <Ionicons name="chevron-back" size={22} color={Colors.text} />
          </Pressable>
          <Text style={styles.title}>{title}</Text>
        </View>
        <ScrollView contentContainerStyle={[styles.inner, styles.content]} keyboardShouldPersistTaps="handled">
          {children}
        </ScrollView>
        {footer && (
          <SafeAreaView edges={['bottom']} style={styles.footerBar}>
            <View style={styles.inner}>{footer}</View>
          </SafeAreaView>
        )}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      {children}
    </View>
  );
}

function Row({ label, value, bold, accent }: { label: string; value: string; bold?: boolean; accent?: boolean }) {
  return (
    <View style={styles.row}>
      <Text style={[styles.rowLabel, bold && styles.bold]}>{label}</Text>
      <Text style={[styles.rowValue, bold && styles.rowValueBold, accent && { color: Colors.success }]}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: Colors.background },
  flex1: { flex: 1 },
  bold: { fontFamily: Fonts.semibold, color: Colors.text },
  muted: { fontFamily: Fonts.regular, fontSize: 13, color: Colors.textMuted },
  inner: { width: '100%', maxWidth: 520, alignSelf: 'center', paddingHorizontal: Spacing.lg },

  header: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, paddingVertical: Spacing.md },
  back: {
    width: 40,
    height: 40,
    borderRadius: Radius.pill,
    backgroundColor: Colors.white,
    borderWidth: 1,
    borderColor: Colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: { fontFamily: Fonts.bold, fontSize: 20, color: Colors.navy },
  content: { gap: Spacing.md + 4, paddingBottom: Spacing.xl },

  card: {
    padding: Spacing.md,
    gap: Spacing.sm,
    borderRadius: Radius.lg,
    backgroundColor: Colors.white,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  vehicleRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md },
  vehicleImage: { width: 88, height: 70 },
  vehicleName: { fontFamily: Fonts.semibold, fontSize: 16, color: Colors.text },

  field: { gap: Spacing.xs },
  label: { fontFamily: Fonts.medium, fontSize: 14, color: Colors.text },

  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm + 2,
    borderRadius: Radius.md,
  },
  badgeNeutral: { backgroundColor: Colors.white, borderWidth: 1, borderColor: Colors.border },
  badgeText: { fontFamily: Fonts.medium, fontSize: 13 },

  warning: {
    fontFamily: Fonts.medium,
    fontSize: 13,
    lineHeight: 19,
    color: Colors.warning,
    backgroundColor: Colors.warningBg,
    padding: Spacing.sm + 4,
    borderRadius: Radius.md,
  },
  promoRow: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.sm },
  promoButton: {
    marginTop: 26,
    height: 52,
    paddingHorizontal: Spacing.md,
    borderRadius: Radius.md,
    borderWidth: 1.5,
    borderColor: Colors.primary,
    backgroundColor: Colors.white,
    alignItems: 'center',
    justifyContent: 'center',
  },
  promoButtonText: { fontFamily: Fonts.semibold, fontSize: 14, color: Colors.primary },
  promoOk: { fontFamily: Fonts.medium, fontSize: 13, color: Colors.success, marginTop: -Spacing.sm },

  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', gap: Spacing.md },
  rowLabel: { fontFamily: Fonts.regular, fontSize: 14, color: Colors.textMuted, flexShrink: 1 },
  rowValue: { fontFamily: Fonts.medium, fontSize: 14, color: Colors.text, textAlign: 'right', flexShrink: 1 },
  rowValueBold: { fontFamily: Fonts.bold, fontSize: 17, color: Colors.primary },
  divider: { height: 1, backgroundColor: Colors.border, marginVertical: 2 },

  conditions: { gap: Spacing.sm },
  conditionsTitle: { fontFamily: Fonts.semibold, fontSize: 14, color: Colors.navy },
  conditionRow: { flexDirection: 'row', gap: Spacing.sm, alignItems: 'flex-start' },
  conditionText: { flex: 1, fontFamily: Fonts.regular, fontSize: 13, lineHeight: 19, color: Colors.textMuted },

  formError: {
    fontFamily: Fonts.medium,
    fontSize: 13,
    color: Colors.danger,
    backgroundColor: '#FDECEC',
    padding: Spacing.md,
    borderRadius: Radius.md,
    textAlign: 'center',
  },

  footerBar: { backgroundColor: Colors.white, borderTopWidth: 1, borderTopColor: Colors.border },
  footer: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, paddingVertical: Spacing.sm + 4 },
  footerLabel: { fontFamily: Fonts.regular, fontSize: 12, color: Colors.textMuted },
  footerPrice: { fontFamily: Fonts.bold, fontSize: 16, color: Colors.navy },
});

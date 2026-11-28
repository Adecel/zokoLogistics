import Ionicons from '@expo/vector-icons/Ionicons';
import { useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LoadError, Loading } from '../../../components/load-state';
import { DayPicker, TimePicker } from '../../../components/pickers';
import { ScreenHeader } from '../../../components/screen-header';
import { ZokoButton } from '../../../components/zoko-button';
import { bookableDays, formatBusinessDateTime, timeSlots, toISODate, toTimestamp } from '../../../constants/dates';
import { Colors, Fonts, Radius, Spacing } from '../../../constants/zoko';
import { useAuth } from '../../../lib/auth';
import { dbMessage, DRIVE_MODES, type AvailabilitySlot, type DriveMode, type FleetVehicle, type Partner } from '../../../lib/partner';
import { useSettings, type Settings } from '../../../lib/settings';
import { supabase } from '../../../lib/supabase';

type Data = { vehicle: FleetVehicle & { model_name: string }; partner: Partner; slots: AvailabilitySlot[] };

const ALL_DAY = timeSlots({ start: '00:00', end: '23:30', step_minutes: 30 });

// An approved partner vehicle: available now, who drives, future availability
export default function PartnerVehicleScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { session } = useAuth();
  const { settings } = useSettings();
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!session) return;
    const [v, p, s] = await Promise.all([
      supabase
        .from('vehicles')
        .select('id, plate_number, status, drive_mode, available_now, available_now_at, model:model_id(brand, name)')
        .eq('id', id)
        .maybeSingle(),
      supabase.from('partners').select('profile_id, status, city, drives_self, license_number, message, review_note, created_at').eq('profile_id', session.user.id).maybeSingle(),
      supabase
        .from('vehicle_availability')
        .select('id, vehicle_id, start_at, end_at, note')
        .eq('vehicle_id', id)
        .gte('end_at', new Date().toISOString())
        .order('start_at'),
    ]);
    if (v.error || p.error || s.error || !v.data || !p.data) {
      setError('Impossible de charger le véhicule. Vérifiez votre connexion.');
      return;
    }
    const raw = v.data as unknown as FleetVehicle & { model: { brand: string; name: string } | null };
    setError(null);
    setData({
      vehicle: { ...raw, model_name: raw.model ? `${raw.model.brand} ${raw.model.name}` : '' },
      partner: p.data as Partner,
      slots: s.data as AvailabilitySlot[],
    });
  }, [id, session]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  return (
    <SafeAreaView style={styles.flex} edges={['top', 'bottom']}>
      <View style={styles.inner}>
        <ScreenHeader title={data ? data.vehicle.plate_number : 'Mon véhicule'} fallback="/partner" />
      </View>
      {data && settings ? <Content data={data} settings={settings} onChanged={load} /> : error ? <LoadError message={error} onRetry={load} /> : <Loading />}
    </SafeAreaView>
  );
}

function Content({ data, settings, onChanged }: { data: Data; settings: Settings; onChanged: () => void }) {
  const { vehicle: v, partner, slots } = data;
  const [err, setErr] = useState<string | null>(null);
  const [availableNow, setAvailableNow] = useState(v.available_now);
  const modes: DriveMode[] = partner.drives_self ? ['either', 'owner', 'zoko'] : ['zoko'];

  async function update(values: { p_available_now?: boolean; p_drive_mode?: DriveMode }) {
    setErr(null);
    const { error } = await supabase.rpc('partner_set_vehicle', { p_vehicle_id: v.id, ...values });
    if (error) {
      setErr(dbMessage(error, 'Changement impossible. Vérifiez votre connexion.'));
      return false;
    }
    onChanged();
    return true;
  }

  async function removeSlot(slot: AvailabilitySlot) {
    const { error } = await supabase.from('vehicle_availability').delete().eq('id', slot.id);
    if (error) setErr(dbMessage(error, 'Suppression impossible.'));
    else onChanged();
  }

  const fmt = (iso: string) => formatBusinessDateTime(iso, settings.utc_offset);

  return (
    <ScrollView contentContainerStyle={[styles.inner, styles.content]} keyboardShouldPersistTaps="handled">
      <Text style={styles.muted}>{v.model_name}</Text>
      {v.status !== 'available' && (
        <Text style={styles.notice}>
          {v.status === 'maintenance' ? 'En entretien' : 'Hors service'} selon Zoko : il n’est pas proposé aux clients pour le moment.
        </Text>
      )}
      {err ? <Text style={styles.notice}>{err}</Text> : null}

      <View style={styles.card}>
        <View style={styles.switchRow}>
          <View style={styles.flex1}>
            <Text style={styles.cardTitle}>Disponible maintenant</Text>
            <Text style={styles.muted}>
              Pour les courses immédiates. Désactivez-le dès que vous n’êtes plus disponible.
              {v.available_now_at ? ` Modifié ${fmt(v.available_now_at)}.` : ''}
            </Text>
          </View>
          <Switch
            value={availableNow}
            onValueChange={async (next) => {
              setAvailableNow(next);
              if (!(await update({ p_available_now: next }))) setAvailableNow(!next);
            }}
            trackColor={{ true: Colors.success }}
          />
        </View>
      </View>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>Qui conduit ?</Text>
        {modes.map((m) => {
          const selected = m === v.drive_mode;
          return (
            <Pressable
              key={m}
              onPress={() => !selected && update({ p_drive_mode: m })}
              style={[styles.option, selected && styles.optionSelected]}
              accessibilityState={{ selected }}
            >
              <Ionicons name={selected ? 'radio-button-on' : 'radio-button-off'} size={20} color={Colors.primary} />
              <View style={styles.flex1}>
                <Text style={styles.label}>{DRIVE_MODES[m].label}</Text>
                <Text style={styles.muted}>{DRIVE_MODES[m].hint}</Text>
              </View>
            </Pressable>
          );
        })}
        <Text style={styles.muted}>Ne change pas les missions déjà attribuées.</Text>
      </View>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>Disponibilités à venir</Text>
        <Text style={styles.muted}>Pour les réservations : votre véhicule n’est proposé que pendant ces plages.</Text>
        {slots.length === 0 && <Text style={styles.muted}>Aucune plage. Ajoutez-en une ci-dessous.</Text>}
        {slots.map((s) => (
          <View key={s.id} style={styles.slot}>
            <Ionicons name="calendar-outline" size={18} color={Colors.primary} />
            <Text style={[styles.label, styles.flex1]}>
              {fmt(s.start_at)} → {fmt(s.end_at)}
            </Text>
            <Pressable onPress={() => removeSlot(s)} hitSlop={8} accessibilityLabel="Supprimer cette plage">
              <Ionicons name="trash-outline" size={18} color={Colors.danger} />
            </Pressable>
          </View>
        ))}
      </View>

      <AddSlot vehicleId={v.id} settings={settings} onAdded={onChanged} />
    </ScrollView>
  );
}

function AddSlot({ vehicleId, settings, onAdded }: { vehicleId: string; settings: Settings; onAdded: () => void }) {
  const days = bookableDays(settings.utc_offset, 0, 60);
  const [startDay, setStartDay] = useState(toISODate(days[0]));
  const [startTime, setStartTime] = useState('08:00');
  const [endDay, setEndDay] = useState(toISODate(days[0]));
  const [endTime, setEndTime] = useState('18:00');
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function add() {
    const start = toTimestamp(startDay, startTime, settings.utc_offset);
    const end = toTimestamp(endDay, endTime, settings.utc_offset);
    if (new Date(end) <= new Date(start)) return setErr('La fin doit être après le début.');
    if (new Date(end) <= new Date()) return setErr('Cette plage est déjà passée.');
    setSaving(true);
    setErr(null);
    const { error } = await supabase.from('vehicle_availability').insert({ vehicle_id: vehicleId, start_at: start, end_at: end });
    setSaving(false);
    if (error) return setErr(error.code === '23514' ? 'Une plage dure au plus 62 jours.' : dbMessage(error, 'Ajout impossible.'));
    onAdded();
  }

  return (
    <View style={styles.card}>
      <Text style={styles.cardTitle}>Ajouter une plage</Text>
      <Text style={styles.label}>Du</Text>
      <DayPicker
        days={days}
        value={startDay}
        onChange={(d) => {
          setStartDay(d);
          if (d > endDay) setEndDay(d);
        }}
      />
      <TimePicker slots={ALL_DAY} value={startTime} onChange={setStartTime} />
      <Text style={styles.label}>Au</Text>
      <DayPicker days={days.filter((d) => toISODate(d) >= startDay)} value={endDay} onChange={setEndDay} />
      <TimePicker slots={ALL_DAY} value={endTime} onChange={setEndTime} />
      {err ? <Text style={styles.error}>{err}</Text> : null}
      <ZokoButton title="Ajouter cette disponibilité" onPress={add} loading={saving} />
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: Colors.background },
  flex1: { flex: 1 },
  inner: { width: '100%', maxWidth: 520, alignSelf: 'center', paddingHorizontal: Spacing.lg },
  content: { gap: Spacing.md, paddingBottom: Spacing.xl },
  card: {
    padding: Spacing.md,
    gap: Spacing.sm + 2,
    borderRadius: Radius.lg,
    backgroundColor: Colors.white,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  cardTitle: { fontFamily: Fonts.semibold, fontSize: 15, color: Colors.navy },
  label: { fontFamily: Fonts.medium, fontSize: 14, color: Colors.text },
  muted: { fontFamily: Fonts.regular, fontSize: 13, lineHeight: 19, color: Colors.textMuted },
  error: { fontFamily: Fonts.medium, fontSize: 13, color: Colors.danger },
  notice: { fontFamily: Fonts.medium, fontSize: 13, color: Colors.danger, backgroundColor: '#FDECEC', padding: Spacing.md, borderRadius: Radius.md },
  switchRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md },
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
  slot: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, paddingVertical: 4 },
});

import Ionicons from '@expo/vector-icons/Ionicons';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useState, type ComponentProps } from 'react';
import { Linking, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LoadError, Loading } from '../../../components/load-state';
import { ScreenHeader } from '../../../components/screen-header';
import { ZokoButton } from '../../../components/zoko-button';
import { ZokoInput } from '../../../components/zoko-input';
import { formatBusinessDateTime } from '../../../constants/dates';
import { formatPrice } from '../../../constants/vehicles';
import { Colors, Fonts, Radius, Spacing } from '../../../constants/zoko';
import { dbMessage, MISSION_STATUS, type Mission } from '../../../lib/partner';
import { phoneDigits } from '../../../lib/phone';
import { useSettings } from '../../../lib/settings';
import { supabase } from '../../../lib/supabase';

type IconName = ComponentProps<typeof Ionicons>['name'];

// One mission of a partner vehicle; a confirmed one can be declined
export default function MissionScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { settings } = useSettings();
  const [mission, setMission] = useState<Mission | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const { data, error: err } = await supabase.rpc('partner_missions');
    if (err) return setError('Impossible de charger la mission. Vérifiez votre connexion.');
    const found = (data as Mission[]).find((m) => m.id === id);
    if (!found) return setError('Mission introuvable : elle a peut-être été réattribuée.');
    setError(null);
    setMission(found);
  }, [id]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  const [declining, setDeclining] = useState(false);
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function decline() {
    if (!reason.trim()) return setErr('Indiquez pourquoi vous refusez.');
    setSaving(true);
    setErr(null);
    const { error: e } = await supabase.rpc('partner_decline_mission', { p_reservation_id: id, p_reason: reason.trim() });
    setSaving(false);
    if (e) return setErr(dbMessage(e, 'Refus impossible. Vérifiez votre connexion.'));
    router.back();
  }

  let body;
  if (mission && settings) {
    const m = mission;
    const fmt = (iso: string) => formatBusinessDateTime(iso, settings.utc_offset);
    const phone = m.contact_phone ? phoneDigits(m.contact_phone) : null;
    body = (
      <ScrollView contentContainerStyle={[styles.inner, styles.content]} keyboardShouldPersistTaps="handled">
        <View style={styles.card}>
          <Text style={styles.cardTitle}>
            {m.kind === 'ride' ? `Course ${m.from_zone_name ?? ''} → ${m.to_zone_name ?? ''}` : 'Location'}
          </Text>
          <Text style={styles.muted}>
            {m.reference} · {MISSION_STATUS[m.status]}
          </Text>
          <Row icon="car-outline" label="Véhicule" value={`${m.model_name} · ${m.plate_number}`} />
          <Row icon="calendar-outline" label="Début" value={fmt(m.start_at)} />
          <Row icon="time-outline" label={m.kind === 'ride' ? 'Véhicule libre vers' : 'Fin prévue'} value={fmt(m.end_at)} />
          <Row icon="location-outline" label="Prise en charge" value={m.pickup_address} />
          {m.dropoff_address ? <Row icon="flag-outline" label="Destination" value={m.dropoff_address} /> : null}
          <Row
            icon="person-outline"
            label="Qui conduit"
            value={m.driven_by_owner ? 'Vous' : m.with_driver ? 'Un chauffeur Zoko' : 'Le client (location sans chauffeur)'}
          />
          <Row icon="happy-outline" label="Client" value={m.client_name} />
        </View>

        {phone && m.driven_by_owner && (
          <View style={styles.row}>
            <View style={styles.flex1}>
              <ZokoButton title="Appeler le client" variant="outline" onPress={() => Linking.openURL(`tel:+${phone}`)} />
            </View>
            <View style={styles.flex1}>
              <ZokoButton title="WhatsApp" variant="outline" onPress={() => Linking.openURL(`https://wa.me/${phone}`)} />
            </View>
          </View>
        )}

        <View style={styles.card}>
          <View style={styles.between}>
            <Text style={styles.muted}>Prix de la mission</Text>
            <Text style={styles.label}>{formatPrice(m.total_price, settings.currency_label)}</Text>
          </View>
          <View style={styles.between}>
            <Text style={styles.muted}>Votre part ({m.partner_share_pct ?? 0} %)</Text>
            <Text style={styles.amount}>{formatPrice(m.partner_amount, settings.currency_label)}</Text>
          </View>
          <Text style={styles.muted}>Estimation : le montant final tient compte des frais éventuels et est réglé par Zoko.</Text>
        </View>

        {m.status === 'confirmed' && !declining && (
          <Pressable onPress={() => setDeclining(true)} style={styles.declineLink} hitSlop={8}>
            <Text style={styles.declineText}>Je ne peux pas assurer cette mission</Text>
          </Pressable>
        )}
        {m.status === 'confirmed' && declining && (
          <View style={[styles.card, styles.declineBox]}>
            <Text style={styles.cardTitle}>Refuser la mission ?</Text>
            <Text style={styles.muted}>Zoko l’attribue à un autre véhicule. Pensez aussi à mettre à jour vos disponibilités.</Text>
            <ZokoInput label="Raison" icon="chatbox-outline" placeholder="Panne, imprévu…" value={reason} onChangeText={setReason} />
            {err ? <Text style={styles.error}>{err}</Text> : null}
            <View style={styles.row}>
              <View style={styles.flex1}>
                <ZokoButton title="Garder" variant="outline" onPress={() => setDeclining(false)} />
              </View>
              <View style={styles.flex1}>
                <Pressable onPress={decline} disabled={saving} style={[styles.dangerButton, saving && { opacity: 0.6 }]}>
                  <Text style={styles.dangerButtonText}>{saving ? 'Envoi…' : 'Refuser'}</Text>
                </Pressable>
              </View>
            </View>
          </View>
        )}
      </ScrollView>
    );
  } else {
    body = error ? <LoadError message={error} onRetry={load} /> : <Loading />;
  }

  return (
    <SafeAreaView style={styles.flex} edges={['top', 'bottom']}>
      <View style={styles.inner}>
        <ScreenHeader title="Mission" fallback="/partner" />
      </View>
      {body}
    </SafeAreaView>
  );
}

function Row({ icon, label, value }: { icon: IconName; label: string; value: string }) {
  return (
    <View style={styles.infoRow}>
      <Ionicons name={icon} size={18} color={Colors.primary} />
      <View style={styles.flex1}>
        <Text style={styles.small}>{label}</Text>
        <Text style={styles.label}>{value}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: Colors.background },
  flex1: { flex: 1 },
  row: { flexDirection: 'row', gap: Spacing.sm },
  between: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
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
  cardTitle: { fontFamily: Fonts.semibold, fontSize: 16, color: Colors.navy },
  label: { fontFamily: Fonts.medium, fontSize: 14, color: Colors.text },
  small: { fontFamily: Fonts.regular, fontSize: 12, color: Colors.textMuted },
  muted: { fontFamily: Fonts.regular, fontSize: 13, lineHeight: 19, color: Colors.textMuted },
  amount: { fontFamily: Fonts.bold, fontSize: 16, color: Colors.primary },
  error: { fontFamily: Fonts.medium, fontSize: 13, color: Colors.danger },
  infoRow: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.sm },
  declineLink: { alignSelf: 'center', paddingVertical: Spacing.xs },
  declineText: { fontFamily: Fonts.semibold, fontSize: 14, color: Colors.danger },
  declineBox: { borderColor: '#F6C9CB', backgroundColor: '#FFF7F7' },
  dangerButton: { height: 52, borderRadius: Radius.md, backgroundColor: Colors.danger, alignItems: 'center', justifyContent: 'center' },
  dangerButtonText: { fontFamily: Fonts.semibold, fontSize: 16, color: Colors.white },
});

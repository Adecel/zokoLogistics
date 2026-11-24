import Ionicons from '@expo/vector-icons/Ionicons';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useState, type ComponentProps } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LoadError, Loading } from '../../components/load-state';
import { VehicleImage } from '../../components/vehicle-image';
import { ZokoButton } from '../../components/zoko-button';
import { businessToday, formatBusinessDateTime, offsetMinutes } from '../../constants/dates';
import { formatPrice } from '../../constants/vehicles';
import { Colors, Fonts, Radius, Spacing } from '../../constants/zoko';
import { useCatalog } from '../../lib/catalog';
import { useSettings, type Settings } from '../../lib/settings';
import { supabase } from '../../lib/supabase';

type IconName = ComponentProps<typeof Ionicons>['name'];

type Status = 'pending' | 'confirmed' | 'in_progress' | 'completed' | 'cancelled' | 'rejected' | 'no_show';

type Reservation = {
  id: string;
  reference: string;
  status: Status;
  start_at: string;
  end_at: string;
  duration_hours: number;
  pickup_address: string;
  dropoff_address: string | null;
  contact_phone: string;
  model_id: string;
  model_name: string;
  promotion_code: string | null;
  discount_amount: number;
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
  with_driver: boolean;
  driver_name: string | null;
  driver_phone: string | null;
  client_license_number: string | null;
};

type Payment = {
  id: string;
  kind: 'payment' | 'refund';
  method: string;
  amount: number;
  status: 'pending' | 'succeeded' | 'failed' | 'cancelled';
  created_at: string;
  verified_at: string | null;
};

const RESERVATION_FIELDS =
  'id, reference, status, start_at, end_at, duration_hours, pickup_address, dropoff_address, contact_phone, model_id, model_name, ' +
  'promotion_code, discount_amount, amount_due, amount_paid, amount_refunded, balance, created_at, confirmed_at, cancelled_at, ' +
  'cancellation_reason, actual_start_at, actual_end_at, with_driver, driver_name, driver_phone, client_license_number';

export default function ReservationStatusScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { settings, error: settingsError, reload: reloadSettings } = useSettings();
  const [data, setData] = useState<{ reservation: Reservation; payments: Payment[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    const [res, pay] = await Promise.all([
      supabase.from('reservation_details').select(RESERVATION_FIELDS).eq('id', id).maybeSingle(),
      supabase
        .from('payments')
        .select('id, kind, method, amount, status, created_at, verified_at')
        .eq('reservation_id', id)
        .order('created_at', { ascending: true }),
    ]);
    if (res.error || pay.error) {
      setError('Impossible de charger la réservation. Vérifiez votre connexion.');
      return;
    }
    if (!res.data) {
      setError('Réservation introuvable.');
      return;
    }
    setError(null);
    setData({ reservation: res.data as unknown as Reservation, payments: (pay.data ?? []) as Payment[] });
  }, [id]);

  // Fresh status every time the screen is shown (e.g. after an agent confirmed it)
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

  if (!data || !settings) {
    const message = error ?? settingsError;
    return (
      <SafeAreaView style={[styles.flex, styles.center]}>
        {message ? (
          <LoadError
            message={message}
            onRetry={() => {
              reloadSettings();
              load();
            }}
          />
        ) : (
          <Loading />
        )}
      </SafeAreaView>
    );
  }

  return (
    <StatusView
      reservation={data.reservation}
      payments={data.payments}
      settings={settings}
      refreshing={refreshing}
      onRefresh={refresh}
      onChanged={load}
    />
  );
}

// ---------------------------------------------------------------------------

type HeadlineKind = 'success' | 'waiting' | 'info' | 'danger';

function headline(
  r: Reservation,
  paymentPending: boolean,
  cashPending: boolean,
): { icon: IconName; kind: HeadlineKind; title: string; text: string } {
  switch (r.status) {
    case 'confirmed':
      return {
        icon: 'checkmark',
        kind: 'success',
        title: 'Réservation confirmée !',
        text: r.with_driver
          ? 'Votre véhicule et votre chauffeur sont réservés. Nous vous contacterons avant le départ.'
          : 'Votre véhicule est réservé. Pensez à votre permis de conduire le jour de la prise en charge.',
      };
    case 'in_progress':
      return { icon: 'car-sport', kind: 'info', title: 'Location en cours', text: 'Bonne route avec Zoko !' };
    case 'completed':
      return { icon: 'flag', kind: 'success', title: 'Location terminée', text: 'Merci d’avoir voyagé avec Zoko.' };
    case 'cancelled':
      return {
        icon: 'close',
        kind: 'danger',
        title: 'Réservation annulée',
        text: r.cancellation_reason ?? 'Cette réservation a été annulée.',
      };
    case 'rejected':
      return {
        icon: 'close',
        kind: 'danger',
        title: 'Réservation refusée',
        text: r.cancellation_reason ?? 'Nous ne pouvons pas assurer cette réservation. Contactez-nous pour une autre date.',
      };
    case 'no_show':
      return {
        icon: 'alert',
        kind: 'danger',
        title: 'Client absent',
        text: r.with_driver
          ? 'Le chauffeur ne vous a pas trouvé au rendez-vous.'
          : 'Notre agent ne vous a pas trouvé au rendez-vous.',
      };
    default:
      if (cashPending) {
        return {
          icon: 'cash-outline',
          kind: 'waiting',
          title: 'Réservation enregistrée !',
          text: `Vous paierez en espèces ${r.with_driver ? 'au chauffeur' : 'à notre agent'} au moment de la prise en charge. Un agent va confirmer votre réservation ; vous recevrez une notification.`,
        };
      }
      if (paymentPending) {
        return {
          icon: 'hourglass-outline',
          kind: 'waiting',
          title: 'Réservation enregistrée !',
          text: 'Votre paiement est en cours de vérification. Un agent va confirmer votre réservation ; vous recevrez une notification.',
        };
      }
      if (r.balance > 0) {
        return {
          icon: 'wallet-outline',
          kind: 'waiting',
          title: 'En attente de paiement',
          text: 'Payez votre réservation pour qu’un agent puisse la confirmer.',
        };
      }
      return {
        icon: 'hourglass-outline',
        kind: 'waiting',
        title: 'Réservation enregistrée !',
        text: 'Un agent va vérifier et confirmer votre réservation ; vous recevrez une notification.',
      };
  }
}

const KIND_COLORS: Record<HeadlineKind, string> = {
  success: Colors.success,
  waiting: Colors.warning,
  info: Colors.primary,
  danger: Colors.danger,
};

// Whole days between today and the start date, in the company's time zone
function daysUntilStart(startAt: string, utcOffset: string) {
  const shifted = new Date(new Date(startAt).getTime() + offsetMinutes(utcOffset) * 60_000);
  const startDay = new Date(shifted.getUTCFullYear(), shifted.getUTCMonth(), shifted.getUTCDate());
  return Math.round((startDay.getTime() - businessToday(utcOffset).getTime()) / 86_400_000);
}

function StatusView({
  reservation: r,
  payments,
  settings,
  refreshing,
  onRefresh,
  onChanged,
}: {
  reservation: Reservation;
  payments: Payment[];
  settings: Settings;
  refreshing: boolean;
  onRefresh: () => void;
  onChanged: () => Promise<void>;
}) {
  const { vehicles } = useCatalog();
  const photo = vehicles?.find((v) => v.id === r.model_id)?.photos[0];
  const currency = settings.currency_label;
  const fmt = (iso: string) => formatBusinessDateTime(iso, settings.utc_offset);
  const methodLabel = (m: string) => settings.payment_methods.find((p) => p.method === m)?.label ?? m;

  const paymentPending = payments.some((p) => p.kind === 'payment' && p.status === 'pending');
  const verifiedPayment = payments.find((p) => p.kind === 'payment' && p.status === 'succeeded');
  const cashPending = payments.some((p) => p.kind === 'payment' && p.status === 'pending' && p.method === 'cash');
  const head = headline(r, paymentPending, cashPending);
  const color = KIND_COLORS[head.kind];
  const stopped = ['cancelled', 'rejected', 'no_show'].includes(r.status);

  const canPay = !stopped && r.status !== 'completed' && r.balance > 0 && !paymentPending;
  const canCancel = ['pending', 'confirmed'].includes(r.status) && new Date(r.start_at) > new Date();

  // Progress steps
  const steps: { label: string; done: boolean; at?: string | null }[] = [
    { label: 'Demande envoyée', done: true, at: r.created_at },
    {
      label: cashPending ? 'Paiement en espèces au départ' : paymentPending ? 'Paiement en vérification' : 'Paiement vérifié',
      done: !!verifiedPayment,
      at: verifiedPayment?.verified_at,
    },
    { label: 'Confirmée par un agent', done: !!r.confirmed_at, at: r.confirmed_at },
    { label: 'Location en cours', done: !!r.actual_start_at, at: r.actual_start_at },
    { label: 'Terminée', done: r.status === 'completed', at: r.actual_end_at },
  ];

  // Cancellation
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [cancelError, setCancelError] = useState<string | null>(null);
  const daysLeft = daysUntilStart(r.start_at, settings.utc_offset);
  const fullRefund = daysLeft >= settings.free_cancel_until_days_before;
  const refundText =
    r.amount_paid > 0
      ? fullRefund
        ? 'Vous serez remboursé intégralement.'
        : `Annulation tardive : ${settings.same_day_cancel_refund_pct} % du montant payé vous sera remboursé.`
      : 'Aucun paiement n’a été vérifié pour cette réservation.';

  async function cancel() {
    setCancelling(true);
    setCancelError(null);
    const { error } = await supabase
      .from('reservations')
      .update({ status: 'cancelled', cancellation_reason: 'Annulée par le client' })
      .eq('id', r.id);
    setCancelling(false);
    if (error) {
      setCancelError(error.code === 'P0001' ? error.message : 'Annulation impossible. Vérifiez votre connexion.');
      return;
    }
    setConfirmCancel(false);
    await onChanged();
  }

  return (
    <SafeAreaView style={styles.flex} edges={['top', 'bottom']}>
      <View style={[styles.inner, styles.header]}>
        <Pressable
          onPress={() => (router.canGoBack() ? router.back() : router.replace('/home'))}
          style={styles.back}
          hitSlop={10}
          accessibilityLabel="Retour"
        >
          <Ionicons name="chevron-back" size={22} color={Colors.text} />
        </Pressable>
        <Text style={styles.title}>Ma réservation</Text>
      </View>

      <ScrollView
        contentContainerStyle={[styles.inner, styles.content]}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={Colors.primary} />}
      >
        {/* Headline */}
        <View style={styles.hero}>
          <View style={[styles.heroIcon, { backgroundColor: color }]}>
            <Ionicons name={head.icon} size={40} color={Colors.white} />
          </View>
          <Text style={styles.heroTitle}>{head.title}</Text>
          <Text style={styles.heroText}>{head.text}</Text>
          <View style={[styles.refPill, { borderColor: color }]}>
            <Text style={[styles.refText, { color }]}>{r.reference}</Text>
          </View>
        </View>

        {canPay && (
          <ZokoButton title="Payer maintenant" onPress={() => router.push({ pathname: '/payment/[id]', params: { id: r.id } })} />
        )}

        {/* Booking */}
        <View style={[styles.card, styles.vehicleRow]}>
          <VehicleImage uri={photo} size={36} style={styles.vehicleImage} />
          <View style={styles.flex1}>
            <Text style={styles.vehicleName}>{r.model_name}</Text>
            <Text style={styles.muted}>
              {r.with_driver ? 'Avec chauffeur' : 'Sans chauffeur'} · {r.duration_hours} h
            </Text>
          </View>
        </View>

        <View style={styles.card}>
          <Row icon="calendar-outline" label="Début" value={fmt(r.start_at)} />
          <Row icon="time-outline" label="Fin prévue" value={fmt(r.end_at)} />
          <Row icon="location-outline" label="Prise en charge" value={r.pickup_address} />
          {r.dropoff_address ? <Row icon="flag-outline" label="Restitution" value={r.dropoff_address} /> : null}
          <Row icon="call-outline" label="Contact" value={r.contact_phone} />
          {r.with_driver ? (
            <Row
              icon="person-outline"
              label="Chauffeur"
              value={
                r.driver_name
                  ? r.driver_name + (r.driver_phone ? ` · ${r.driver_phone}` : '')
                  : 'Attribué par Zoko à la confirmation'
              }
            />
          ) : (
            <Row
              icon="card-outline"
              label="Sans chauffeur · votre permis"
              value={r.client_license_number ?? '—'}
            />
          )}
        </View>

        {/* Progress */}
        {!stopped && (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Suivi</Text>
            {steps.map((s, i) => (
              <View key={s.label} style={styles.step}>
                <View style={styles.stepRail}>
                  <View style={[styles.stepDot, s.done && styles.stepDotDone]}>
                    {s.done && <Ionicons name="checkmark" size={12} color={Colors.white} />}
                  </View>
                  {i < steps.length - 1 && <View style={[styles.stepLine, s.done && styles.stepLineDone]} />}
                </View>
                <View style={styles.stepBody}>
                  <Text style={[styles.stepLabel, !s.done && styles.muted]}>{s.label}</Text>
                  {s.done && s.at ? <Text style={styles.stepAt}>{fmt(s.at)}</Text> : null}
                </View>
              </View>
            ))}
          </View>
        )}

        {/* Money */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Paiement</Text>
          {r.discount_amount > 0 && (
            <MoneyRow label={`Réduction${r.promotion_code ? ` (${r.promotion_code})` : ''}`} value={`- ${formatPrice(r.discount_amount, currency)}`} />
          )}
          <MoneyRow label="Montant total" value={formatPrice(r.amount_due, currency)} />
          <MoneyRow label="Payé (vérifié)" value={formatPrice(r.amount_paid, currency)} />
          {r.amount_refunded > 0 && <MoneyRow label="Remboursé" value={formatPrice(r.amount_refunded, currency)} />}
          <View style={styles.divider} />
          <MoneyRow label="Reste à payer" value={formatPrice(Math.max(0, r.balance), currency)} bold />
          {payments.map((p) => (
            <View key={p.id} style={styles.paymentRow}>
              <Ionicons
                name={p.status === 'succeeded' ? 'checkmark-circle' : p.status === 'pending' ? 'time' : 'close-circle'}
                size={16}
                color={p.status === 'succeeded' ? Colors.success : p.status === 'pending' ? Colors.warning : Colors.danger}
              />
              <Text style={styles.paymentText}>
                {p.kind === 'refund' ? 'Remboursement' : methodLabel(p.method)} · {formatPrice(p.amount, currency)} ·{' '}
                {p.status === 'succeeded'
                  ? 'vérifié'
                  : p.status === 'pending'
                    ? p.method === 'cash'
                      ? 'à régler au départ'
                      : 'en vérification'
                    : 'refusé'}
              </Text>
            </View>
          ))}
        </View>

        {/* Modify / cancel (until the rental starts) */}
        {canCancel && !confirmCancel && (
          <>
            <ZokoButton
              title="Modifier la réservation"
              variant="outline"
              onPress={() => router.push({ pathname: '/booking/[id]', params: { id: r.model_id, edit: r.id } })}
            />
            <Pressable onPress={() => setConfirmCancel(true)} style={styles.cancelLink} hitSlop={8}>
              <Text style={styles.cancelLinkText}>Annuler la réservation</Text>
            </Pressable>
          </>
        )}
        {canCancel && confirmCancel && (
          <View style={[styles.card, styles.cancelBox]}>
            <Text style={styles.cardTitle}>Annuler cette réservation ?</Text>
            <Text style={styles.muted}>{refundText}</Text>
            {cancelError ? <Text style={styles.error}>{cancelError}</Text> : null}
            <View style={styles.cancelActions}>
              <View style={styles.flex1}>
                <ZokoButton title="Garder" variant="outline" onPress={() => setConfirmCancel(false)} />
              </View>
              <View style={styles.flex1}>
                <Pressable onPress={cancel} disabled={cancelling} style={[styles.dangerButton, cancelling && { opacity: 0.6 }]}>
                  <Text style={styles.dangerButtonText}>{cancelling ? 'Annulation…' : 'Oui, annuler'}</Text>
                </Pressable>
              </View>
            </View>
          </View>
        )}

        <View style={styles.actions}>
          <ZokoButton title="Voir mes réservations" variant="outline" onPress={() => router.navigate('/reservations')} />
          <Pressable onPress={() => router.navigate('/home')} style={styles.homeLink} hitSlop={8}>
            <Text style={styles.homeLinkText}>Retour à l’accueil</Text>
          </Pressable>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function Row({ icon, label, value }: { icon: IconName; label: string; value: string }) {
  return (
    <View style={styles.row}>
      <Ionicons name={icon} size={18} color={Colors.primary} />
      <View style={styles.flex1}>
        <Text style={styles.rowLabel}>{label}</Text>
        <Text style={styles.rowValue}>{value}</Text>
      </View>
    </View>
  );
}

function MoneyRow({ label, value, bold }: { label: string; value: string; bold?: boolean }) {
  return (
    <View style={styles.moneyRow}>
      <Text style={[styles.moneyLabel, bold && styles.moneyBold]}>{label}</Text>
      <Text style={[styles.moneyValue, bold && styles.moneyValueBold]}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: Colors.background },
  flex1: { flex: 1 },
  center: { justifyContent: 'center' },
  muted: { fontFamily: Fonts.regular, fontSize: 13, lineHeight: 19, color: Colors.textMuted },
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
  content: { gap: Spacing.md, paddingBottom: Spacing.xl },

  hero: { alignItems: 'center', gap: Spacing.sm, paddingVertical: Spacing.sm },
  heroIcon: { width: 84, height: 84, borderRadius: Radius.pill, alignItems: 'center', justifyContent: 'center' },
  heroTitle: { fontFamily: Fonts.bold, fontSize: 22, color: Colors.navy, textAlign: 'center', marginTop: Spacing.xs },
  heroText: { fontFamily: Fonts.regular, fontSize: 14, lineHeight: 21, color: Colors.textMuted, textAlign: 'center' },
  refPill: { borderWidth: 1.5, borderRadius: Radius.pill, paddingHorizontal: Spacing.md, paddingVertical: 4, marginTop: 2 },
  refText: { fontFamily: Fonts.semibold, fontSize: 13 },

  card: {
    padding: Spacing.md,
    gap: Spacing.sm + 2,
    borderRadius: Radius.lg,
    backgroundColor: Colors.white,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  cardTitle: { fontFamily: Fonts.semibold, fontSize: 15, color: Colors.navy },
  vehicleRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md },
  vehicleImage: { width: 88, height: 64 },
  vehicleName: { fontFamily: Fonts.semibold, fontSize: 16, color: Colors.text },

  row: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.sm },
  rowLabel: { fontFamily: Fonts.regular, fontSize: 12, color: Colors.textMuted },
  rowValue: { fontFamily: Fonts.medium, fontSize: 14, color: Colors.text },

  step: { flexDirection: 'row', gap: Spacing.sm },
  stepRail: { alignItems: 'center', width: 20 },
  stepDot: {
    width: 20,
    height: 20,
    borderRadius: Radius.pill,
    borderWidth: 2,
    borderColor: Colors.border,
    backgroundColor: Colors.white,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepDotDone: { backgroundColor: Colors.success, borderColor: Colors.success },
  stepLine: { width: 2, flex: 1, minHeight: 16, backgroundColor: Colors.border },
  stepLineDone: { backgroundColor: Colors.success },
  stepBody: { flex: 1, paddingBottom: Spacing.sm },
  stepLabel: { fontFamily: Fonts.medium, fontSize: 14, color: Colors.text },
  stepAt: { fontFamily: Fonts.regular, fontSize: 12, color: Colors.textMuted },

  moneyRow: { flexDirection: 'row', justifyContent: 'space-between', gap: Spacing.md },
  moneyLabel: { fontFamily: Fonts.regular, fontSize: 14, color: Colors.textMuted },
  moneyBold: { fontFamily: Fonts.semibold, color: Colors.text },
  moneyValue: { fontFamily: Fonts.medium, fontSize: 14, color: Colors.text },
  moneyValueBold: { fontFamily: Fonts.bold, fontSize: 16, color: Colors.primary },
  divider: { height: 1, backgroundColor: Colors.border },
  paymentRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  paymentText: { flex: 1, fontFamily: Fonts.regular, fontSize: 13, color: Colors.textMuted },

  cancelLink: { alignSelf: 'center', paddingVertical: Spacing.xs },
  cancelLinkText: { fontFamily: Fonts.semibold, fontSize: 14, color: Colors.danger },
  cancelBox: { borderColor: '#F6C9CB', backgroundColor: '#FFF7F7' },
  cancelActions: { flexDirection: 'row', gap: Spacing.sm, marginTop: Spacing.xs },
  dangerButton: {
    height: 52,
    borderRadius: Radius.md,
    backgroundColor: Colors.danger,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dangerButtonText: { fontFamily: Fonts.semibold, fontSize: 16, color: Colors.white },
  error: { fontFamily: Fonts.medium, fontSize: 13, color: Colors.danger },

  actions: { gap: Spacing.sm, marginTop: Spacing.sm },
  homeLink: { alignSelf: 'center', paddingVertical: Spacing.sm },
  homeLinkText: { fontFamily: Fonts.semibold, fontSize: 14, color: Colors.textMuted },
});

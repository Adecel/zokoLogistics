import Ionicons from '@expo/vector-icons/Ionicons';
import { Image } from 'expo-image';
import { Redirect, router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState, type ComponentProps, type ReactNode } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LoadError, Loading } from '../../components/load-state';
import { VehicleImage } from '../../components/vehicle-image';
import { ZokoButton } from '../../components/zoko-button';
import { ZokoInput } from '../../components/zoko-input';
import { formatBusinessDateTime } from '../../constants/dates';
import { formatPrice } from '../../constants/vehicles';
import { Colors, Fonts, Radius, Spacing } from '../../constants/zoko';
import { useAuth } from '../../lib/auth';
import { useCatalog } from '../../lib/catalog';
import { pickProof, uploadProof, type PickedImage } from '../../lib/proof-upload';
import { useSettings, type PaymentMethodKey, type PaymentMethodSetting, type Settings } from '../../lib/settings';
import { supabase } from '../../lib/supabase';

type IconName = ComponentProps<typeof Ionicons>['name'];

// Reservation as seen in the reservation_details view (balance included)
type Reservation = {
  id: string;
  reference: string;
  status: string;
  start_at: string;
  duration_hours: number;
  pickup_address: string;
  model_id: string;
  model_name: string;
  amount_due: number;
  amount_paid: number;
  balance: number;
};

type Payment = { id: string; method: PaymentMethodKey; status: string };

// Visual style per method (label, numbers and instructions come from the database)
const METHOD_STYLE: Record<PaymentMethodKey, { icon: IconName; color: string; bg: string }> = {
  cash: { icon: 'cash-outline', color: Colors.success, bg: Colors.successBg },
  airtel_money: { icon: 'phone-portrait-outline', color: '#E40000', bg: '#FDECEC' },
  mtn_mobile_money: { icon: 'phone-portrait-outline', color: '#B58900', bg: '#FFF6D1' },
  bank_transfer: { icon: 'business-outline', color: Colors.navy, bg: '#E6EBF2' },
};

// Cash needs nothing; the others need a number / account to pay to
const isReady = (m: PaymentMethodSetting) => m.enabled && (m.method === 'cash' || m.account_number.trim() !== '');

type Loaded = { reservation: Reservation; payments: Payment[] };

export default function PaymentScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { settings, error: settingsError, reload: reloadSettings } = useSettings();
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let active = true;
    Promise.all([
      supabase
        .from('reservation_details')
        .select('id, reference, status, start_at, duration_hours, pickup_address, model_id, model_name, amount_due, amount_paid, balance')
        .eq('id', id)
        .maybeSingle(),
      supabase.from('payments').select('id, method, status').eq('reservation_id', id),
    ]).then(([res, pay]) => {
      if (!active) return;
      if (res.error || pay.error) return setLoadError('Impossible de charger la réservation. Vérifiez votre connexion.');
      if (!res.data) return setLoadError('Réservation introuvable.');
      setLoaded({ reservation: res.data as Reservation, payments: (pay.data ?? []) as Payment[] });
    });
    return () => {
      active = false;
    };
  }, [id, attempt]);

  const retry = () => {
    setLoadError(null);
    setLoaded(null);
    reloadSettings();
    setAttempt((a) => a + 1);
  };

  if (!loaded || !settings) {
    const error = loadError ?? settingsError;
    return <Screen>{error ? <LoadError message={error} onRetry={retry} /> : <Loading />}</Screen>;
  }

  return <PaymentForm reservation={loaded.reservation} payments={loaded.payments} settings={settings} />;
}

function PaymentForm({ reservation, payments, settings }: { reservation: Reservation; payments: Payment[]; settings: Settings }) {
  const { session } = useAuth();
  const { vehicles } = useCatalog();
  const photo = vehicles?.find((v) => v.id === reservation.model_id)?.photos[0];
  const currency = settings.currency_label;
  const methods = settings.payment_methods.filter((m) => m.enabled);

  const [selected, setSelected] = useState<PaymentMethodKey | null>(null);
  const [txRef, setTxRef] = useState('');
  const [proof, setProof] = useState<PickedImage | null>(null);
  const [proofNote, setProofNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const method = methods.find((m) => m.method === selected);
  const amount = reservation.balance;
  const when = formatBusinessDateTime(reservation.start_at, settings.utc_offset);
  const statusHref = { pathname: '/reservation/[id]' as const, params: { id: reservation.id } };

  // Already paid, or a payment is waiting for verification: show the status instead
  if (amount <= 0 || payments.some((p) => p.status === 'pending')) {
    return <Redirect href={statusHref} />;
  }

  function choose(key: PaymentMethodKey) {
    setSelected(key);
    setError(null);
  }

  async function addProof(source: 'library' | 'camera') {
    setProofNote(null);
    const picked = await pickProof(source);
    if (picked === 'denied') {
      setProofNote('Autorisez l’accès à l’appareil photo dans les réglages du téléphone, ou choisissez une photo.');
      return;
    }
    if (picked) setProof(picked);
  }

  async function handleConfirm() {
    if (!method || !session) return;
    setSubmitting(true);
    setError(null);

    // 1. Optional proof photo
    let proofPath: string | null = null;
    if (proof && method.method !== 'cash') {
      try {
        proofPath = await uploadProof(session.user.id, reservation.id, proof);
      } catch {
        setSubmitting(false);
        setError('La photo n’a pas pu être envoyée. Réessayez, ou retirez la photo pour continuer sans.');
        return;
      }
    }

    // 2. Payment declaration (verified later by the team)
    const { error: err } = await supabase.from('payments').insert({
      reservation_id: reservation.id,
      method: method.method,
      amount,
      transaction_reference: method.method === 'cash' ? null : txRef.trim() || null,
      proof_path: proofPath,
    });
    setSubmitting(false);

    if (err) {
      setError(
        err.code === '23505'
          ? 'Cette référence de transaction a déjà été déclarée.'
          : err.code === 'P0001'
            ? err.message
            : err.code === '22P02'
              ? 'Ce moyen de paiement n’est pas encore activé sur le serveur.'
              : 'Envoi impossible. Vérifiez votre connexion et réessayez.',
      );
      return;
    }
    router.replace(statusHref);
  }

  const isCash = method?.method === 'cash';

  return (
    <Screen
      footer={
        <View style={styles.footer}>
          <ZokoButton
            title={!method ? 'Choisissez un moyen de paiement' : isCash ? 'Confirmer : je paierai en espèces' : 'J’ai payé, confirmer'}
            onPress={handleConfirm}
            loading={submitting}
            disabled={!method}
          />
          {settings.payment_note ? <Text style={styles.note}>{settings.payment_note}</Text> : null}
        </View>
      }
    >
      {/* Summary */}
      <Text style={styles.sectionTitle}>Résumé de la réservation</Text>
      <View style={[styles.card, styles.summary]}>
        <VehicleImage uri={photo} size={36} style={styles.summaryImage} />
        <View style={styles.flex1}>
          <Text style={styles.vehicleName}>{reservation.model_name}</Text>
          <Text style={styles.muted}>
            {when} · {reservation.duration_hours} h
          </Text>
          <Text style={styles.muted} numberOfLines={1}>
            {reservation.pickup_address}
          </Text>
          <Text style={styles.reference}>{reservation.reference}</Text>
        </View>
      </View>

      <View style={[styles.card, styles.amountRow]}>
        <Text style={styles.amountLabel}>Montant</Text>
        <Text style={styles.amount}>{formatPrice(amount, currency)}</Text>
      </View>

      {/* Methods: details open under the chosen one */}
      <Text style={styles.sectionTitle}>Moyen de paiement</Text>
      {methods.length === 0 && <LoadError message="Aucun moyen de paiement n'est configuré pour le moment." />}
      <View style={styles.methods}>
        {methods.map((m) => {
          const look = METHOD_STYLE[m.method] ?? METHOD_STYLE.cash;
          const ready = isReady(m);
          const active = m.method === selected;
          return (
            <View key={m.method} style={[styles.method, active && styles.methodActive, !ready && styles.methodDisabled]}>
              <Pressable
                disabled={!ready}
                onPress={() => choose(m.method)}
                style={styles.methodHead}
                accessibilityRole="radio"
                accessibilityState={{ selected: active, disabled: !ready }}
              >
                <View style={[styles.methodIcon, { backgroundColor: look.bg }]}>
                  <Ionicons name={look.icon} size={20} color={look.color} />
                </View>
                <View style={styles.flex1}>
                  <Text style={styles.methodLabel}>{m.label}</Text>
                  {!ready && <Text style={styles.muted}>Bientôt disponible</Text>}
                </View>
                <Ionicons
                  name={active ? 'radio-button-on' : 'radio-button-off'}
                  size={22}
                  color={active ? Colors.primary : Colors.border}
                />
              </Pressable>

              {active && (
                <View style={styles.details}>
                  {m.method === 'cash' ? (
                    <>
                      <Line label="À payer à la prise en charge" value={formatPrice(amount, currency)} bold />
                      {m.instructions ? <Text style={styles.instructions}>{m.instructions}</Text> : null}
                    </>
                  ) : (
                    <>
                      <Line label="Montant exact" value={formatPrice(amount, currency)} bold />
                      {m.bank_name ? <Line label="Banque" value={m.bank_name} /> : null}
                      <Line
                        label={m.method === 'bank_transfer' ? 'N° de compte' : 'Numéro'}
                        value={m.account_number}
                        selectable
                        big
                      />
                      {m.account_name ? (
                        <Line
                          label={m.method === 'bank_transfer' ? 'Titulaire' : 'Nom affiché à la confirmation'}
                          value={m.account_name}
                        />
                      ) : null}
                      <Line
                        label={m.method === 'bank_transfer' ? 'Motif du virement' : 'Référence'}
                        value={reservation.reference}
                        selectable
                      />
                      {m.instructions ? <Text style={styles.instructions}>{m.instructions}</Text> : null}
                    </>
                  )}
                </View>
              )}
            </View>
          );
        })}
      </View>

      {/* Optional proof + reference (not for cash) */}
      {method && !isCash && (
        <>
          <Text style={styles.sectionTitle}>Preuve de paiement (facultatif)</Text>
          {proof ? (
            <View style={[styles.card, styles.proofRow]}>
              <Image source={{ uri: proof.uri }} style={styles.proofImage} contentFit="cover" />
              <View style={styles.flex1}>
                <Text style={styles.proofOk}>Photo ajoutée</Text>
                <Text style={styles.muted}>Elle sera envoyée avec votre paiement.</Text>
              </View>
              <Pressable onPress={() => setProof(null)} hitSlop={10} accessibilityLabel="Retirer la photo">
                <Ionicons name="trash-outline" size={20} color={Colors.danger} />
              </Pressable>
            </View>
          ) : (
            <View style={styles.proofButtons}>
              <ProofButton icon="images-outline" label="Galerie" onPress={() => addProof('library')} />
              <ProofButton icon="camera-outline" label="Appareil photo" onPress={() => addProof('camera')} />
            </View>
          )}
          {proofNote ? <Text style={styles.muted}>{proofNote}</Text> : null}

          <ZokoInput
            label="Référence de la transaction (facultatif)"
            icon="receipt-outline"
            placeholder={method.method === 'bank_transfer' ? 'Ex. VIR-0012345' : 'Ex. ID reçu par SMS'}
            autoCapitalize="characters"
            autoCorrect={false}
            value={txRef}
            onChangeText={setTxRef}
          />
        </>
      )}

      {error ? <Text style={styles.formError}>{error}</Text> : null}

      <Pressable onPress={() => router.replace(statusHref)} style={styles.later} hitSlop={8}>
        <Text style={styles.laterText}>Payer plus tard</Text>
      </Pressable>
    </Screen>
  );
}

function ProofButton({ icon, label, onPress }: { icon: IconName; label: string; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.proofButton, pressed && { opacity: 0.8 }]}>
      <Ionicons name={icon} size={22} color={Colors.primary} />
      <Text style={styles.proofButtonText}>{label}</Text>
    </Pressable>
  );
}

function Screen({ children, footer }: { children: ReactNode; footer?: ReactNode }) {
  return (
    <SafeAreaView style={styles.flex} edges={['top']}>
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={[styles.inner, styles.header]}>
          <Pressable
            onPress={() => (router.canGoBack() ? router.back() : router.replace('/home'))}
            style={styles.back}
            hitSlop={10}
            accessibilityLabel="Retour"
          >
            <Ionicons name="chevron-back" size={22} color={Colors.text} />
          </Pressable>
          <Text style={styles.title}>Paiement</Text>
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

function Line({ label, value, bold, big, selectable }: { label: string; value: string; bold?: boolean; big?: boolean; selectable?: boolean }) {
  return (
    <View style={styles.line}>
      <Text style={styles.lineLabel}>{label}</Text>
      <Text selectable={selectable} style={[styles.lineValue, bold && styles.lineValueBold, big && styles.lineValueBig]}>
        {value}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: Colors.background },
  flex1: { flex: 1 },
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
  sectionTitle: { fontFamily: Fonts.bold, fontSize: 16, color: Colors.navy, marginTop: Spacing.xs },

  card: {
    padding: Spacing.md,
    gap: Spacing.sm,
    borderRadius: Radius.lg,
    backgroundColor: Colors.white,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  summary: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md },
  summaryImage: { width: 88, height: 72 },
  vehicleName: { fontFamily: Fonts.semibold, fontSize: 16, color: Colors.text },
  reference: { fontFamily: Fonts.medium, fontSize: 12, color: Colors.primary, marginTop: 2 },

  amountRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  amountLabel: { fontFamily: Fonts.medium, fontSize: 14, color: Colors.text },
  amount: { fontFamily: Fonts.bold, fontSize: 20, color: Colors.primary },

  methods: { gap: Spacing.sm },
  method: { borderRadius: Radius.lg, backgroundColor: Colors.white, borderWidth: 1.5, borderColor: Colors.border, overflow: 'hidden' },
  methodActive: { borderColor: Colors.primary },
  methodDisabled: { opacity: 0.55 },
  methodHead: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, padding: Spacing.md },
  methodIcon: { width: 40, height: 40, borderRadius: Radius.md, alignItems: 'center', justifyContent: 'center' },
  methodLabel: { fontFamily: Fonts.semibold, fontSize: 15, color: Colors.text },
  details: {
    gap: Spacing.sm,
    padding: Spacing.md,
    backgroundColor: '#F2F9FE',
    borderTopWidth: 1,
    borderTopColor: '#CDE6F8',
  },
  instructions: { fontFamily: Fonts.regular, fontSize: 13, lineHeight: 19, color: Colors.textMuted, marginTop: 2 },

  line: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', gap: Spacing.md },
  lineLabel: { fontFamily: Fonts.regular, fontSize: 13, color: Colors.textMuted, flexShrink: 1 },
  lineValue: { fontFamily: Fonts.semibold, fontSize: 14, color: Colors.text, textAlign: 'right', flexShrink: 1 },
  lineValueBold: { fontFamily: Fonts.bold, fontSize: 16, color: Colors.primary },
  lineValueBig: { fontFamily: Fonts.bold, fontSize: 18, color: Colors.navy, letterSpacing: 0.5 },

  proofButtons: { flexDirection: 'row', gap: Spacing.sm },
  proofButton: {
    flex: 1,
    alignItems: 'center',
    gap: 4,
    paddingVertical: Spacing.md,
    borderRadius: Radius.lg,
    borderWidth: 1.5,
    borderStyle: 'dashed',
    borderColor: Colors.primary,
    backgroundColor: Colors.white,
  },
  proofButtonText: { fontFamily: Fonts.medium, fontSize: 13, color: Colors.primary },
  proofRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md },
  proofImage: { width: 64, height: 64, borderRadius: Radius.md, backgroundColor: Colors.background },
  proofOk: { fontFamily: Fonts.semibold, fontSize: 14, color: Colors.success },

  formError: {
    fontFamily: Fonts.medium,
    fontSize: 13,
    color: Colors.danger,
    backgroundColor: '#FDECEC',
    padding: Spacing.md,
    borderRadius: Radius.md,
    textAlign: 'center',
  },
  later: { alignSelf: 'center', paddingVertical: Spacing.sm },
  laterText: { fontFamily: Fonts.semibold, fontSize: 14, color: Colors.textMuted },

  footerBar: { backgroundColor: Colors.white, borderTopWidth: 1, borderTopColor: Colors.border },
  footer: { gap: Spacing.xs, paddingVertical: Spacing.sm + 4 },
  note: { fontFamily: Fonts.regular, fontSize: 12, color: Colors.textMuted, textAlign: 'center' },
});

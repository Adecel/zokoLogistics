import Ionicons from '@expo/vector-icons/Ionicons';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { accountStyles as s } from '../../components/account-styles';
import { LoadError, Loading } from '../../components/load-state';
import { ScreenHeader } from '../../components/screen-header';
import { Colors, Fonts, Radius, Spacing } from '../../constants/zoko';
import { useSettings } from '../../lib/settings';

const ICONS = {
  cash: { color: Colors.success, bg: Colors.successBg, icon: 'cash-outline' },
  airtel_money: { color: '#E40000', bg: '#FDECEC', icon: 'phone-portrait-outline' },
  mtn_mobile_money: { color: '#B58900', bg: '#FFF6D1', icon: 'phone-portrait-outline' },
  bank_transfer: { color: Colors.navy, bg: '#E6EBF2', icon: 'business-outline' },
} as const;

// Payment methods accepted by Zoko and their details (app_settings.payment_methods)
export default function PaymentMethodsScreen() {
  const { settings, error, reload } = useSettings();
  const methods = settings?.payment_methods.filter((m) => m.enabled) ?? [];

  return (
    <SafeAreaView style={s.flex} edges={['top', 'bottom']}>
      <View style={s.inner}>
        <ScreenHeader title="Moyens de paiement" />
      </View>
      {!settings && (error ? <LoadError message={error} onRetry={reload} /> : <Loading />)}
      {settings && (
        <ScrollView contentContainerStyle={[s.inner, s.content]}>
          <Text style={s.muted}>
            Zoko accepte les moyens de paiement ci-dessous. Vous choisissez le vôtre depuis la page de chaque
            réservation ; vous pouvez joindre une photo de preuve, puis notre équipe vérifie le paiement.
          </Text>
          {methods.map((m) => {
            const look = ICONS[m.method] ?? ICONS.cash;
            const ready = m.method === 'cash' || m.account_number.trim() !== '';
            return (
              <View key={m.method} style={s.card}>
                <View style={styles.head}>
                  <View style={[styles.icon, { backgroundColor: look.bg }]}>
                    <Ionicons name={look.icon} size={20} color={look.color} />
                  </View>
                  <Text style={styles.label}>{m.label}</Text>
                </View>
                {m.method === 'cash' ? (
                  <Text style={s.muted}>{m.instructions}</Text>
                ) : ready ? (
                  <>
                    {m.bank_name ? <Line label="Banque" value={m.bank_name} /> : null}
                    <Line label={m.method === 'bank_transfer' ? 'N° de compte' : 'Numéro'} value={m.account_number} />
                    {m.account_name ? <Line label="Titulaire" value={m.account_name} /> : null}
                  </>
                ) : (
                  <Text style={s.muted}>Bientôt disponible</Text>
                )}
              </View>
            );
          })}
          {methods.length === 0 && <Text style={s.muted}>Aucun moyen de paiement configuré pour le moment.</Text>}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

function Line({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.line}>
      <Text style={styles.lineLabel}>{label}</Text>
      <Text selectable style={styles.lineValue}>
        {value}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  head: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md },
  icon: { width: 40, height: 40, borderRadius: Radius.md, alignItems: 'center', justifyContent: 'center' },
  label: { fontFamily: Fonts.semibold, fontSize: 15, color: Colors.text },
  line: { flexDirection: 'row', justifyContent: 'space-between', gap: Spacing.md },
  lineLabel: { fontFamily: Fonts.regular, fontSize: 14, color: Colors.textMuted },
  lineValue: { flexShrink: 1, fontFamily: Fonts.semibold, fontSize: 14, color: Colors.text, textAlign: 'right' },
});

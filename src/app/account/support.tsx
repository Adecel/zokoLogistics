import Ionicons from '@expo/vector-icons/Ionicons';
import type { ComponentProps } from 'react';
import { Linking, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { accountStyles as s } from '../../components/account-styles';
import { LoadError, Loading } from '../../components/load-state';
import { ScreenHeader } from '../../components/screen-header';
import { Colors, Fonts, Radius, Spacing } from '../../constants/zoko';
import { phoneDigits } from '../../lib/phone';
import { useSettings } from '../../lib/settings';

type IconName = ComponentProps<typeof Ionicons>['name'];

// Contacts and rules all come from app_settings
export default function SupportScreen() {
  const { settings, error, reload } = useSettings();

  if (!settings) {
    return (
      <SafeAreaView style={s.flex} edges={['top', 'bottom']}>
        <View style={s.inner}>
          <ScreenHeader title="Aide et support" />
        </View>
        {error ? <LoadError message={error} onRetry={reload} /> : <Loading />}
      </SafeAreaView>
    );
  }

  const phone = phoneDigits(settings.support_phone);
  const whatsapp = phoneDigits(settings.support_whatsapp);

  const rules = [
    `Réservation au moins ${settings.min_days_ahead} jour(s) à l’avance, jusqu’à ${settings.max_days_ahead} jours.`,
    `Départs entre ${settings.booking_hours.start} et ${settings.booking_hours.end}.`,
    ...(settings.included_fuel_liters > 0
      ? [`${settings.included_fuel_liters} L de carburant inclus ; au-delà, le carburant est à votre charge.`]
      : []),
    `Annulation remboursée intégralement jusqu’à ${settings.free_cancel_until_days_before} jour(s) avant ; le jour même, ${settings.same_day_cancel_refund_pct} % remboursé.`,
    ...settings.booking_conditions,
  ];

  return (
    <SafeAreaView style={s.flex} edges={['top', 'bottom']}>
      <View style={s.inner}>
        <ScreenHeader title="Aide et support" />
      </View>
      <ScrollView contentContainerStyle={[s.inner, s.content]}>
        <Text style={s.cardTitle}>Nous contacter</Text>
        {whatsapp && (
          <Contact
            icon="logo-whatsapp"
            color="#25D366"
            label="WhatsApp"
            value={settings.support_whatsapp}
            onPress={() => Linking.openURL(`https://wa.me/${whatsapp}`)}
          />
        )}
        {phone && (
          <Contact
            icon="call"
            color={Colors.primary}
            label="Appeler"
            value={settings.support_phone}
            onPress={() => Linking.openURL(`tel:+${phone}`)}
          />
        )}
        {!phone && !whatsapp && <Text style={s.muted}>Les coordonnées du service client seront bientôt disponibles.</Text>}

        <Text style={[s.cardTitle, styles.spaced]}>Bon à savoir</Text>
        <View style={s.card}>
          {rules.map((r) => (
            <View key={r} style={styles.rule}>
              <Ionicons name="information-circle-outline" size={16} color={Colors.primary} />
              <Text style={styles.ruleText}>{r}</Text>
            </View>
          ))}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function Contact({ icon, color, label, value, onPress }: { icon: IconName; color: string; label: string; value: string; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [s.card, styles.contact, pressed && { opacity: 0.8 }]}>
      <View style={[styles.contactIcon, { backgroundColor: color }]}>
        <Ionicons name={icon} size={20} color={Colors.white} />
      </View>
      <View style={styles.flex1}>
        <Text style={styles.contactLabel}>{label}</Text>
        <Text style={s.muted}>{value}</Text>
      </View>
      <Ionicons name="open-outline" size={18} color={Colors.textMuted} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  flex1: { flex: 1 },
  spaced: { marginTop: Spacing.sm },
  contact: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md },
  contactIcon: { width: 40, height: 40, borderRadius: Radius.pill, alignItems: 'center', justifyContent: 'center' },
  contactLabel: { fontFamily: Fonts.semibold, fontSize: 15, color: Colors.text },
  rule: { flexDirection: 'row', gap: Spacing.sm, alignItems: 'flex-start' },
  ruleText: { flex: 1, fontFamily: Fonts.regular, fontSize: 13, lineHeight: 19, color: Colors.textMuted },
});

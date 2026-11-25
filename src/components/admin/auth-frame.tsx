import Ionicons from '@expo/vector-icons/Ionicons';
import type { ReactNode } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Colors, Fonts, Radius, Spacing } from '../../constants/zoko';
import { ZokoLogo } from '../zoko-logo';
import { useIsWide } from './ui';

const POINTS: { icon: keyof typeof Ionicons.glyphMap; text: string }[] = [
  { icon: 'calendar-outline', text: 'Réservations : confirmer, attribuer, suivre' },
  { icon: 'wallet-outline', text: 'Paiements reçus, à vérifier, remboursements' },
  { icon: 'car-sport-outline', text: 'Flotte, tarifs et chauffeurs' },
  { icon: 'people-outline', text: 'Clients et équipe' },
];

// Frame for the dashboard login / sign-up: brand panel on computer, simple header on phone
export function AdminAuthFrame({ title, subtitle, children }: { title: string; subtitle: string; children: ReactNode }) {
  const wide = useIsWide();
  return (
    <View style={[styles.flex, wide && styles.row]}>
      {wide && (
        <View style={styles.brand}>
          <View style={styles.logo}>
            <ZokoLogo size={56} color={Colors.white} />
          </View>
          <Text style={styles.brandTitle}>Tableau de bord</Text>
          <Text style={styles.brandText}>L’espace de l’équipe Zoko Logistics pour gérer l’activité au quotidien.</Text>
          <View style={styles.points}>
            {POINTS.map((p) => (
              <View key={p.text} style={styles.point}>
                <Ionicons name={p.icon} size={20} color="#8FD0F5" />
                <Text style={styles.pointText}>{p.text}</Text>
              </View>
            ))}
          </View>
        </View>
      )}
      <SafeAreaView style={styles.flex}>
        <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
            <View style={styles.form}>
              {!wide && (
                <View style={styles.mobileBrand}>
                  <ZokoLogo size={40} />
                  <Text style={styles.mobileTag}>Espace équipe</Text>
                </View>
              )}
              <View style={{ gap: 4 }}>
                <Text style={styles.title}>{title}</Text>
                <Text style={styles.subtitle}>{subtitle}</Text>
              </View>
              {children}
            </View>
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: Colors.background },
  row: { flexDirection: 'row' },
  brand: {
    width: '42%',
    maxWidth: 560,
    backgroundColor: Colors.navy,
    padding: 56,
    justifyContent: 'center',
    gap: Spacing.md,
  },
  logo: { alignSelf: 'flex-start' },
  brandTitle: { fontFamily: Fonts.bold, fontSize: 32, color: Colors.white, marginTop: Spacing.lg },
  brandText: { fontFamily: Fonts.regular, fontSize: 16, lineHeight: 24, color: '#C9D6E6' },
  points: { gap: Spacing.md, marginTop: Spacing.lg },
  point: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md },
  pointText: { fontFamily: Fonts.medium, fontSize: 15, color: Colors.white },
  scroll: { flexGrow: 1, justifyContent: 'center' },
  form: {
    width: '100%',
    maxWidth: 440,
    alignSelf: 'center',
    padding: Spacing.lg,
    gap: Spacing.lg,
  },
  mobileBrand: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  mobileTag: {
    fontFamily: Fonts.semibold,
    fontSize: 12,
    color: Colors.primary,
    backgroundColor: '#E3F2FC',
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderRadius: Radius.pill,
    overflow: 'hidden',
  },
  title: { fontFamily: Fonts.bold, fontSize: 26, color: Colors.navy },
  subtitle: { fontFamily: Fonts.regular, fontSize: 14, color: Colors.textMuted, lineHeight: 21 },
});

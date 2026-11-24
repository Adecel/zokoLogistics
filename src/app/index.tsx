import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { Redirect, router } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ZokoButton } from '../components/zoko-button';
import { ZokoLogo } from '../components/zoko-logo';
import { Colors, Fonts, Spacing } from '../constants/zoko';
import { isStaff } from '../lib/admin/roles';
import { useAuth } from '../lib/auth';
import { useSettings } from '../lib/settings';

export default function WelcomeScreen() {
  const { session, profile } = useAuth();
  const { settings } = useSettings();

  // Already logged in: team members go to the dashboard, clients to the app
  if (session && !profile) return null; // wait for the role
  if (session && isStaff(profile)) return <Redirect href="/admin" />;
  if (session) return <Redirect href="/home" />;

  return (
    <LinearGradient colors={['#D6F0FD', '#8FD0F5', '#1D7FC0']} style={styles.flex}>
      <SafeAreaView style={styles.flex}>
        <View style={styles.content}>
          {/* Logo + slogan */}
          <View style={styles.top}>
            <ZokoLogo size={56} />
            {/* Slogan: app_settings.welcome_tagline */}
            <Text style={styles.tagline}>{settings?.welcome_tagline ?? ' '}</Text>
          </View>

          {/* Image area (we'll put your real photo here later) */}
          <View style={styles.hero}>
            <Ionicons name="car-sport" size={120} color={Colors.white} />
          </View>

          {/* Buttons */}
          <View style={styles.actions}>
            <ZokoButton title="Se connecter" onPress={() => router.push('/login')} />
            <ZokoButton title="Créer un compte" variant="outline" onPress={() => router.push('/register')} />
            <Pressable onPress={() => router.push('/admin/login')} hitSlop={8} style={styles.team}>
              <Text style={styles.teamText}>Espace équipe Zoko</Text>
            </Pressable>
          </View>
        </View>
      </SafeAreaView>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  content: {
    flex: 1,
    width: '100%',
    maxWidth: 420, // stays nice on big computer screens
    alignSelf: 'center',
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.xl,
    justifyContent: 'space-between',
  },
  top: { alignItems: 'center', marginTop: Spacing.xl, gap: Spacing.md },
  tagline: {
    fontFamily: Fonts.semiboldItalic,
    fontSize: 18,
    lineHeight: 26,
    color: Colors.navy,
    textAlign: 'center',
  },
  hero: { alignItems: 'center' },
  actions: { gap: Spacing.md },
  team: { alignSelf: 'center', paddingVertical: Spacing.xs },
  teamText: { fontFamily: Fonts.medium, fontSize: 13, color: Colors.white, textDecorationLine: 'underline' },
});
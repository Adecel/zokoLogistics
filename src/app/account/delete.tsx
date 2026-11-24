import Ionicons from '@expo/vector-icons/Ionicons';
import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { accountStyles as s } from '../../components/account-styles';
import { ScreenHeader } from '../../components/screen-header';
import { ZokoButton } from '../../components/zoko-button';
import { ZokoInput } from '../../components/zoko-input';
import { Colors, Fonts, Radius, Spacing } from '../../constants/zoko';
import { useAuth } from '../../lib/auth';
import { supabase } from '../../lib/supabase';

const CONFIRM_WORD = 'SUPPRIMER';

export default function DeleteAccountScreen() {
  const { signOut } = useAuth();
  const [typed, setTyped] = useState('');
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function remove() {
    setDeleting(true);
    setError(null);
    const { error: err } = await supabase.rpc('delete_my_account');
    if (err) {
      setDeleting(false);
      setError(err.code === 'P0001' ? err.message : 'Suppression impossible. Vérifiez votre connexion.');
      return;
    }
    // Account gone: leave the app (back to the welcome screen)
    await signOut();
  }

  return (
    <SafeAreaView style={s.flex} edges={['top', 'bottom']}>
      <View style={s.inner}>
        <ScreenHeader title="Supprimer mon compte" />
      </View>
      <ScrollView contentContainerStyle={[s.inner, s.content]} keyboardShouldPersistTaps="handled">
        <View style={styles.warningIcon}>
          <Ionicons name="warning-outline" size={36} color={Colors.danger} />
        </View>
        <View style={s.card}>
          <Text style={s.cardTitle}>Ce qui va se passer</Text>
          <Point text="Votre nom, votre téléphone et votre e-mail seront effacés." />
          <Point text="Vous ne pourrez plus vous connecter avec ce compte." />
          <Point text="L’historique de vos réservations passées est conservé de façon anonyme pour la comptabilité de Zoko." />
          <Point text="Impossible s’il vous reste une réservation en attente, confirmée ou en cours." />
          <Point text="Cette action est définitive." />
        </View>

        <ZokoInput
          label={`Pour confirmer, tapez ${CONFIRM_WORD}`}
          icon="trash-outline"
          autoCapitalize="characters"
          autoCorrect={false}
          value={typed}
          onChangeText={setTyped}
        />
        {error ? <Text style={s.error}>{error}</Text> : null}

        <Pressable
          onPress={remove}
          disabled={typed.trim().toUpperCase() !== CONFIRM_WORD || deleting}
          style={[styles.danger, (typed.trim().toUpperCase() !== CONFIRM_WORD || deleting) && { opacity: 0.4 }]}
        >
          <Text style={styles.dangerText}>{deleting ? 'Suppression…' : 'Supprimer définitivement mon compte'}</Text>
        </Pressable>
        <ZokoButton
          title="Garder mon compte"
          variant="outline"
          onPress={() => (router.canGoBack() ? router.back() : router.replace('/profile'))}
        />
      </ScrollView>
    </SafeAreaView>
  );
}

function Point({ text }: { text: string }) {
  return (
    <View style={styles.point}>
      <Ionicons name="ellipse" size={6} color={Colors.textMuted} style={styles.dot} />
      <Text style={styles.pointText}>{text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  warningIcon: {
    alignSelf: 'center',
    width: 72,
    height: 72,
    borderRadius: Radius.pill,
    backgroundColor: '#FDECEC',
    alignItems: 'center',
    justifyContent: 'center',
  },
  point: { flexDirection: 'row', gap: Spacing.sm, alignItems: 'flex-start' },
  dot: { marginTop: 7 },
  pointText: { flex: 1, fontFamily: Fonts.regular, fontSize: 14, lineHeight: 20, color: Colors.text },
  danger: {
    height: 52,
    borderRadius: Radius.md,
    backgroundColor: Colors.danger,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dangerText: { fontFamily: Fonts.semibold, fontSize: 15, color: Colors.white },
});

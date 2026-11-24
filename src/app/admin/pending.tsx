import Ionicons from '@expo/vector-icons/Ionicons';
import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { AdminAuthFrame } from '../../components/admin/auth-frame';
import { Button, Notice } from '../../components/admin/ui';
import { Colors, Fonts, Radius, Spacing } from '../../constants/zoko';
import { ROLE_LABELS } from '../../lib/admin/roles';
import { useAuth } from '../../lib/auth';

// Logged in, but not (or no longer) a team member
export default function AdminPendingScreen() {
  const { profile, signOut, refreshProfile } = useAuth();
  const [checking, setChecking] = useState(false);

  const disabled = profile?.is_active === false;
  const requested = profile?.requested_role;

  async function check() {
    setChecking(true);
    await refreshProfile();
    setChecking(false);
  }

  return (
    <AdminAuthFrame
      title={disabled ? 'Compte désactivé' : requested ? 'Demande envoyée' : 'Accès réservé à l’équipe'}
      subtitle={
        disabled
          ? 'Votre compte a été désactivé. Contactez un administrateur Zoko.'
          : requested
            ? 'Un administrateur doit valider votre accès. Revenez ici une fois prévenu.'
            : 'Ce compte est un compte client. Le tableau de bord est réservé à l’équipe Zoko.'
      }
    >
      <View style={styles.card}>
        <Ionicons
          name={disabled ? 'lock-closed-outline' : requested ? 'hourglass-outline' : 'person-outline'}
          size={28}
          color={Colors.primary}
        />
        <View style={{ flex: 1 }}>
          <Text style={styles.name}>{profile?.full_name}</Text>
          <Text style={styles.muted}>{profile?.email}</Text>
          {requested ? <Text style={styles.muted}>Rôle demandé : {ROLE_LABELS[requested]}</Text> : null}
        </View>
      </View>
      {!disabled && !requested ? (
        <Notice text="Pour rejoindre l’équipe, déconnectez-vous puis utilisez « Demander un accès »." />
      ) : null}
      {requested ? <Button title="Vérifier mon accès" onPress={check} loading={checking} /> : null}
      <Button title="Se déconnecter" variant="outline" onPress={signOut} />
    </AdminAuthFrame>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    padding: Spacing.md,
    backgroundColor: Colors.white,
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  name: { fontFamily: Fonts.semibold, fontSize: 15, color: Colors.text },
  muted: { fontFamily: Fonts.regular, fontSize: 13, color: Colors.textMuted },
});

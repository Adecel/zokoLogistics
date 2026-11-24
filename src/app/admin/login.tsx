import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { AdminAuthFrame } from '../../components/admin/auth-frame';
import { Button, FormError, TextField } from '../../components/admin/ui';
import { Colors, Fonts } from '../../constants/zoko';
import { useAuth } from '../../lib/auth';

export default function AdminLoginScreen() {
  const { signIn } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [errors, setErrors] = useState<{ email?: string; password?: string; form?: string }>({});
  const [submitting, setSubmitting] = useState(false);

  async function handleLogin() {
    const next: typeof errors = {};
    if (!email.trim()) next.email = 'Entrez votre adresse e-mail';
    if (!password) next.password = 'Entrez votre mot de passe';
    setErrors(next);
    if (Object.keys(next).length) return;

    setSubmitting(true);
    const result = await signIn(email, password);
    setSubmitting(false);
    if (result.error) setErrors({ [result.field ?? 'form']: result.error });
    // Success: the layout sends the user to the dashboard (or to the waiting page)
  }

  return (
    <AdminAuthFrame title="Connexion" subtitle="Connectez-vous à l’espace équipe de Zoko Logistics.">
      <View style={styles.fields}>
        <TextField
          label="Adresse e-mail"
          placeholder="prenom@zoko.cg"
          keyboardType="email-address"
          autoCapitalize="none"
          value={email}
          onChangeText={setEmail}
          error={errors.email}
        />
        <TextField
          label="Mot de passe"
          placeholder="Votre mot de passe"
          secure
          value={password}
          onChangeText={setPassword}
          error={errors.password}
        />
      </View>
      <FormError message={errors.form} />
      <Button title="Se connecter" onPress={handleLogin} loading={submitting} />
      <View style={styles.footer}>
        <Text style={styles.muted}>Nouveau dans l’équipe ?</Text>
        <Pressable onPress={() => router.replace('/admin/register')} hitSlop={8}>
          <Text style={styles.link}>Demander un accès</Text>
        </Pressable>
      </View>
    </AdminAuthFrame>
  );
}

const styles = StyleSheet.create({
  fields: { gap: 16 },
  footer: { flexDirection: 'row', justifyContent: 'center', gap: 6, flexWrap: 'wrap' },
  muted: { fontFamily: Fonts.regular, fontSize: 14, color: Colors.textMuted },
  link: { fontFamily: Fonts.semibold, fontSize: 14, color: Colors.primary },
});

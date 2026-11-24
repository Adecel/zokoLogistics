import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { AuthScreen } from '../components/auth-screen';
import { ZokoButton } from '../components/zoko-button';
import { ZokoInput } from '../components/zoko-input';
import { Colors, Fonts, Radius, Spacing } from '../constants/zoko';
import { useAuth } from '../lib/auth';

type Errors = { email?: string; password?: string; form?: string };

export default function LoginScreen() {
  const { signIn } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [errors, setErrors] = useState<Errors>({});
  const [submitting, setSubmitting] = useState(false);

  async function handleLogin() {
    const next: Errors = {};
    if (!email.trim()) next.email = 'Entrez votre adresse e-mail';
    if (!password) next.password = 'Entrez votre mot de passe';
    setErrors(next);
    if (Object.keys(next).length > 0) return;

    setSubmitting(true);
    const result = await signIn(email, password);
    setSubmitting(false);
    if (result.error) {
      setErrors({ [result.field ?? 'form']: result.error });
      return;
    }
    router.replace('/home');
  }

  return (
    <AuthScreen title="Bon retour !" subtitle="Connectez-vous pour réserver et suivre vos locations.">
      <View style={styles.form}>
        <ZokoInput
          label="E-mail"
          icon="mail-outline"
          placeholder="exemple@mail.com"
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="email-address"
          textContentType="emailAddress"
          autoComplete="email"
          value={email}
          onChangeText={setEmail}
          error={errors.email}
        />
        <ZokoInput
          label="Mot de passe"
          icon="lock-closed-outline"
          placeholder="Votre mot de passe"
          password
          textContentType="password"
          value={password}
          onChangeText={setPassword}
          onSubmitEditing={handleLogin}
          error={errors.password}
        />
        {/* TODO: password reset by e-mail (needs a custom SMTP sender in Supabase) */}
        <Pressable style={styles.forgot} hitSlop={8}>
          <Text style={styles.link}>Mot de passe oublié ?</Text>
        </Pressable>
      </View>

      {errors.form ? <Text style={styles.formError}>{errors.form}</Text> : null}

      <ZokoButton title="Se connecter" onPress={handleLogin} loading={submitting} />

      <View style={styles.footer}>
        <Text style={styles.footerText}>Pas encore de compte ?</Text>
        <Pressable onPress={() => router.replace('/register')} hitSlop={8}>
          <Text style={styles.link}>Créer un compte</Text>
        </Pressable>
      </View>
    </AuthScreen>
  );
}

const styles = StyleSheet.create({
  form: { gap: Spacing.md },
  forgot: { alignSelf: 'flex-end' },
  link: { fontFamily: Fonts.semibold, fontSize: 14, color: Colors.primary },
  formError: {
    fontFamily: Fonts.medium,
    fontSize: 13,
    color: Colors.danger,
    backgroundColor: '#FDECEC',
    padding: Spacing.md,
    borderRadius: Radius.md,
    textAlign: 'center',
  },
  footer: { flexDirection: 'row', justifyContent: 'center', gap: Spacing.xs, flexWrap: 'wrap' },
  footerText: { fontFamily: Fonts.regular, fontSize: 14, color: Colors.textMuted },
});

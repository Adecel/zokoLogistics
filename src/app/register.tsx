import Ionicons from '@expo/vector-icons/Ionicons';
import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { AuthScreen } from '../components/auth-screen';
import { ZokoButton } from '../components/zoko-button';
import { ZokoInput } from '../components/zoko-input';
import { Colors, Fonts, Radius, Spacing } from '../constants/zoko';
import { EMAIL_RE, useAuth } from '../lib/auth';
import { phoneDigits } from '../lib/phone';

type Field = 'name' | 'phone' | 'email' | 'password' | 'confirm' | 'terms' | 'form';
type Errors = Partial<Record<Field, string>>;


export default function RegisterScreen() {
  const { signUp } = useAuth();
  const [submitting, setSubmitting] = useState(false);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [terms, setTerms] = useState(false);
  const [errors, setErrors] = useState<Errors>({});

  async function handleRegister() {
    const next: Errors = {};
    if (name.trim().length < 2) next.name = 'Entrez votre nom complet';
    if (!phoneDigits(phone)) next.phone = 'Entrez un numéro valide (ex. 06 123 45 67)';
    if (!email.trim()) next.email = 'Entrez votre adresse e-mail';
    else if (!EMAIL_RE.test(email.trim())) next.email = 'Adresse e-mail invalide';
    if (password.length < 8) next.password = 'Au moins 8 caractères';
    if (confirm !== password) next.confirm = 'Les mots de passe ne correspondent pas';
    if (!terms) next.terms = 'Vous devez accepter les conditions';
    setErrors(next);
    if (Object.keys(next).length > 0) return;

    setSubmitting(true);
    const result = await signUp({ fullName: name, phone, email, password });
    setSubmitting(false);
    if (result.error) {
      setErrors({ [result.field ?? 'form']: result.error });
      return;
    }
    router.replace('/home');
  }

  return (
    <AuthScreen title="Créer un compte" subtitle="Rejoignez Zoko pour louer un véhicule avec chauffeur en quelques clics.">
      <View style={styles.form}>
        <ZokoInput
          label="Nom complet"
          icon="person-outline"
          placeholder="Jean Mukendi"
          autoCapitalize="words"
          textContentType="name"
          value={name}
          onChangeText={setName}
          error={errors.name}
        />
        <ZokoInput
          label="Téléphone"
          icon="call-outline"
          placeholder="06 123 45 67"
          keyboardType="phone-pad"
          textContentType="telephoneNumber"
          value={phone}
          onChangeText={setPhone}
          error={errors.phone}
        />
        <ZokoInput
          label="E-mail"
          icon="mail-outline"
          placeholder="exemple@mail.com"
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="email-address"
          textContentType="emailAddress"
          value={email}
          onChangeText={setEmail}
          error={errors.email}
        />
        <ZokoInput
          label="Mot de passe"
          icon="lock-closed-outline"
          placeholder="8 caractères minimum"
          password
          textContentType="newPassword"
          value={password}
          onChangeText={setPassword}
          error={errors.password}
        />
        <ZokoInput
          label="Confirmer le mot de passe"
          icon="lock-closed-outline"
          placeholder="Retapez le mot de passe"
          password
          textContentType="newPassword"
          value={confirm}
          onChangeText={setConfirm}
          onSubmitEditing={handleRegister}
          error={errors.confirm}
        />

        <View>
          <Pressable
            style={styles.terms}
            onPress={() => setTerms((t) => !t)}
            accessibilityRole="checkbox"
            accessibilityState={{ checked: terms }}
          >
            <View style={[styles.checkbox, terms && styles.checkboxOn]}>
              {terms && <Ionicons name="checkmark" size={16} color={Colors.white} />}
            </View>
            <Text style={styles.termsText}>
              {"J'accepte les "}
              <Text style={styles.link} onPress={() => router.push('/legal/terms')} accessibilityRole="link">
                {"conditions d'utilisation"}
              </Text>
              {' et la '}
              <Text style={styles.link} onPress={() => router.push('/legal/privacy')} accessibilityRole="link">
                politique de confidentialité
              </Text>
            </Text>
          </Pressable>
          {errors.terms ? <Text style={styles.error}>{errors.terms}</Text> : null}
        </View>
      </View>

      {errors.form ? <Text style={styles.formError}>{errors.form}</Text> : null}

      <ZokoButton title="Créer mon compte" onPress={handleRegister} loading={submitting} />

      <View style={styles.footer}>
        <Text style={styles.footerText}>Déjà un compte ?</Text>
        <Pressable onPress={() => router.replace('/login')} hitSlop={8}>
          <Text style={styles.link}>Se connecter</Text>
        </Pressable>
      </View>
    </AuthScreen>
  );
}

const styles = StyleSheet.create({
  form: { gap: Spacing.md },
  terms: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.sm },
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: Radius.sm - 2,
    borderWidth: 1.5,
    borderColor: Colors.border,
    backgroundColor: Colors.white,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 1,
  },
  checkboxOn: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  termsText: { flex: 1, fontFamily: Fonts.regular, fontSize: 13, lineHeight: 20, color: Colors.textMuted },
  link: { fontFamily: Fonts.semibold, fontSize: 14, color: Colors.primary },
  error: { fontFamily: Fonts.regular, fontSize: 12, color: Colors.danger, marginTop: Spacing.xs },
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

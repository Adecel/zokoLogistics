import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { AdminAuthFrame } from '../../components/admin/auth-frame';
import { Button, Choice, FieldRow, Notice, TextField } from '../../components/admin/ui';
import { Colors, Fonts } from '../../constants/zoko';
import { REQUESTABLE_ROLES, ROLE_DESCRIPTIONS, ROLE_LABELS, type Role } from '../../lib/admin/roles';
import { useAuth } from '../../lib/auth';

type Errors = { fullName?: string; phone?: string; email?: string; password?: string; confirm?: string; form?: string };

export default function AdminRegisterScreen() {
  const { signUp } = useAuth();
  const [fullName, setFullName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [role, setRole] = useState<Role>('manager');
  const [errors, setErrors] = useState<Errors>({});
  const [info, setInfo] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleRegister() {
    const next: Errors = {};
    if (fullName.trim().length < 2) next.fullName = 'Entrez votre nom complet';
    if (!phone.trim()) next.phone = 'Entrez votre numéro de téléphone';
    if (!email.trim()) next.email = 'Entrez votre adresse e-mail';
    if (password.length < 8) next.password = 'Au moins 8 caractères';
    if (confirm !== password) next.confirm = 'Les mots de passe ne correspondent pas';
    setErrors(next);
    setInfo(null);
    if (Object.keys(next).length) return;

    setSubmitting(true);
    const result = await signUp({ fullName, phone, email, password, requestedRole: role });
    setSubmitting(false);
    if (result.error) {
      // "Account created, confirm your e-mail" comes back as a form message
      if (result.error.startsWith('Compte créé')) setInfo(result.error);
      else setErrors({ [result.field ?? 'form']: result.error });
    }
    // Logged in right away: the layout shows the "waiting for approval" page
  }

  return (
    <AdminAuthFrame
      title="Demander un accès"
      subtitle="Créez votre compte. Un administrateur validera votre accès et votre rôle."
    >
      <View style={styles.fields}>
        <TextField label="Nom complet" placeholder="Prénom Nom" value={fullName} onChangeText={setFullName} error={errors.fullName} />
        <FieldRow>
          <TextField
            label="Téléphone"
            placeholder="06 123 45 67"
            keyboardType="phone-pad"
            value={phone}
            onChangeText={setPhone}
            error={errors.phone}
          />
          <TextField
            label="Adresse e-mail"
            placeholder="prenom@zoko.cg"
            keyboardType="email-address"
            autoCapitalize="none"
            value={email}
            onChangeText={setEmail}
            error={errors.email}
          />
        </FieldRow>
        <FieldRow>
          <TextField label="Mot de passe" secure value={password} onChangeText={setPassword} error={errors.password} />
          <TextField label="Confirmer" secure value={confirm} onChangeText={setConfirm} error={errors.confirm} />
        </FieldRow>
        <Choice
          label="Rôle demandé"
          options={REQUESTABLE_ROLES.map((r) => ({ value: r, label: ROLE_LABELS[r] }))}
          value={role}
          onChange={setRole}
        />
        <Text style={styles.muted}>{ROLE_DESCRIPTIONS[role]}</Text>
      </View>
      {errors.form ? <Notice text={errors.form} tone="danger" /> : null}
      {info ? <Notice text={info} tone="success" /> : null}
      <Button title="Envoyer la demande" onPress={handleRegister} loading={submitting} />
      <View style={styles.footer}>
        <Text style={styles.muted}>Déjà un compte ?</Text>
        <Pressable onPress={() => router.replace('/admin/login')} hitSlop={8}>
          <Text style={styles.link}>Se connecter</Text>
        </Pressable>
      </View>
    </AdminAuthFrame>
  );
}

const styles = StyleSheet.create({
  fields: { gap: 16 },
  footer: { flexDirection: 'row', justifyContent: 'center', gap: 6, flexWrap: 'wrap' },
  muted: { fontFamily: Fonts.regular, fontSize: 13, color: Colors.textMuted },
  link: { fontFamily: Fonts.semibold, fontSize: 14, color: Colors.primary },
});

import { useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { accountStyles as s } from '../../components/account-styles';
import { ScreenHeader } from '../../components/screen-header';
import { ZokoButton } from '../../components/zoko-button';
import { ZokoInput } from '../../components/zoko-input';
import { useAuth } from '../../lib/auth';
import { supabase } from '../../lib/supabase';

type Errors = { current?: string; next?: string; confirm?: string; form?: string };

export default function PasswordScreen() {
  const { session } = useAuth();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [errors, setErrors] = useState<Errors>({});
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  async function save() {
    const e: Errors = {};
    if (!current) e.current = 'Entrez votre mot de passe actuel';
    if (next.length < 8) e.next = 'Au moins 8 caractères';
    else if (next === current) e.next = 'Choisissez un mot de passe différent de l’actuel';
    if (confirm !== next) e.confirm = 'Les mots de passe ne correspondent pas';
    setErrors(e);
    setSaved(false);
    const email = session?.user.email;
    if (Object.keys(e).length > 0 || !email) return;

    setSaving(true);
    // Check the current password first
    const check = await supabase.auth.signInWithPassword({ email, password: current });
    if (check.error) {
      setSaving(false);
      setErrors(
        check.error.code === 'invalid_credentials'
          ? { current: 'Mot de passe actuel incorrect' }
          : { form: 'Vérification impossible. Vérifiez votre connexion.' },
      );
      return;
    }
    const { error } = await supabase.auth.updateUser({ password: next });
    setSaving(false);
    if (error) {
      setErrors({
        form: error.code === 'weak_password' ? 'Mot de passe trop faible' : 'Changement impossible. Réessayez plus tard.',
      });
      return;
    }
    setCurrent('');
    setNext('');
    setConfirm('');
    setSaved(true);
  }

  return (
    <SafeAreaView style={s.flex} edges={['top', 'bottom']}>
      <KeyboardAvoidingView style={s.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={s.inner}>
          <ScreenHeader title="Mot de passe" />
        </View>
        <ScrollView contentContainerStyle={[s.inner, s.content]} keyboardShouldPersistTaps="handled">
          <ZokoInput
            label="Mot de passe actuel"
            icon="lock-closed-outline"
            password
            textContentType="password"
            value={current}
            onChangeText={setCurrent}
            error={errors.current}
          />
          <ZokoInput
            label="Nouveau mot de passe"
            icon="lock-closed-outline"
            placeholder="8 caractères minimum"
            password
            textContentType="newPassword"
            value={next}
            onChangeText={setNext}
            error={errors.next}
          />
          <ZokoInput
            label="Confirmer le nouveau mot de passe"
            icon="lock-closed-outline"
            password
            textContentType="newPassword"
            value={confirm}
            onChangeText={setConfirm}
            onSubmitEditing={save}
            error={errors.confirm}
          />
          {errors.form ? <Text style={s.error}>{errors.form}</Text> : null}
          {saved ? <Text style={s.success}>Votre mot de passe a été changé.</Text> : null}
          <ZokoButton title="Changer le mot de passe" onPress={save} loading={saving} />
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

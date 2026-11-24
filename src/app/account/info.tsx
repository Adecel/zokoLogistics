import { useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { accountStyles as s } from '../../components/account-styles';
import { Loading } from '../../components/load-state';
import { ScreenHeader } from '../../components/screen-header';
import { ZokoButton } from '../../components/zoko-button';
import { ZokoInput } from '../../components/zoko-input';
import { useAuth, type Profile } from '../../lib/auth';
import { formatPhone, phoneDigits } from '../../lib/phone';
import { supabase } from '../../lib/supabase';

export default function InfoScreen() {
  const { profile } = useAuth();
  return (
    <SafeAreaView style={s.flex} edges={['top', 'bottom']}>
      <KeyboardAvoidingView style={s.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={s.inner}>
          <ScreenHeader title="Mes informations" />
        </View>
        {profile ? <InfoForm profile={profile} /> : <Loading />}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function InfoForm({ profile }: { profile: Profile }) {
  const { refreshProfile, session } = useAuth();
  const [name, setName] = useState(profile.full_name);
  const [phone, setPhone] = useState(profile.phone ?? '');
  const [errors, setErrors] = useState<{ name?: string; phone?: string; form?: string }>({});
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const changed = name.trim() !== profile.full_name || phone.trim() !== (profile.phone ?? '');

  async function save() {
    const next: typeof errors = {};
    if (name.trim().length < 2) next.name = 'Entrez votre nom complet';
    const digits = phoneDigits(phone);
    if (!digits) next.phone = 'Entrez un numéro valide (ex. 06 123 45 67)';
    setErrors(next);
    setSaved(false);
    if (Object.keys(next).length > 0 || !digits) return;

    setSaving(true);
    const { error } = await supabase
      .from('profiles')
      .update({ full_name: name.trim(), phone: formatPhone(digits) })
      .eq('id', profile.id);
    if (!error) await refreshProfile();
    setSaving(false);

    if (error) {
      setErrors(
        error.code === '23505'
          ? { phone: 'Ce numéro est déjà utilisé par un autre compte.' }
          : { form: 'Enregistrement impossible. Vérifiez votre connexion.' },
      );
      return;
    }
    setPhone(formatPhone(digits));
    setSaved(true);
  }

  return (
    <ScrollView contentContainerStyle={[s.inner, s.content]} keyboardShouldPersistTaps="handled">
      <ZokoInput
        label="Nom complet"
        icon="person-outline"
        autoCapitalize="words"
        value={name}
        onChangeText={(t) => {
          setName(t);
          setSaved(false);
        }}
        error={errors.name}
      />
      <ZokoInput
        label="Téléphone"
        icon="call-outline"
        keyboardType="phone-pad"
        value={phone}
        onChangeText={(t) => {
          setPhone(t);
          setSaved(false);
        }}
        error={errors.phone}
      />
      <ZokoInput
        label="E-mail"
        icon="mail-outline"
        value={profile.email ?? session?.user.email ?? ''}
        editable={false}
        style={{ opacity: 0.6 }}
      />
      <Text style={s.muted}>
        L’e-mail sert à vous connecter. Pour le changer, contactez Zoko depuis « Aide et support ».
      </Text>

      {errors.form ? <Text style={s.error}>{errors.form}</Text> : null}
      {saved ? <Text style={s.success}>Vos informations ont été enregistrées.</Text> : null}

      <ZokoButton title="Enregistrer" onPress={save} loading={saving} disabled={!changed} />
    </ScrollView>
  );
}

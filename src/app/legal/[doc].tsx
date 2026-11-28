import { Link, useLocalSearchParams } from 'expo-router';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { accountStyles as s } from '../../components/account-styles';
import { ScreenHeader } from '../../components/screen-header';
import { Colors, Fonts, Spacing } from '../../constants/zoko';
import { legalDoc, type LegalDocKey } from '../../lib/legal';
import { useSettings } from '../../lib/settings';

// Public page (no login needed): /legal/terms and /legal/privacy
export default function LegalScreen() {
  const { doc: param } = useLocalSearchParams<{ doc: string }>();
  const key: LegalDocKey = param === 'privacy' ? 'privacy' : 'terms';
  const { settings } = useSettings(); // text still shows while settings load
  const doc = legalDoc(key, settings ?? undefined);
  const other: LegalDocKey = key === 'terms' ? 'privacy' : 'terms';

  return (
    <SafeAreaView style={s.flex} edges={['top', 'bottom']}>
      <View style={s.inner}>
        <ScreenHeader title={doc.title} fallback="/" />
      </View>
      <ScrollView contentContainerStyle={[s.inner, s.content]}>
        <Text style={styles.updated}>Dernière mise à jour : {doc.updated}</Text>
        <Text style={styles.intro}>{doc.intro}</Text>

        {doc.sections.map((section) => (
          <View key={section.title} style={s.card}>
            <Text style={s.cardTitle}>{section.title}</Text>
            {section.items?.map((item) => (
              <View key={item} style={styles.item}>
                <Text style={styles.bullet}>•</Text>
                <Text style={styles.text}>{item}</Text>
              </View>
            ))}
            {section.paragraphs?.map((p) => (
              <Text key={p} style={styles.text}>
                {p}
              </Text>
            ))}
          </View>
        ))}

        <Link href={`/legal/${other}`} replace style={styles.link}>
          {other === 'terms' ? 'Lire les conditions d’utilisation' : 'Lire la politique de confidentialité'}
        </Link>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  updated: { fontFamily: Fonts.regular, fontSize: 12, color: Colors.textMuted },
  intro: { fontFamily: Fonts.regular, fontSize: 14, lineHeight: 21, color: Colors.text },
  item: { flexDirection: 'row', gap: Spacing.sm, alignItems: 'flex-start' },
  bullet: { fontFamily: Fonts.bold, fontSize: 14, lineHeight: 20, color: Colors.primary },
  text: { flex: 1, fontFamily: Fonts.regular, fontSize: 14, lineHeight: 20, color: Colors.textMuted },
  link: { alignSelf: 'center', fontFamily: Fonts.semibold, fontSize: 14, color: Colors.primary, paddingVertical: Spacing.sm },
});

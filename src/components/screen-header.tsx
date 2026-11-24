import Ionicons from '@expo/vector-icons/Ionicons';
import { router, type Href } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Colors, Fonts, Radius, Spacing } from '../constants/zoko';

// Back button + title, used by secondary screens
export function ScreenHeader({ title, fallback = '/profile' }: { title: string; fallback?: Href }) {
  return (
    <View style={styles.header}>
      <Pressable
        onPress={() => (router.canGoBack() ? router.back() : router.replace(fallback))}
        style={styles.back}
        hitSlop={10}
        accessibilityLabel="Retour"
      >
        <Ionicons name="chevron-back" size={22} color={Colors.text} />
      </Pressable>
      <Text style={styles.title}>{title}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, paddingVertical: Spacing.md },
  back: {
    width: 40,
    height: 40,
    borderRadius: Radius.pill,
    backgroundColor: Colors.white,
    borderWidth: 1,
    borderColor: Colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: { flexShrink: 1, fontFamily: Fonts.bold, fontSize: 20, color: Colors.navy },
});

import Ionicons from '@expo/vector-icons/Ionicons';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { Colors, Fonts, Radius, Spacing } from '../constants/zoko';

export function Loading({ label = 'Chargement…' }: { label?: string }) {
  return (
    <View style={styles.box}>
      <ActivityIndicator color={Colors.primary} />
      <Text style={styles.text}>{label}</Text>
    </View>
  );
}

export function LoadError({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <View style={styles.box}>
      <Ionicons name="cloud-offline-outline" size={32} color={Colors.textMuted} />
      <Text style={styles.text}>{message}</Text>
      {onRetry && (
        <Pressable onPress={onRetry} style={styles.retry} hitSlop={8}>
          <Text style={styles.retryText}>Réessayer</Text>
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  box: { alignItems: 'center', justifyContent: 'center', gap: Spacing.sm, padding: Spacing.lg },
  text: { fontFamily: Fonts.regular, fontSize: 14, color: Colors.textMuted, textAlign: 'center' },
  retry: {
    marginTop: Spacing.xs,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    borderRadius: Radius.pill,
    borderWidth: 1.5,
    borderColor: Colors.primary,
  },
  retryText: { fontFamily: Fonts.semibold, fontSize: 14, color: Colors.primary },
});

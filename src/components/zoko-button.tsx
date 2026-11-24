import { ActivityIndicator, Pressable, StyleSheet, Text } from 'react-native';
import { Colors, Fonts, Radius } from '../constants/zoko';

type Props = {
  title: string;
  onPress?: () => void;
  variant?: 'primary' | 'outline';
  disabled?: boolean;
  loading?: boolean;
};

export function ZokoButton({ title, onPress, variant = 'primary', disabled, loading }: Props) {
  const isPrimary = variant === 'primary';
  const color = isPrimary ? Colors.white : Colors.primary;
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled || loading}
      accessibilityRole="button"
      accessibilityState={{ disabled: disabled || loading, busy: loading }}
      style={({ pressed }) => [
        styles.base,
        isPrimary ? styles.primary : styles.outline,
        pressed && { opacity: 0.85 },
        disabled && { opacity: 0.5 },
      ]}
    >
      {loading ? <ActivityIndicator color={color} /> : <Text style={[styles.text, { color }]}>{title}</Text>}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    height: 52,
    width: '100%',
    borderRadius: Radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primary: { backgroundColor: Colors.primary },
  outline: { backgroundColor: Colors.white, borderWidth: 1.5, borderColor: Colors.primary },
  text: { fontFamily: Fonts.semibold, fontSize: 16 },
});

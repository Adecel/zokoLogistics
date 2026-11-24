import Ionicons from '@expo/vector-icons/Ionicons';
import { useState, type ComponentProps } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View, type TextInputProps } from 'react-native';
import { Colors, Fonts, Radius, Spacing } from '../constants/zoko';

type Props = TextInputProps & {
  label: string;
  icon: ComponentProps<typeof Ionicons>['name'];
  error?: string;
  password?: boolean;
};

export function ZokoInput({ label, icon, error, password, style, ...inputProps }: Props) {
  const [focused, setFocused] = useState(false);
  const [hidden, setHidden] = useState(true);

  const borderColor = error ? Colors.danger : focused ? Colors.primary : Colors.border;

  return (
    <View style={styles.wrap}>
      <Text style={styles.label}>{label}</Text>
      <View style={[styles.field, { borderColor }]}>
        <Ionicons name={icon} size={20} color={focused ? Colors.primary : Colors.textMuted} />
        <TextInput
          {...inputProps}
          secureTextEntry={password && hidden}
          placeholderTextColor={Colors.textMuted}
          onFocus={(e) => {
            setFocused(true);
            inputProps.onFocus?.(e);
          }}
          onBlur={(e) => {
            setFocused(false);
            inputProps.onBlur?.(e);
          }}
          style={[styles.input, style]}
        />
        {password && (
          <Pressable
            onPress={() => setHidden((h) => !h)}
            hitSlop={10}
            accessibilityLabel={hidden ? 'Afficher le mot de passe' : 'Masquer le mot de passe'}
          >
            <Ionicons name={hidden ? 'eye-outline' : 'eye-off-outline'} size={20} color={Colors.textMuted} />
          </Pressable>
        )}
      </View>
      {error ? <Text style={styles.error}>{error}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: Spacing.xs },
  label: { fontFamily: Fonts.medium, fontSize: 14, color: Colors.text },
  field: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    height: 52,
    paddingHorizontal: Spacing.md,
    borderWidth: 1.5,
    borderRadius: Radius.md,
    backgroundColor: Colors.white,
  },
  input: {
    flex: 1,
    height: '100%',
    fontFamily: Fonts.regular,
    fontSize: 15,
    color: Colors.text,
  },
  error: { fontFamily: Fonts.regular, fontSize: 12, color: Colors.danger },
});

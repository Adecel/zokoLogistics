import Ionicons from '@expo/vector-icons/Ionicons';
import { router } from 'expo-router';
import type { ReactNode } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Colors, Fonts, Radius, Spacing } from '../constants/zoko';
import { ZokoLogo } from './zoko-logo';

type Props = {
  title: string;
  subtitle: string;
  children: ReactNode;
};

// Shared frame for the login and sign-up screens: back button, logo, title, scrollable form
export function AuthScreen({ title, subtitle, children }: Props) {
  return (
    <SafeAreaView style={styles.flex}>
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
          <View style={styles.content}>
            <Pressable
              onPress={() => (router.canGoBack() ? router.back() : router.replace('/'))}
              style={styles.back}
              hitSlop={10}
              accessibilityLabel="Retour"
            >
              <Ionicons name="chevron-back" size={22} color={Colors.text} />
            </Pressable>

            <View style={styles.header}>
              <ZokoLogo size={40} />
              <Text style={styles.title}>{title}</Text>
              <Text style={styles.subtitle}>{subtitle}</Text>
            </View>

            {children}
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: Colors.background },
  scroll: { flexGrow: 1 },
  content: {
    flex: 1,
    width: '100%',
    maxWidth: 420,
    alignSelf: 'center',
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.md,
    gap: Spacing.lg,
  },
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
  header: { alignItems: 'center', gap: Spacing.sm, marginBottom: Spacing.sm },
  title: { fontFamily: Fonts.bold, fontSize: 24, color: Colors.navy, marginTop: Spacing.md, textAlign: 'center' },
  subtitle: { fontFamily: Fonts.regular, fontSize: 14, color: Colors.textMuted, textAlign: 'center' },
});

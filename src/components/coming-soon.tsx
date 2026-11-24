import Ionicons from '@expo/vector-icons/Ionicons';
import type { ComponentProps, ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Colors, Fonts, Radius, Spacing } from '../constants/zoko';

type Props = {
  title: string;
  description: string;
  icon: ComponentProps<typeof Ionicons>['name'];
  children?: ReactNode;
};

// Temporary screen for tabs we haven't built yet
export function ComingSoon({ title, description, icon, children }: Props) {
  return (
    <SafeAreaView style={styles.flex} edges={['top']}>
      <View style={styles.content}>
        <View style={styles.iconWrap}>
          <Ionicons name={icon} size={40} color={Colors.primary} />
        </View>
        <Text style={styles.title}>{title}</Text>
        <Text style={styles.description}>{description}</Text>
        {children}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: Colors.background },
  content: {
    flex: 1,
    width: '100%',
    maxWidth: 420,
    alignSelf: 'center',
    alignItems: 'center',
    justifyContent: 'center',
    padding: Spacing.lg,
    gap: Spacing.md,
  },
  iconWrap: {
    width: 88,
    height: 88,
    borderRadius: Radius.pill,
    backgroundColor: '#E3F2FC',
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: { fontFamily: Fonts.bold, fontSize: 22, color: Colors.navy, textAlign: 'center' },
  description: { fontFamily: Fonts.regular, fontSize: 14, lineHeight: 22, color: Colors.textMuted, textAlign: 'center' },
});

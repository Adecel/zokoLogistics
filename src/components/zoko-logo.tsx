import Ionicons from '@expo/vector-icons/Ionicons';
import { StyleSheet, Text, View } from 'react-native';
import { Colors, Fonts } from '../constants/zoko';

type Props = { size?: number; color?: string };

export function ZokoLogo({ size = 48, color = Colors.primary }: Props) {
  return (
    <View style={styles.wrap}>
      <Ionicons
        name="airplane"
        size={size * 0.5}
        color={color}
        style={[styles.plane, { top: -size * 0.3, right: -size * 0.4 }]}
      />
      <Text style={[styles.word, { fontSize: size, lineHeight: size * 1.2, color }]}>ZOKO</Text>
      <Text style={[styles.tag, { fontSize: size * 0.22 }]}>LOGISTICS & VOYAGE</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: 'center' },
  plane: { position: 'absolute', transform: [{ rotate: '-25deg' }] },
  word: { fontFamily: Fonts.logo, letterSpacing: 2 },
  tag: { fontFamily: Fonts.semibold, color: Colors.navy, letterSpacing: 2 },
});
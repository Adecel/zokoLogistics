import Ionicons from '@expo/vector-icons/Ionicons';
import { Image } from 'expo-image';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { Colors, Radius } from '../constants/zoko';

type Props = { uri?: string; size?: number; style?: StyleProp<ViewStyle> };

// Vehicle photo, or a car icon while no photo has been uploaded
export function VehicleImage({ uri, size = 48, style }: Props) {
  return (
    <View style={[styles.box, style]}>
      {uri ? (
        <Image source={{ uri }} style={StyleSheet.absoluteFill} contentFit="cover" transition={200} />
      ) : (
        <Ionicons name="car-sport" size={size} color={Colors.primary} />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  box: {
    borderRadius: Radius.md,
    backgroundColor: '#E3F2FC',
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
});

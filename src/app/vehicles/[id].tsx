import Ionicons from '@expo/vector-icons/Ionicons';
import { router, useLocalSearchParams } from 'expo-router';
import { useState, type ComponentProps } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LoadError, Loading } from '../../components/load-state';
import { VehicleImage } from '../../components/vehicle-image';
import { ZokoButton } from '../../components/zoko-button';
import { FUEL_LABELS, TRANSMISSION_LABELS, formatPrice } from '../../constants/vehicles';
import { Colors, Fonts, Radius, Spacing } from '../../constants/zoko';
import { useCatalog, type CatalogVehicle } from '../../lib/catalog';
import { useSettings } from '../../lib/settings';

type Params = { id: string; date?: string; duration?: string; place?: string };
type IconName = ComponentProps<typeof Ionicons>['name'];

const MAX_WIDTH = 520;
const GALLERY_HEIGHT = 280;

export default function VehicleDetailsScreen() {
  const params = useLocalSearchParams<Params>();
  const { vehicles, error, loading, reload } = useCatalog();
  const vehicle = vehicles?.find((v) => v.id === params.id);

  const goBack = () => (router.canGoBack() ? router.back() : router.replace('/vehicles'));

  if (!vehicle) {
    return (
      <SafeAreaView style={[styles.flex, styles.center]}>
        <View style={styles.floatingTop}>
          <RoundButton icon="chevron-back" label="Retour" onPress={goBack} />
        </View>
        {loading && <Loading label="Chargement du véhicule…" />}
        {error && <LoadError message={error} onRetry={reload} />}
        {vehicles && <LoadError message="Ce véhicule n'est plus disponible." />}
      </SafeAreaView>
    );
  }

  return <Details vehicle={vehicle} params={params} onBack={goBack} />;
}

function Details({ vehicle, params, onBack }: { vehicle: CatalogVehicle; params: Params; onBack: () => void }) {
  const { settings } = useSettings();
  const currency = settings?.currency_label;
  const durations = vehicle.durations;
  const initial = durations.find((d) => String(d) === params.duration) ?? durations[0];
  const [duration, setDuration] = useState(initial);

  const specs: { icon: IconName; label: string }[] = [
    { icon: 'people-outline', label: `${vehicle.seats} places` },
    { icon: 'cog-outline', label: TRANSMISSION_LABELS[vehicle.transmission] },
    { icon: 'water-outline', label: FUEL_LABELS[vehicle.fuelType] },
  ];

  function handleBook() {
    router.push({
      pathname: '/booking/[id]',
      params: {
        id: vehicle.id,
        duration: String(duration),
        ...(params.date && { date: params.date }),
        ...(params.place && { place: params.place }),
      },
    });
  }

  return (
    <View style={styles.flex}>
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <View style={styles.inner}>
          <Gallery photos={vehicle.photos} />
          <SafeAreaView edges={['top']} style={styles.floatingTop} pointerEvents="box-none">
            <RoundButton icon="chevron-back" label="Retour" onPress={onBack} />
          </SafeAreaView>

          <View style={styles.body}>
            {/* Name + quick specs */}
            <View style={styles.section}>
              <Text style={styles.brand}>{vehicle.brand}</Text>
              <Text style={styles.name}>{vehicle.name}</Text>
              <View style={styles.chips}>
                {specs.map((s) => (
                  <View key={s.label} style={styles.chip}>
                    <Ionicons name={s.icon} size={15} color={Colors.primary} />
                    <Text style={styles.chipText}>{s.label}</Text>
                  </View>
                ))}
              </View>
              {vehicle.description ? <Text style={styles.description}>{vehicle.description}</Text> : null}
            </View>

            {/* Prices */}
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Tarifs</Text>
              <View style={styles.prices}>
                {durations.map((d) => {
                  const selected = d === duration;
                  return (
                    <Pressable
                      key={d}
                      onPress={() => setDuration(d)}
                      style={[styles.priceCard, selected && styles.priceCardSelected]}
                      accessibilityRole="radio"
                      accessibilityState={{ selected }}
                    >
                      <Text style={[styles.priceDuration, selected && styles.onPrimaryMuted]}>{d} heures</Text>
                      <Text style={[styles.priceValue, selected && styles.onPrimary]}>{formatPrice(vehicle.prices[d], currency)}</Text>
                    </Pressable>
                  );
                })}
              </View>
              {settings?.pricing_note ? <Text style={styles.note}>{settings.pricing_note}</Text> : null}
            </View>

            {/* Features */}
            {vehicle.features.length > 0 && (
              <View style={styles.section}>
                <Text style={styles.sectionTitle}>Caractéristiques</Text>
                <View style={styles.card}>
                  {vehicle.features.map((f) => (
                    <View key={f} style={styles.featureRow}>
                      <View style={styles.check}>
                        <Ionicons name="checkmark" size={14} color={Colors.success} />
                      </View>
                      <Text style={styles.featureText}>{f}</Text>
                    </View>
                  ))}
                </View>
              </View>
            )}
          </View>
        </View>
      </ScrollView>

      {/* Sticky booking bar */}
      <SafeAreaView edges={['bottom']} style={styles.bottomBar}>
        <View style={[styles.inner, styles.bottomInner]}>
          <View>
            <Text style={styles.bottomLabel}>{duration} h</Text>
            <Text style={styles.bottomPrice}>{formatPrice(vehicle.prices[duration], currency)}</Text>
          </View>
          <View style={styles.flex1}>
            <ZokoButton title="Réserver maintenant" onPress={handleBook} />
          </View>
        </View>
      </SafeAreaView>
    </View>
  );
}

function Gallery({ photos }: { photos: string[] }) {
  const { width } = useWindowDimensions();
  const w = Math.min(width, MAX_WIDTH);
  const [index, setIndex] = useState(0);

  if (photos.length <= 1) {
    return <VehicleImage uri={photos[0]} size={96} style={[styles.gallery, { width: w }]} />;
  }

  return (
    <View>
      <ScrollView
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        onMomentumScrollEnd={(e) => setIndex(Math.round(e.nativeEvent.contentOffset.x / w))}
      >
        {photos.map((uri) => (
          <VehicleImage key={uri} uri={uri} style={[styles.gallery, { width: w }]} />
        ))}
      </ScrollView>
      <View style={styles.dots}>
        {photos.map((uri, i) => (
          <View key={uri} style={[styles.dot, i === index && styles.dotActive]} />
        ))}
      </View>
    </View>
  );
}

function RoundButton({ icon, label, onPress }: { icon: IconName; label: string; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={styles.round} hitSlop={10} accessibilityLabel={label}>
      <Ionicons name={icon} size={22} color={Colors.text} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: Colors.background },
  flex1: { flex: 1 },
  center: { justifyContent: 'center' },
  scroll: { flexGrow: 1, paddingBottom: Spacing.xl },
  inner: { width: '100%', maxWidth: MAX_WIDTH, alignSelf: 'center' },
  onPrimary: { color: Colors.white },
  onPrimaryMuted: { color: '#D6ECFA' },

  gallery: { height: GALLERY_HEIGHT, borderRadius: 0 },
  dots: { position: 'absolute', bottom: Spacing.md, alignSelf: 'center', flexDirection: 'row', gap: 6 },
  dot: { width: 7, height: 7, borderRadius: Radius.pill, backgroundColor: 'rgba(255,255,255,0.6)' },
  dotActive: { width: 18, backgroundColor: Colors.white },

  floatingTop: { position: 'absolute', top: 0, left: 0, paddingHorizontal: Spacing.lg, paddingTop: Spacing.md },
  round: {
    width: 40,
    height: 40,
    marginTop: Spacing.sm,
    borderRadius: Radius.pill,
    backgroundColor: 'rgba(255,255,255,0.92)',
    alignItems: 'center',
    justifyContent: 'center',
  },

  body: {
    marginTop: -Spacing.lg,
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.lg,
    gap: Spacing.lg,
    backgroundColor: Colors.background,
    borderTopLeftRadius: Radius.xl,
    borderTopRightRadius: Radius.xl,
  },
  section: { gap: Spacing.sm },
  brand: { fontFamily: Fonts.medium, fontSize: 13, color: Colors.primary, textTransform: 'uppercase', letterSpacing: 1 },
  name: { fontFamily: Fonts.bold, fontSize: 26, color: Colors.navy, marginTop: -4 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: Spacing.sm + 4,
    paddingVertical: 6,
    borderRadius: Radius.pill,
    backgroundColor: '#E3F2FC',
  },
  chipText: { fontFamily: Fonts.medium, fontSize: 13, color: Colors.navy },
  description: { fontFamily: Fonts.regular, fontSize: 14, lineHeight: 22, color: Colors.textMuted },

  sectionTitle: { fontFamily: Fonts.bold, fontSize: 17, color: Colors.navy },
  prices: { flexDirection: 'row', gap: Spacing.md },
  priceCard: {
    flex: 1,
    padding: Spacing.md,
    gap: 2,
    borderRadius: Radius.lg,
    backgroundColor: Colors.white,
    borderWidth: 1.5,
    borderColor: Colors.border,
  },
  priceCardSelected: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  priceDuration: { fontFamily: Fonts.medium, fontSize: 13, color: Colors.textMuted },
  priceValue: { fontFamily: Fonts.bold, fontSize: 18, color: Colors.primary },
  note: { fontFamily: Fonts.regular, fontSize: 12, color: Colors.textMuted },

  card: {
    padding: Spacing.md,
    gap: Spacing.sm + 4,
    borderRadius: Radius.lg,
    backgroundColor: Colors.white,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  featureRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  check: {
    width: 22,
    height: 22,
    borderRadius: Radius.pill,
    backgroundColor: Colors.successBg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  featureText: { fontFamily: Fonts.regular, fontSize: 14, color: Colors.text },

  bottomBar: { backgroundColor: Colors.white, borderTopWidth: 1, borderTopColor: Colors.border },
  bottomInner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.sm + 4,
  },
  bottomLabel: { fontFamily: Fonts.regular, fontSize: 12, color: Colors.textMuted },
  bottomPrice: { fontFamily: Fonts.bold, fontSize: 16, color: Colors.navy },
});

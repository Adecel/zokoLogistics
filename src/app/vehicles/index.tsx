import Ionicons from '@expo/vector-icons/Ionicons';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { FlatList, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LoadError, Loading } from '../../components/load-state';
import { VehicleImage } from '../../components/vehicle-image';
import { formatShortDate, fromISODate } from '../../constants/dates';
import { TRANSMISSION_LABELS, formatPrice } from '../../constants/vehicles';
import { Colors, Fonts, Radius, Spacing } from '../../constants/zoko';
import { useCatalog, type CatalogVehicle } from '../../lib/catalog';
import { useSettings } from '../../lib/settings';

type Params = { date?: string; duration?: string; place?: string };

export default function CatalogueScreen() {
  const params = useLocalSearchParams<Params>();
  const date = fromISODate(params.date);
  const duration = Number(params.duration) || undefined;
  const { settings } = useSettings();
  const currency = settings?.currency_label;
  const place = params.place?.trim();

  const { vehicles, error, loading, reload } = useCatalog();
  const [filter, setFilter] = useState('all');

  // Exact availability for a time slot is checked on the reservation screen (available_models)
  const all = vehicles ?? [];
  const list = filter === 'all' ? all : all.filter((v) => v.id === filter);
  const filters = [{ id: 'all', label: 'Tous' }, ...all.map((v) => ({ id: v.id, label: v.name }))];

  const openVehicle = (v: CatalogVehicle) =>
    router.push({
      pathname: '/vehicles/[id]',
      params: {
        id: v.id,
        ...(params.date && { date: params.date }),
        ...(duration && { duration: String(duration) }),
        ...(place && { place }),
      },
    });

  return (
    <SafeAreaView style={styles.flex} edges={['top']}>
      <View style={styles.inner}>
        {/* Header */}
        <View style={styles.header}>
          <Pressable
            onPress={() => (router.canGoBack() ? router.back() : router.replace('/home'))}
            style={styles.back}
            hitSlop={10}
            accessibilityLabel="Retour"
          >
            <Ionicons name="chevron-back" size={22} color={Colors.text} />
          </Pressable>
          <View style={styles.flexShrink}>
            <Text style={styles.title}>Catalogue des véhicules</Text>
            <View style={styles.cityRow}>
              <Ionicons name="location" size={13} color={Colors.primary} />
              <Text style={styles.city}>{settings?.city}</Text>
            </View>
          </View>
        </View>

        {/* Search summary (when coming from the home search) */}
        {(date || duration || place) && (
          <Pressable style={styles.summary} onPress={() => router.back()}>
            <Ionicons name="calendar-outline" size={18} color={Colors.primary} />
            <Text style={styles.summaryText} numberOfLines={1}>
              {[date && formatShortDate(date), duration && `${duration} h`, place].filter(Boolean).join(' · ')}
            </Text>
            <Text style={styles.summaryEdit}>Modifier</Text>
          </Pressable>
        )}

        {/* Filters */}
        {vehicles && (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.filters}
            style={styles.filtersBar}
          >
            {filters.map((f) => {
              const selected = f.id === filter;
              return (
                <Pressable
                  key={f.id}
                  onPress={() => setFilter(f.id)}
                  style={[styles.chip, selected && styles.chipSelected]}
                  accessibilityState={{ selected }}
                >
                  <Text style={[styles.chipText, selected && styles.chipTextSelected]}>{f.label}</Text>
                </Pressable>
              );
            })}
          </ScrollView>
        )}
      </View>

      {loading && <Loading label="Chargement des véhicules…" />}
      {error && <LoadError message={error} onRetry={reload} />}

      {/* List */}
      {vehicles && (
        <FlatList
          data={list}
          keyExtractor={(v) => v.id}
          contentContainerStyle={[styles.inner, styles.list]}
          showsVerticalScrollIndicator={false}
          ListHeaderComponent={
            <Text style={styles.count}>
              {list.length} véhicule{list.length > 1 ? 's' : ''} disponible{list.length > 1 ? 's' : ''}
            </Text>
          }
          ListEmptyComponent={<LoadError message="Aucun véhicule pour le moment." />}
          renderItem={({ item }) => (
            <VehicleCard vehicle={item} highlight={duration} currency={currency} onPress={() => openVehicle(item)} />
          )}
        />
      )}
    </SafeAreaView>
  );
}

type CardProps = { vehicle: CatalogVehicle; highlight?: number; currency?: string; onPress: () => void };

function VehicleCard({ vehicle, highlight, currency, onPress }: CardProps) {
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.card, pressed && { opacity: 0.9 }]}>
      <VehicleImage uri={vehicle.photos[0]} size={52} style={styles.cardImage} />
      <View style={styles.cardBody}>
        <Text style={styles.cardName}>
          {vehicle.brand} {vehicle.name}
        </Text>
        <View style={styles.metaRow}>
          <View style={styles.meta}>
            <Ionicons name="people-outline" size={14} color={Colors.textMuted} />
            <Text style={styles.metaText}>{vehicle.seats} places</Text>
          </View>
          <View style={styles.meta}>
            <Ionicons name="cog-outline" size={14} color={Colors.textMuted} />
            <Text style={styles.metaText}>{TRANSMISSION_LABELS[vehicle.transmission]}</Text>
          </View>
        </View>
        <View style={styles.prices}>
          {vehicle.durations.map((d) => {
            const active = highlight === d;
            return (
              <View key={d} style={[styles.price, active && styles.priceActive]}>
                <Text style={[styles.priceValue, active && styles.priceValueActive]}>
                  {formatPrice(vehicle.prices[d], currency)}
                </Text>
                <Text style={[styles.priceUnit, active && styles.priceUnitActive]}>/ {d} h</Text>
              </View>
            );
          })}
        </View>
      </View>
      <Ionicons name="chevron-forward" size={20} color={Colors.textMuted} style={styles.chevron} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: Colors.background },
  flexShrink: { flexShrink: 1 },
  inner: { width: '100%', maxWidth: 520, alignSelf: 'center', paddingHorizontal: Spacing.lg },

  header: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, paddingTop: Spacing.md },
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
  title: { fontFamily: Fonts.bold, fontSize: 20, color: Colors.navy },
  cityRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  city: { fontFamily: Fonts.medium, fontSize: 13, color: Colors.primary },

  summary: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    marginTop: Spacing.md,
    paddingHorizontal: Spacing.md,
    height: 46,
    borderRadius: Radius.md,
    backgroundColor: '#E3F2FC',
  },
  summaryText: { flex: 1, fontFamily: Fonts.medium, fontSize: 13, color: Colors.navy },
  summaryEdit: { fontFamily: Fonts.semibold, fontSize: 13, color: Colors.primary },

  filtersBar: { flexGrow: 0, marginTop: Spacing.md },
  filters: { gap: Spacing.sm },
  chip: {
    paddingHorizontal: Spacing.md,
    height: 36,
    borderRadius: Radius.pill,
    borderWidth: 1.5,
    borderColor: Colors.border,
    backgroundColor: Colors.white,
    justifyContent: 'center',
  },
  chipSelected: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  chipText: { fontFamily: Fonts.medium, fontSize: 13, color: Colors.text },
  chipTextSelected: { color: Colors.white },

  list: { paddingTop: Spacing.md, paddingBottom: Spacing.xl, gap: Spacing.md },
  count: { fontFamily: Fonts.regular, fontSize: 13, color: Colors.textMuted },

  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    padding: Spacing.sm + 4,
    borderRadius: Radius.lg,
    backgroundColor: Colors.white,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  cardImage: { width: 104, height: 96 },
  cardBody: { flex: 1, gap: 4 },
  cardName: { fontFamily: Fonts.semibold, fontSize: 16, color: Colors.text },
  metaRow: { flexDirection: 'row', flexWrap: 'wrap', columnGap: Spacing.md, rowGap: 2 },
  meta: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  metaText: { fontFamily: Fonts.regular, fontSize: 12, color: Colors.textMuted },
  prices: { gap: 2, marginTop: 4 },
  price: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 4,
    alignSelf: 'flex-start',
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: Radius.sm,
  },
  priceActive: { backgroundColor: Colors.primary },
  priceValue: { fontFamily: Fonts.bold, fontSize: 14, color: Colors.primary },
  priceValueActive: { color: Colors.white },
  priceUnit: { fontFamily: Fonts.regular, fontSize: 12, color: Colors.textMuted },
  priceUnitActive: { color: '#D6ECFA' },
  chevron: { alignSelf: 'center' },
});

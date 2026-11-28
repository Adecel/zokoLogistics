import Ionicons from '@expo/vector-icons/Ionicons';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { FlatList, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LoadError, Loading } from '../../components/load-state';
import { VehicleImage } from '../../components/vehicle-image';
import { ZokoButton } from '../../components/zoko-button';
import { formatBusinessDateTime } from '../../constants/dates';
import { formatPrice } from '../../constants/vehicles';
import { Colors, Fonts, Radius, Spacing } from '../../constants/zoko';
import { useAuth } from '../../lib/auth';
import { useCatalog } from '../../lib/catalog';
import { routeLabel } from '../../lib/rides';
import { useSettings } from '../../lib/settings';
import { supabase } from '../../lib/supabase';

type Status = 'pending' | 'confirmed' | 'in_progress' | 'completed' | 'cancelled' | 'rejected' | 'no_show';

type Item = {
  id: string;
  reference: string;
  status: Status;
  start_at: string;
  duration_hours: number;
  model_id: string;
  model_name: string;
  pickup_address: string;
  amount_due: number;
  balance: number;
  kind: 'rental' | 'ride';
  from_zone_name: string | null;
  to_zone_name: string | null;
};

type Filter = 'all' | 'active' | 'past' | 'cancelled';

const FILTERS: { key: Filter; label: string; statuses: Status[] | null }[] = [
  { key: 'all', label: 'Toutes', statuses: null },
  { key: 'active', label: 'En cours', statuses: ['pending', 'confirmed', 'in_progress'] },
  { key: 'past', label: 'Passées', statuses: ['completed', 'no_show'] },
  { key: 'cancelled', label: 'Annulées', statuses: ['cancelled', 'rejected'] },
];

const STATUS_BADGE: Record<Status, { label: string; color: string; bg: string }> = {
  pending: { label: 'En attente', color: Colors.warning, bg: Colors.warningBg },
  confirmed: { label: 'Confirmée', color: Colors.success, bg: Colors.successBg },
  in_progress: { label: 'En cours', color: Colors.primary, bg: '#E3F2FC' },
  completed: { label: 'Terminée', color: Colors.textMuted, bg: '#EEF1F5' },
  cancelled: { label: 'Annulée', color: Colors.danger, bg: '#FDECEC' },
  rejected: { label: 'Refusée', color: Colors.danger, bg: '#FDECEC' },
  no_show: { label: 'Absent', color: Colors.danger, bg: '#FDECEC' },
};

export default function ReservationsScreen() {
  const { session } = useAuth();
  const { settings } = useSettings();
  const { vehicles } = useCatalog();
  const [items, setItems] = useState<Item[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>('all');
  const [refreshing, setRefreshing] = useState(false);
  const userId = session?.user.id;

  const load = useCallback(async () => {
    if (!userId) return;
    const { data, error: err } = await supabase
      .from('reservation_details')
      .select('id, reference, status, start_at, duration_hours, model_id, model_name, pickup_address, amount_due, balance, kind, from_zone_name, to_zone_name')
      .eq('client_id', userId) // staff accounts can read everyone's: keep only mine
      .order('start_at', { ascending: false });
    if (err) {
      setError('Impossible de charger vos réservations. Vérifiez votre connexion.');
      return;
    }
    setError(null);
    setItems(data as Item[]);
  }, [userId]);

  // Reload each time the tab is shown (new booking, status changed by an agent...)
  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  async function refresh() {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }

  const counts = Object.fromEntries(
    FILTERS.map((f) => [f.key, items?.filter((i) => !f.statuses || f.statuses.includes(i.status)).length ?? 0]),
  ) as Record<Filter, number>;
  const current = FILTERS.find((f) => f.key === filter)!;
  const list = items?.filter((i) => !current.statuses || current.statuses.includes(i.status)) ?? [];
  const currency = settings?.currency_label;
  const offset = settings?.utc_offset ?? '+01:00';

  return (
    <SafeAreaView style={styles.flex} edges={['top']}>
      <View style={styles.inner}>
        <Text style={styles.title}>Mes réservations</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filters} style={styles.filtersBar}>
          {FILTERS.map((f) => {
            const selected = f.key === filter;
            return (
              <Pressable
                key={f.key}
                onPress={() => setFilter(f.key)}
                style={[styles.chip, selected && styles.chipSelected]}
                accessibilityState={{ selected }}
              >
                <Text style={[styles.chipText, selected && styles.chipTextSelected]}>
                  {f.label}
                  {items ? ` (${counts[f.key]})` : ''}
                </Text>
              </Pressable>
            );
          })}
        </ScrollView>
      </View>

      {!items && !error && <Loading label="Chargement de vos réservations…" />}
      {error && !items && <LoadError message={error} onRetry={load} />}

      {items && (
        <FlatList
          data={list}
          keyExtractor={(i) => i.id}
          contentContainerStyle={[styles.inner, styles.list]}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={Colors.primary} />}
          ListEmptyComponent={
            <View style={styles.empty}>
              <Ionicons name="calendar-outline" size={44} color={Colors.textMuted} />
              <Text style={styles.emptyText}>
                {items.length === 0 ? 'Vous n’avez pas encore de réservation.' : 'Aucune réservation dans cette catégorie.'}
              </Text>
              {items.length === 0 && (
                <View style={styles.emptyAction}>
                  <ZokoButton title="Réserver un véhicule" onPress={() => router.push('/vehicles')} />
                </View>
              )}
            </View>
          }
          renderItem={({ item }) => {
            const badge = STATUS_BADGE[item.status];
            const photo = vehicles?.find((v) => v.id === item.model_id)?.photos[0];
            const ride = item.kind === 'ride';
            const toPay = !ride && item.balance > 0 && ['pending', 'confirmed'].includes(item.status);
            return (
              <Pressable
                onPress={() => router.push({ pathname: '/reservation/[id]', params: { id: item.id } })}
                style={({ pressed }) => [styles.card, pressed && { opacity: 0.9 }]}
              >
                <VehicleImage uri={photo} size={32} style={styles.cardImage} />
                <View style={styles.cardBody}>
                  <View style={styles.cardTop}>
                    <Text style={styles.cardName} numberOfLines={1}>
                      {item.model_name}
                    </Text>
                    <View style={[styles.badge, { backgroundColor: badge.bg }]}>
                      <Text style={[styles.badgeText, { color: badge.color }]}>{badge.label}</Text>
                    </View>
                  </View>
                  <Text style={styles.meta}>
                    {ride
                      ? `Course · ${routeLabel(item.from_zone_name, item.to_zone_name)} · ${formatBusinessDateTime(item.start_at, offset)}`
                      : `${formatBusinessDateTime(item.start_at, offset)} · ${item.duration_hours} h`}
                  </Text>
                  <View style={styles.cardBottom}>
                    <Text style={styles.price}>{formatPrice(item.amount_due, currency)}</Text>
                    {toPay ? (
                      <Text style={styles.toPay}>Reste {formatPrice(item.balance, currency)}</Text>
                    ) : (
                      <Text style={styles.reference}>{item.reference}</Text>
                    )}
                  </View>
                </View>
              </Pressable>
            );
          }}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: Colors.background },
  inner: { width: '100%', maxWidth: 520, alignSelf: 'center', paddingHorizontal: Spacing.lg },
  title: { fontFamily: Fonts.bold, fontSize: 22, color: Colors.navy, paddingTop: Spacing.md },

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

  list: { paddingTop: Spacing.md, paddingBottom: Spacing.xl, gap: Spacing.md, flexGrow: 1 },
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
  cardImage: { width: 84, height: 72 },
  cardBody: { flex: 1, gap: 2 },
  cardTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.sm },
  cardName: { flex: 1, fontFamily: Fonts.semibold, fontSize: 15, color: Colors.text },
  badge: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: Radius.pill },
  badgeText: { fontFamily: Fonts.semibold, fontSize: 11 },
  meta: { fontFamily: Fonts.regular, fontSize: 12, color: Colors.textMuted },
  cardBottom: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 2 },
  price: { fontFamily: Fonts.bold, fontSize: 14, color: Colors.primary },
  toPay: { fontFamily: Fonts.semibold, fontSize: 12, color: Colors.warning },
  reference: { fontFamily: Fonts.regular, fontSize: 11, color: Colors.textMuted },

  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: Spacing.sm, paddingVertical: Spacing.xl },
  emptyText: { fontFamily: Fonts.regular, fontSize: 14, color: Colors.textMuted, textAlign: 'center' },
  emptyAction: { alignSelf: 'stretch', marginTop: Spacing.sm },
});

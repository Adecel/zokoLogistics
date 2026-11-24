import Ionicons from '@expo/vector-icons/Ionicons';
import { router } from 'expo-router';
import { useState, type ComponentProps } from 'react';
import { FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LoadError, Loading } from '../../components/load-state';
import { businessToday, formatBusinessDateTime, offsetMinutes } from '../../constants/dates';
import { Colors, Fonts, Radius, Spacing } from '../../constants/zoko';
import { useNotifications, type AppNotification, type NotificationType } from '../../lib/notifications';
import { useSettings } from '../../lib/settings';

type IconName = ComponentProps<typeof Ionicons>['name'];

const LOOK: Record<NotificationType, { icon: IconName; color: string; bg: string }> = {
  reservation_created: { icon: 'calendar', color: Colors.primary, bg: '#E3F2FC' },
  reservation_confirmed: { icon: 'checkmark-circle', color: Colors.success, bg: Colors.successBg },
  reservation_rejected: { icon: 'close-circle', color: Colors.danger, bg: '#FDECEC' },
  reservation_cancelled: { icon: 'close-circle', color: Colors.danger, bg: '#FDECEC' },
  reservation_updated: { icon: 'create', color: Colors.warning, bg: Colors.warningBg },
  payment_received: { icon: 'wallet', color: Colors.success, bg: Colors.successBg },
  payment_refunded: { icon: 'return-down-back', color: Colors.primary, bg: '#E3F2FC' },
  rental_reminder: { icon: 'alarm', color: Colors.warning, bg: Colors.warningBg },
  rental_started: { icon: 'car-sport', color: Colors.primary, bg: '#E3F2FC' },
  rental_ended: { icon: 'flag', color: Colors.textMuted, bg: '#EEF1F5' },
  promotion: { icon: 'gift', color: '#8B5CF6', bg: '#F1EBFE' },
  other: { icon: 'notifications', color: Colors.navy, bg: '#E6EBF2' },
};

export default function NotificationsScreen() {
  const { items, unread, error, reload, markRead, markAllRead } = useNotifications();
  const { settings } = useSettings();
  const offset = settings?.utc_offset ?? '+01:00';
  const [refreshing, setRefreshing] = useState(false);

  async function refresh() {
    setRefreshing(true);
    await reload();
    setRefreshing(false);
  }

  function open(n: AppNotification) {
    markRead(n.id);
    if (n.reservation_id) router.push({ pathname: '/reservation/[id]', params: { id: n.reservation_id } });
  }

  return (
    <SafeAreaView style={styles.flex} edges={['top']}>
      <View style={[styles.inner, styles.header]}>
        <Text style={styles.title}>Notifications</Text>
        {unread > 0 && (
          <Pressable onPress={markAllRead} hitSlop={8}>
            <Text style={styles.markAll}>Tout marquer comme lu</Text>
          </Pressable>
        )}
      </View>

      {!items && !error && <Loading label="Chargement des notifications…" />}
      {!items && error && <LoadError message={error} onRetry={reload} />}

      {items && (
        <FlatList
          data={items}
          keyExtractor={(n) => n.id}
          contentContainerStyle={[styles.inner, styles.list]}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={Colors.primary} />}
          ListEmptyComponent={
            <View style={styles.empty}>
              <Ionicons name="notifications-off-outline" size={44} color={Colors.textMuted} />
              <Text style={styles.emptyText}>
                Aucune notification pour le moment. Vous serez prévenu ici à chaque étape de vos réservations.
              </Text>
            </View>
          }
          renderItem={({ item }) => {
            const look = LOOK[item.type] ?? LOOK.other;
            const isUnread = !item.read_at;
            return (
              <Pressable
                onPress={() => open(item)}
                style={({ pressed }) => [styles.card, isUnread && styles.cardUnread, pressed && { opacity: 0.85 }]}
              >
                <View style={[styles.icon, { backgroundColor: look.bg }]}>
                  <Ionicons name={look.icon} size={20} color={look.color} />
                </View>
                <View style={styles.body}>
                  <View style={styles.titleRow}>
                    <Text style={[styles.itemTitle, isUnread && styles.itemTitleUnread]} numberOfLines={2}>
                      {item.title}
                    </Text>
                    {isUnread && <View style={styles.dot} />}
                  </View>
                  {item.body ? (
                    <Text style={styles.itemBody} numberOfLines={3}>
                      {item.body}
                    </Text>
                  ) : null}
                  <Text style={styles.date}>{relativeDate(item.created_at, offset)}</Text>
                </View>
              </Pressable>
            );
          }}
        />
      )}
    </SafeAreaView>
  );
}

// "À l'instant", "Il y a 5 min", "Aujourd'hui à 14:02", "Hier à 09:15", or the full date
function relativeDate(iso: string, offset: string) {
  const minutes = Math.floor((Date.now() - new Date(iso).getTime()) / 60_000);
  if (minutes < 1) return 'À l’instant';
  if (minutes < 60) return `Il y a ${minutes} min`;
  const full = formatBusinessDateTime(iso, offset);
  const time = full.slice(full.lastIndexOf(' ') + 1);
  const shifted = new Date(new Date(iso).getTime() + offsetMinutes(offset) * 60_000);
  const day = new Date(shifted.getUTCFullYear(), shifted.getUTCMonth(), shifted.getUTCDate());
  const diff = Math.round((businessToday(offset).getTime() - day.getTime()) / 86_400_000);
  if (diff === 0) return `Aujourd’hui à ${time}`;
  if (diff === 1) return `Hier à ${time}`;
  return full;
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: Colors.background },
  inner: { width: '100%', maxWidth: 520, alignSelf: 'center', paddingHorizontal: Spacing.lg },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingTop: Spacing.md },
  title: { fontFamily: Fonts.bold, fontSize: 22, color: Colors.navy },
  markAll: { fontFamily: Fonts.semibold, fontSize: 13, color: Colors.primary },

  list: { paddingTop: Spacing.md, paddingBottom: Spacing.xl, gap: Spacing.sm + 2, flexGrow: 1 },
  card: {
    flexDirection: 'row',
    gap: Spacing.md,
    padding: Spacing.md,
    borderRadius: Radius.lg,
    backgroundColor: Colors.white,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  cardUnread: { backgroundColor: '#F2F9FE', borderColor: '#CDE6F8' },
  icon: { width: 40, height: 40, borderRadius: Radius.pill, alignItems: 'center', justifyContent: 'center' },
  body: { flex: 1, gap: 2 },
  titleRow: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.sm },
  itemTitle: { flex: 1, fontFamily: Fonts.medium, fontSize: 14, color: Colors.text },
  itemTitleUnread: { fontFamily: Fonts.semibold, color: Colors.navy },
  dot: { width: 8, height: 8, borderRadius: Radius.pill, backgroundColor: Colors.primary, marginTop: 6 },
  itemBody: { fontFamily: Fonts.regular, fontSize: 13, lineHeight: 19, color: Colors.textMuted },
  date: { fontFamily: Fonts.regular, fontSize: 11, color: Colors.textMuted, marginTop: 2 },

  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: Spacing.sm, paddingVertical: Spacing.xl },
  emptyText: { fontFamily: Fonts.regular, fontSize: 14, lineHeight: 21, color: Colors.textMuted, textAlign: 'center' },
});

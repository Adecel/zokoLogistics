import Ionicons from '@expo/vector-icons/Ionicons';
import { LinearGradient } from 'expo-linear-gradient';
import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LoadError, Loading } from '../../components/load-state';
import { DayPicker, Segmented } from '../../components/pickers';
import { VehicleImage } from '../../components/vehicle-image';
import { ZokoButton } from '../../components/zoko-button';
import { ZokoInput } from '../../components/zoko-input';
import { bookableDays, toISODate } from '../../constants/dates';
import { TRANSMISSION_LABELS, formatPrice } from '../../constants/vehicles';
import { Colors, Fonts, Radius, Spacing } from '../../constants/zoko';
import { useAuth } from '../../lib/auth';
import { useNotifications } from '../../lib/notifications';
import { allDurations, useCatalog } from '../../lib/catalog';
import { useSettings, type Settings } from '../../lib/settings';

export default function HomeScreen() {
  const { profile } = useAuth();
  const { settings, error: settingsError, reload: reloadSettings } = useSettings();
  const firstName = profile?.full_name.split(' ')[0] ?? '';
  const { unread } = useNotifications();

  return (
    <View style={styles.flex}>
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
        {/* Blue header */}
        <LinearGradient colors={[Colors.primary, Colors.primaryDark]} style={styles.headerBg}>
          <SafeAreaView edges={['top']}>
            <View style={[styles.inner, styles.header]}>
              <View style={styles.flexShrink}>
                <Text style={styles.hello}>Bonjour{firstName ? `, ${firstName}` : ''} 👋</Text>
                {settings?.home_subtitle ? <Text style={styles.helloSub}>{settings.home_subtitle}</Text> : null}
              </View>
              <View style={styles.headerButtons}>
                <Pressable
                  style={styles.profileButton}
                  onPress={() => router.navigate('/notifications')}
                  accessibilityLabel={`Notifications${unread ? `, ${unread} non lues` : ''}`}
                  hitSlop={8}
                >
                  <Ionicons name="notifications-outline" size={22} color={Colors.white} />
                  {unread > 0 && (
                    <View style={styles.badge}>
                      <Text style={styles.badgeText}>{unread > 9 ? '9+' : unread}</Text>
                    </View>
                  )}
                </Pressable>
                <Pressable
                  style={styles.profileButton}
                  onPress={() => router.navigate('/profile')}
                  accessibilityLabel="Mon profil"
                  hitSlop={8}
                >
                  <Ionicons name="person-outline" size={22} color={Colors.white} />
                </Pressable>
              </View>
            </View>
          </SafeAreaView>
        </LinearGradient>

        <View style={[styles.inner, styles.body]}>
          {settings ? (
            <HomeContent settings={settings} />
          ) : (
            <View style={styles.card}>
              {settingsError ? <LoadError message={settingsError} onRetry={reloadSettings} /> : <Loading />}
            </View>
          )}
        </View>
      </ScrollView>
    </View>
  );
}

function HomeContent({ settings }: { settings: Settings }) {
  const { vehicles, error, loading, reload } = useCatalog();
  const days = bookableDays(settings.utc_offset, settings.min_days_ahead, settings.max_days_ahead);
  const durations = vehicles ? allDurations(vehicles) : [];

  const [date, setDate] = useState(days[0] ? toISODate(days[0]) : '');
  const [chosenDuration, setDuration] = useState<number | null>(null);
  const duration = chosenDuration ?? durations[0];
  const [place, setPlace] = useState('');
  const [placeError, setPlaceError] = useState('');

  function handleSearch() {
    if (!place.trim()) {
      setPlaceError('Indiquez le lieu de prise en charge');
      return;
    }
    setPlaceError('');
    router.push({
      pathname: '/vehicles',
      params: { date, ...(duration && { duration: String(duration) }), place: place.trim() },
    });
  }

  const minDaysLabel =
    settings.min_days_ahead === 1
      ? 'Réservation au moins un jour à l’avance'
      : `Réservation au moins ${settings.min_days_ahead} jours à l’avance`;

  return (
    <>
      {/* Banner: app_settings.home_banner */}
      {settings.home_banner.title ? (
        <LinearGradient colors={[Colors.navy, '#13406F']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.banner}>
          <View style={styles.bannerText}>
            <Text style={styles.bannerTitle}>{settings.home_banner.title}</Text>
            {settings.home_banner.subtitle ? <Text style={styles.bannerSub}>{settings.home_banner.subtitle}</Text> : null}
          </View>
          <Ionicons name="car-sport" size={72} color="#5BC0FF" />
        </LinearGradient>
      ) : null}

      {/* Search */}
      <View style={styles.card}>
        <Text style={styles.cardTitle}>Rechercher un véhicule</Text>

        <View style={styles.field}>
          <Text style={styles.label}>Date</Text>
          <DayPicker days={days} value={date} onChange={setDate} />
          {settings.min_days_ahead > 0 && <Text style={styles.hint}>{minDaysLabel}</Text>}
        </View>

        {durations.length > 0 && (
          <View style={styles.field}>
            <Text style={styles.label}>Durée</Text>
            <Segmented options={durations.map((h) => ({ value: h, label: `${h} h` }))} value={duration} onChange={setDuration} />
          </View>
        )}

        <ZokoInput
          label="Lieu de prise en charge"
          icon="location-outline"
          placeholder="Adresse de votre choix"
          value={place}
          onChangeText={setPlace}
          onSubmitEditing={handleSearch}
          error={placeError}
        />

        <ZokoButton title="Rechercher" onPress={handleSearch} />
      </View>

      {/* Vehicles */}
      <View style={styles.section}>
        <View style={styles.rowBetween}>
          <Text style={styles.sectionTitle}>Nos véhicules</Text>
          <Pressable hitSlop={8} onPress={() => router.push('/vehicles')}>
            <Text style={styles.seeAll}>Voir tout</Text>
          </Pressable>
        </View>
        {loading && <Loading label="Chargement des véhicules…" />}
        {error && <LoadError message={error} onRetry={reload} />}
        {vehicles && (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.vehicles}>
            {vehicles.map((v) => (
              <Pressable
                key={v.id}
                onPress={() =>
                  router.push({
                    pathname: '/vehicles/[id]',
                    params: { id: v.id, date, ...(duration && { duration: String(duration) }) },
                  })
                }
                style={({ pressed }) => [styles.vehicle, pressed && { opacity: 0.85 }]}
              >
                <VehicleImage uri={v.photos[0]} style={styles.vehicleImage} />
                <Text style={styles.vehicleName}>{v.name}</Text>
                <Text style={styles.vehicleMeta}>
                  {v.seats} places · {TRANSMISSION_LABELS[v.transmission]}
                </Text>
                {duration && v.prices[duration] != null && (
                  <Text style={styles.vehiclePrice}>
                    {formatPrice(v.prices[duration], settings.currency_label)}
                    <Text style={styles.vehicleMeta}> / {duration} h</Text>
                  </Text>
                )}
              </Pressable>
            ))}
          </ScrollView>
        )}
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: Colors.background },
  flexShrink: { flexShrink: 1 },
  rowBetween: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.sm },
  scroll: { flexGrow: 1, paddingBottom: Spacing.xl },
  inner: { width: '100%', maxWidth: 520, alignSelf: 'center', paddingHorizontal: Spacing.lg },

  headerBg: { paddingBottom: Spacing.xl + Spacing.lg, borderBottomLeftRadius: Radius.xl, borderBottomRightRadius: Radius.xl },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.md, paddingTop: Spacing.md },
  hello: { fontFamily: Fonts.bold, fontSize: 22, color: Colors.white },
  helloSub: { fontFamily: Fonts.regular, fontSize: 14, color: '#D6ECFA' },
  headerButtons: { flexDirection: 'row', gap: Spacing.sm },
  badge: {
    position: 'absolute',
    top: 4,
    right: 4,
    minWidth: 17,
    height: 17,
    paddingHorizontal: 3,
    borderRadius: Radius.pill,
    backgroundColor: Colors.danger,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeText: { fontFamily: Fonts.semibold, fontSize: 10, lineHeight: 13, color: Colors.white },
  profileButton: {
    width: 44,
    height: 44,
    borderRadius: Radius.pill,
    backgroundColor: 'rgba(255,255,255,0.18)',
    alignItems: 'center',
    justifyContent: 'center',
  },

  body: { marginTop: -(Spacing.xl + Spacing.sm), gap: Spacing.lg },

  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.md,
    padding: Spacing.md + 4,
    borderRadius: Radius.lg,
  },
  bannerText: { flexShrink: 1, gap: 4 },
  bannerTitle: { fontFamily: Fonts.bold, fontSize: 17, lineHeight: 24, color: Colors.white },
  bannerSub: { fontFamily: Fonts.medium, fontSize: 13, color: '#9FD4F7' },

  card: {
    padding: Spacing.md + 4,
    gap: Spacing.md,
    borderRadius: Radius.lg,
    backgroundColor: Colors.white,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  cardTitle: { fontFamily: Fonts.bold, fontSize: 17, color: Colors.navy },
  field: { gap: Spacing.xs },
  label: { fontFamily: Fonts.medium, fontSize: 14, color: Colors.text },
  hint: { fontFamily: Fonts.regular, fontSize: 12, color: Colors.textMuted },

  section: { gap: Spacing.sm },
  sectionTitle: { fontFamily: Fonts.bold, fontSize: 17, color: Colors.navy },
  seeAll: { fontFamily: Fonts.medium, fontSize: 13, color: Colors.primary },
  vehicles: { gap: Spacing.md, paddingVertical: 2 },
  vehicle: {
    width: 160,
    padding: Spacing.sm + 4,
    gap: 2,
    borderRadius: Radius.lg,
    backgroundColor: Colors.white,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  vehicleImage: { height: 90, marginBottom: Spacing.sm },
  vehicleName: { fontFamily: Fonts.semibold, fontSize: 15, color: Colors.text },
  vehicleMeta: { fontFamily: Fonts.regular, fontSize: 12, color: Colors.textMuted },
  vehiclePrice: { fontFamily: Fonts.bold, fontSize: 14, color: Colors.primary, marginTop: 4 },
});

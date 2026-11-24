import Ionicons from '@expo/vector-icons/Ionicons';
import { router, type Href } from 'expo-router';
import type { ComponentProps } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Colors, Fonts, Radius, Spacing } from '../../constants/zoko';
import { useAuth } from '../../lib/auth';

type IconName = ComponentProps<typeof Ionicons>['name'];

const MENU: { icon: IconName; label: string; href: Href }[] = [
  { icon: 'person-outline', label: 'Mes informations', href: '/account/info' },
  { icon: 'card-outline', label: 'Mes moyens de paiement', href: '/account/payment-methods' },
  { icon: 'calendar-outline', label: 'Mes réservations', href: '/reservations' },
  { icon: 'notifications-outline', label: 'Notifications', href: '/notifications' },
  { icon: 'lock-closed-outline', label: 'Mot de passe', href: '/account/password' },
  { icon: 'help-circle-outline', label: 'Aide et support', href: '/account/support' },
];

export default function ProfileScreen() {
  const { profile, session, signOut } = useAuth();
  const initial = profile?.full_name.trim().charAt(0).toUpperCase() ?? '';
  const email = profile?.email ?? session?.user.email ?? '';

  return (
    <SafeAreaView style={styles.flex} edges={['top']}>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.title}>Profil</Text>

        {/* Identity */}
        <Pressable style={styles.identity} onPress={() => router.push('/account/info')}>
          <View style={styles.avatar}>
            <Text style={styles.avatarText}>{initial}</Text>
          </View>
          <View style={styles.identityText}>
            <Text style={styles.name}>{profile?.full_name ?? '…'}</Text>
            <Text style={styles.muted} numberOfLines={1}>
              {email}
            </Text>
            {profile?.phone ? <Text style={styles.muted}>{profile.phone}</Text> : null}
          </View>
        </Pressable>

        {/* Menu */}
        <View style={styles.card}>
          {MENU.map((item, i) => (
            <Pressable
              key={item.label}
              onPress={() => router.push(item.href)}
              style={({ pressed }) => [styles.item, i > 0 && styles.itemBorder, pressed && { opacity: 0.7 }]}
            >
              <View style={styles.itemIcon}>
                <Ionicons name={item.icon} size={20} color={Colors.primary} />
              </View>
              <Text style={styles.itemLabel}>{item.label}</Text>
              <Ionicons name="chevron-forward" size={18} color={Colors.textMuted} />
            </Pressable>
          ))}
        </View>

        {/* Logout */}
        <Pressable onPress={signOut} style={({ pressed }) => [styles.card, styles.logout, pressed && { opacity: 0.7 }]}>
          <Ionicons name="log-out-outline" size={20} color={Colors.danger} />
          <Text style={styles.logoutText}>Se déconnecter</Text>
        </Pressable>

        <Pressable onPress={() => router.push('/account/delete')} style={styles.deleteLink} hitSlop={8}>
          <Text style={styles.deleteText}>Supprimer mon compte</Text>
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: Colors.background },
  content: { width: '100%', maxWidth: 520, alignSelf: 'center', padding: Spacing.lg, gap: Spacing.lg },
  title: { fontFamily: Fonts.bold, fontSize: 22, color: Colors.navy },
  muted: { fontFamily: Fonts.regular, fontSize: 13, color: Colors.textMuted },

  identity: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md },
  identityText: { flex: 1, gap: 1 },
  avatar: {
    width: 68,
    height: 68,
    borderRadius: Radius.pill,
    backgroundColor: Colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: { fontFamily: Fonts.bold, fontSize: 28, color: Colors.white },
  name: { fontFamily: Fonts.bold, fontSize: 19, color: Colors.text },

  card: {
    borderRadius: Radius.lg,
    backgroundColor: Colors.white,
    borderWidth: 1,
    borderColor: Colors.border,
    paddingHorizontal: Spacing.md,
  },
  item: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, paddingVertical: Spacing.md },
  itemBorder: { borderTopWidth: 1, borderTopColor: Colors.border },
  itemIcon: {
    width: 36,
    height: 36,
    borderRadius: Radius.md,
    backgroundColor: '#E3F2FC',
    alignItems: 'center',
    justifyContent: 'center',
  },
  itemLabel: { flex: 1, fontFamily: Fonts.medium, fontSize: 15, color: Colors.text },

  logout: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: Spacing.sm, paddingVertical: Spacing.md },
  logoutText: { fontFamily: Fonts.semibold, fontSize: 15, color: Colors.danger },
  deleteLink: { alignSelf: 'center', paddingVertical: Spacing.xs },
  deleteText: { fontFamily: Fonts.regular, fontSize: 13, color: Colors.textMuted, textDecorationLine: 'underline' },
});

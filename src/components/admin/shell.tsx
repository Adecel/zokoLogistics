import Ionicons from '@expo/vector-icons/Ionicons';
import { router, usePathname, type Href } from 'expo-router';
import { useState, type ReactNode } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Colors, Fonts, Radius, Spacing } from '../../constants/zoko';
import { can, ROLE_LABELS, type Permission } from '../../lib/admin/roles';
import { useAuth } from '../../lib/auth';
import { ZokoLogo } from '../zoko-logo';
import { Avatar, Empty, useIsWide, type IconName } from './ui';

type NavItem = { href: string; label: string; icon: IconName; permission: Permission };

export const NAV: NavItem[] = [
  { href: '/admin', label: 'Tableau de bord', icon: 'grid-outline', permission: 'dashboard' },
  { href: '/admin/reservations', label: 'Réservations', icon: 'calendar-outline', permission: 'reservations' },
  { href: '/admin/payments', label: 'Paiements', icon: 'wallet-outline', permission: 'payments' },
  { href: '/admin/vehicles', label: 'Véhicules', icon: 'car-sport-outline', permission: 'fleet' },
  { href: '/admin/drivers', label: 'Chauffeurs', icon: 'id-card-outline', permission: 'drivers' },
  { href: '/admin/clients', label: 'Clients', icon: 'people-outline', permission: 'clients' },
  { href: '/admin/promotions', label: 'Promotions', icon: 'pricetag-outline', permission: 'promotions' },
  { href: '/admin/reports', label: 'Rapports', icon: 'bar-chart-outline', permission: 'reports' },
  { href: '/admin/team', label: 'Équipe', icon: 'shield-checkmark-outline', permission: 'team' },
  { href: '/admin/settings', label: 'Paramètres', icon: 'settings-outline', permission: 'settings' },
];

function isActive(pathname: string, href: string) {
  return href === '/admin' ? pathname === '/admin' || pathname === '/admin/' : pathname.startsWith(href);
}

export function AdminShell({ children }: { children: ReactNode }) {
  const wide = useIsWide();
  const pathname = usePathname();
  const [menuOpen, setMenuOpen] = useState(false);
  const current = NAV.find((n) => isActive(pathname, n.href));

  if (wide) {
    return (
      <View style={styles.wide}>
        <View style={styles.sidebar}>
          <SidebarContent pathname={pathname} />
        </View>
        <View style={styles.flex1}>{children}</View>
      </View>
    );
  }

  return (
    <SafeAreaView style={styles.flex1} edges={['top']}>
      <View style={styles.topbar}>
        <Pressable onPress={() => setMenuOpen(true)} hitSlop={10} accessibilityLabel="Ouvrir le menu" style={styles.menuButton}>
          <Ionicons name="menu" size={24} color={Colors.navy} />
        </Pressable>
        <Text style={styles.topTitle} numberOfLines={1}>
          {current?.label ?? 'Zoko'}
        </Text>
        <ZokoLogo size={22} />
      </View>
      <View style={styles.flex1}>{children}</View>
      <Modal visible={menuOpen} transparent animationType="fade" onRequestClose={() => setMenuOpen(false)}>
        <View style={styles.drawerWrap}>
          <SafeAreaView style={styles.drawer} edges={['top', 'bottom']}>
            <SidebarContent pathname={pathname} onNavigate={() => setMenuOpen(false)} />
          </SafeAreaView>
          <Pressable style={styles.flex1} onPress={() => setMenuOpen(false)} accessibilityLabel="Fermer le menu" />
        </View>
      </Modal>
    </SafeAreaView>
  );
}

function SidebarContent({ pathname, onNavigate }: { pathname: string; onNavigate?: () => void }) {
  const { profile, signOut } = useAuth();
  const items = NAV.filter((n) => can(profile?.role, n.permission));

  return (
    <View style={styles.flex1}>
      <View style={styles.brand}>
        <ZokoLogo size={30} color={Colors.white} />
        <Text style={styles.brandTag}>Tableau de bord</Text>
      </View>
      <ScrollView contentContainerStyle={styles.nav}>
        {items.map((item) => {
          const active = isActive(pathname, item.href);
          return (
            <Pressable
              key={item.href}
              onPress={() => {
                onNavigate?.();
                router.navigate(item.href as Href);
              }}
              style={({ hovered }: { hovered?: boolean }) => [
                styles.navItem,
                hovered && !active && { backgroundColor: 'rgba(255,255,255,0.06)' },
                active && styles.navItemActive,
              ]}
            >
              <Ionicons name={item.icon} size={19} color={active ? Colors.white : '#9FB3CC'} />
              <Text style={[styles.navText, active && { color: Colors.white }]}>{item.label}</Text>
            </Pressable>
          );
        })}
      </ScrollView>
      <View style={styles.user}>
        <Avatar name={profile?.full_name ?? '?'} size={36} />
        <View style={styles.flex1}>
          <Text style={styles.userName} numberOfLines={1}>
            {profile?.full_name}
          </Text>
          <Text style={styles.userRole}>{profile ? ROLE_LABELS[profile.role] : ''}</Text>
        </View>
        <Pressable onPress={signOut} hitSlop={8} accessibilityLabel="Se déconnecter">
          <Ionicons name="log-out-outline" size={22} color="#9FB3CC" />
        </Pressable>
      </View>
    </View>
  );
}

// Shown instead of a page when the role does not allow it
export function RequirePermission({ permission, children }: { permission: Permission; children: ReactNode }) {
  const { profile } = useAuth();
  if (!can(profile?.role, permission)) {
    return (
      <View style={[styles.flex1, { justifyContent: 'center' }]}>
        <Empty icon="lock-closed-outline" text="Cette section n’est pas accessible avec votre rôle." />
      </View>
    );
  }
  return <>{children}</>;
}

const styles = StyleSheet.create({
  flex1: { flex: 1, minWidth: 0, backgroundColor: Colors.background },
  wide: { flex: 1, flexDirection: 'row' },
  sidebar: { width: 250, backgroundColor: Colors.navy },
  brand: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, padding: Spacing.lg, paddingBottom: Spacing.md },
  brandTag: { fontFamily: Fonts.medium, fontSize: 12, color: '#9FB3CC' },
  nav: { paddingHorizontal: Spacing.sm + 4, gap: 2 },
  navItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm + 4,
    paddingVertical: 10,
    paddingHorizontal: Spacing.sm + 4,
    borderRadius: Radius.md,
  },
  navItemActive: { backgroundColor: Colors.primary },
  navText: { fontFamily: Fonts.medium, fontSize: 14, color: '#C9D6E6' },
  user: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    padding: Spacing.md,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.1)',
    backgroundColor: Colors.navy,
  },
  userName: { fontFamily: Fonts.semibold, fontSize: 13, color: Colors.white },
  userRole: { fontFamily: Fonts.regular, fontSize: 12, color: '#9FB3CC' },

  topbar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    backgroundColor: Colors.white,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  menuButton: { padding: 4 },
  topTitle: { flex: 1, fontFamily: Fonts.semibold, fontSize: 17, color: Colors.navy },
  drawerWrap: { flex: 1, flexDirection: 'row', backgroundColor: 'rgba(11, 37, 69, 0.45)' },
  drawer: { width: 280, backgroundColor: Colors.navy },
});

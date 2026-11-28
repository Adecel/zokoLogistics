import Ionicons from '@expo/vector-icons/Ionicons';
import { Tabs } from 'expo-router/js-tabs';
import type { ComponentProps } from 'react';
import type { ColorValue } from 'react-native';
import { Colors, Fonts } from '../../constants/zoko';
import { NotificationsProvider, useNotifications } from '../../lib/notifications';

type IconName = ComponentProps<typeof Ionicons>['name'];

export const unstable_settings = { initialRouteName: 'home' };

function tabIcon(active: IconName, inactive: IconName) {
  function TabIcon({ focused, color, size }: { focused: boolean; color: ColorValue; size: number }) {
    return <Ionicons name={focused ? active : inactive} size={size} color={color as string} />;
  }
  return TabIcon;
}

export default function TabsLayout() {
  return (
    <NotificationsProvider>
      <AppTabs />
    </NotificationsProvider>
  );
}

function AppTabs() {
  const { unread } = useNotifications();
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: Colors.primary,
        tabBarInactiveTintColor: Colors.textMuted,
        tabBarLabelStyle: { fontFamily: Fonts.medium, fontSize: 11 },
        tabBarStyle: { backgroundColor: Colors.white, borderTopColor: Colors.border },
        sceneStyle: { backgroundColor: Colors.background },
      }}
    >
      <Tabs.Screen name="home" options={{ title: 'Accueil', tabBarIcon: tabIcon('home', 'home-outline') }} />
      <Tabs.Screen name="reservations" options={{ title: 'Réservations', tabBarIcon: tabIcon('calendar', 'calendar-outline') }} />
      <Tabs.Screen name="partner" options={{ title: 'Partenaire', tabBarIcon: tabIcon('car-sport', 'car-sport-outline') }} />
      <Tabs.Screen
        name="notifications"
        options={{
          title: 'Notifications',
          tabBarIcon: tabIcon('notifications', 'notifications-outline'),
          tabBarBadge: unread > 0 ? (unread > 9 ? '9+' : unread) : undefined,
          tabBarBadgeStyle: { backgroundColor: Colors.danger, fontFamily: Fonts.semibold, fontSize: 10 },
        }}
      />
      <Tabs.Screen name="profile" options={{ title: 'Profil', tabBarIcon: tabIcon('person', 'person-outline') }} />
    </Tabs>
  );
}

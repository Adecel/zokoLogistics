import {
    Poppins_400Regular,
    Poppins_500Medium,
    Poppins_600SemiBold,
    Poppins_600SemiBold_Italic,
    Poppins_700Bold,
    Poppins_800ExtraBold_Italic,
    useFonts,
} from '@expo-google-fonts/poppins';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { AuthProvider, useAuth } from '../lib/auth';

export default function RootLayout() {
  const [fontsLoaded] = useFonts({
    Poppins_400Regular,
    Poppins_500Medium,
    Poppins_600SemiBold,
    Poppins_600SemiBold_Italic,
    Poppins_700Bold,
    Poppins_800ExtraBold_Italic,
  });

  if (!fontsLoaded) return null; // wait until the fonts are ready

  return (
    <AuthProvider>
      <StatusBar style="dark" />
      <RootNavigator />
    </AuthProvider>
  );
}

function RootNavigator() {
  const { session, initializing } = useAuth();
  if (initializing) return null; // wait until we know if the user is logged in

  const loggedIn = !!session;
  return (
    <Stack screenOptions={{ headerShown: false }}>
      {/* Welcome: open to everyone. Logged-in users are sent to /home from there,
          so every redirect lands on a real web address (never "/(tabs)") */}
      <Stack.Screen name="index" />

      {/* Team dashboard: has its own login and access rules (admin/_layout.tsx) */}
      <Stack.Screen name="admin" />

      {/* Terms and privacy policy: readable before and after login */}
      <Stack.Screen name="legal/[doc]" />

      {/* Visitors: login, sign-up */}
      <Stack.Protected guard={!loggedIn}>
        <Stack.Screen name="login" />
        <Stack.Screen name="register" />
      </Stack.Protected>

      {/* Logged-in users: the app */}
      <Stack.Protected guard={loggedIn}>
        <Stack.Screen name="(tabs)" />
        <Stack.Screen name="vehicles/index" />
        <Stack.Screen name="vehicles/[id]" />
        <Stack.Screen name="booking/[id]" />
        <Stack.Screen name="ride/index" />
        <Stack.Screen name="payment/[id]" />
        <Stack.Screen name="reservation/[id]" />
        <Stack.Screen name="account/info" />
        <Stack.Screen name="account/password" />
        <Stack.Screen name="account/payment-methods" />
        <Stack.Screen name="account/support" />
        <Stack.Screen name="account/delete" />
      </Stack.Protected>
    </Stack>
  );
}

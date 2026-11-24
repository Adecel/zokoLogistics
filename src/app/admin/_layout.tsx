import { Stack } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Loading } from '../../components/load-state';
import { Colors, Fonts } from '../../constants/zoko';
import { isStaff } from '../../lib/admin/roles';
import { useAuth } from '../../lib/auth';

// Dashboard for the Zoko team, with its own login / sign-up.
//  - not logged in            -> login, register
//  - logged in, not team yet   -> pending (access request waiting for an admin)
//  - team member               -> (dash)
export default function AdminLayout() {
  const { session, profile, signOut } = useAuth();
  const loggedIn = !!session;

  // Logged in but profile still loading
  if (loggedIn && !profile) {
    return (
      <View style={styles.center}>
        <Loading />
        <Pressable onPress={signOut} hitSlop={8}>
          <Text style={styles.link}>Se déconnecter</Text>
        </Pressable>
      </View>
    );
  }

  const staff = loggedIn && isStaff(profile);

  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Protected guard={!loggedIn} redirectTo={staff ? '/admin' : '/admin/pending'}>
        <Stack.Screen name="login" />
        <Stack.Screen name="register" />
      </Stack.Protected>

      <Stack.Protected guard={loggedIn && !staff} redirectTo={loggedIn ? '/admin' : '/admin/login'}>
        <Stack.Screen name="pending" />
      </Stack.Protected>

      <Stack.Protected guard={staff} redirectTo={loggedIn ? '/admin/pending' : '/admin/login'}>
        <Stack.Screen name="(dash)" />
      </Stack.Protected>
    </Stack>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: Colors.background, gap: 12 },
  link: { fontFamily: Fonts.medium, fontSize: 14, color: Colors.primary },
});

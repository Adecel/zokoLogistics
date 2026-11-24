import { Stack } from 'expo-router';
import { AdminShell } from '../../../components/admin/shell';
import { ConfirmProvider } from '../../../components/admin/ui';

// Every dashboard page: sidebar (computer) or menu (phone) around a stack of pages
export default function DashboardLayout() {
  return (
    <ConfirmProvider>
      <AdminShell>
        <Stack screenOptions={{ headerShown: false, animation: 'none' }} />
      </AdminShell>
    </ConfirmProvider>
  );
}

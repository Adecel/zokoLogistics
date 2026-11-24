import { formatDate } from './labels';

export type DriverRow = {
  profile_id: string;
  license_number: string | null;
  license_expires_on: string | null;
  is_available: boolean;
  notes: string | null;
  profile: { full_name: string; phone: string | null; email: string | null; avatar_url: string | null; is_active: boolean } | null;
};

export function licenseState(expires: string | null): { label: string; tone: 'success' | 'warning' | 'danger' | 'neutral' } {
  if (!expires) return { label: 'Permis : date inconnue', tone: 'neutral' };
  const days = (new Date(expires).getTime() - Date.now()) / 86_400_000;
  if (days < 0) return { label: 'Permis expiré', tone: 'danger' };
  if (days < 30) return { label: `Permis expire le ${formatDate(expires)}`, tone: 'warning' };
  return { label: `Permis valide (${formatDate(expires)})`, tone: 'success' };
}

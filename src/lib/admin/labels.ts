import { Colors } from '../../constants/zoko';

export type ReservationStatus =
  | 'pending'
  | 'confirmed'
  | 'in_progress'
  | 'completed'
  | 'cancelled'
  | 'rejected'
  | 'no_show';

export type PaymentStatus = 'pending' | 'succeeded' | 'failed' | 'cancelled';
export type PaymentMethod = 'cash' | 'airtel_money' | 'mtn_mobile_money' | 'bank_transfer';
export type VehicleStatus = 'available' | 'maintenance' | 'out_of_service';

export type Tone = 'neutral' | 'info' | 'success' | 'warning' | 'danger';

export const TONES: Record<Tone, { fg: string; bg: string }> = {
  neutral: { fg: Colors.textMuted, bg: '#EEF2F7' },
  info: { fg: Colors.primaryDark, bg: '#E3F2FC' },
  success: { fg: Colors.success, bg: Colors.successBg },
  warning: { fg: '#B45309', bg: Colors.warningBg },
  danger: { fg: Colors.danger, bg: '#FDECEC' },
};

export const RESERVATION_STATUS: Record<ReservationStatus, { label: string; tone: Tone }> = {
  pending: { label: 'En attente', tone: 'warning' },
  confirmed: { label: 'Confirmée', tone: 'info' },
  in_progress: { label: 'En cours', tone: 'success' },
  completed: { label: 'Terminée', tone: 'neutral' },
  cancelled: { label: 'Annulée', tone: 'danger' },
  rejected: { label: 'Refusée', tone: 'danger' },
  no_show: { label: 'Client absent', tone: 'danger' },
};

export const PAYMENT_STATUS: Record<PaymentStatus, { label: string; tone: Tone }> = {
  pending: { label: 'À vérifier', tone: 'warning' },
  succeeded: { label: 'Validé', tone: 'success' },
  failed: { label: 'Refusé', tone: 'danger' },
  cancelled: { label: 'Annulé', tone: 'neutral' },
};

export const PAYMENT_METHODS: Record<PaymentMethod, string> = {
  cash: 'Espèces',
  airtel_money: 'Airtel Money',
  mtn_mobile_money: 'MTN Mobile Money',
  bank_transfer: 'Virement',
};

export const VEHICLE_STATUS: Record<VehicleStatus, { label: string; tone: Tone }> = {
  available: { label: 'Disponible', tone: 'success' },
  maintenance: { label: 'En entretien', tone: 'warning' },
  out_of_service: { label: 'Hors service', tone: 'danger' },
};

export const CHARGE_TYPES = { overtime: 'Dépassement horaire', fuel: 'Carburant', other: 'Autre' } as const;

// Money state of a reservation, from amount due / paid / balance
export function paymentState(r: { amount_due: number; amount_paid: number; balance: number }): {
  label: string;
  tone: Tone;
} {
  if (r.amount_due > 0 && r.balance <= 0) return { label: 'Payée', tone: 'success' };
  if (r.amount_paid > 0) return { label: 'Paiement partiel', tone: 'warning' };
  return { label: 'Non payée', tone: 'danger' };
}

// Business-time display (Pointe-Noire, UTC+1)
const TZ = 'Africa/Brazzaville';

export function formatDateTime(iso: string | null | undefined) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('fr-FR', {
    timeZone: TZ,
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function formatDate(iso: string | null | undefined) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('fr-FR', { timeZone: TZ, day: '2-digit', month: 'short', year: 'numeric' });
}

export function formatMoney(amount: number | null | undefined) {
  const n = Math.round(amount ?? 0);
  return `${n.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ')} FCFA`;
}

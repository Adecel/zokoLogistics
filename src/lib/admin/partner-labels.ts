import type { Tone } from './labels';

export type AdminPartnerStatus = 'pending' | 'approved' | 'rejected' | 'suspended';

export const PARTNER_LABELS: Record<AdminPartnerStatus, string> = {
  pending: 'À valider',
  approved: 'Validé',
  rejected: 'Refusé',
  suspended: 'Suspendu',
};

export const PARTNER_TONES: Record<AdminPartnerStatus, Tone> = {
  pending: 'warning',
  approved: 'success',
  rejected: 'danger',
  suspended: 'neutral',
};

export const DRIVE_MODE_LABELS = {
  owner: 'Le propriétaire conduit',
  zoko: 'Confié à Zoko',
  either: 'Propriétaire ou Zoko',
} as const;

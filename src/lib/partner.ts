import { supabase } from './supabase';

// Zoko Partenaire: owners who put their vehicle at Zoko's disposal.

export type PartnerStatus = 'pending' | 'approved' | 'rejected' | 'suspended';
export type DriveMode = 'owner' | 'zoko' | 'either';
export type PartnerVehicleStatus = 'pending' | 'approved' | 'rejected';

export type Partner = {
  profile_id: string;
  status: PartnerStatus;
  city: string;
  drives_self: boolean;
  license_number: string | null;
  message: string | null;
  review_note: string | null;
  created_at: string;
};

export type PartnerVehicle = {
  id: string;
  brand: string;
  name: string;
  year: number | null;
  color: string | null;
  plate_number: string;
  seats: number;
  transmission: 'manual' | 'automatic';
  city: string;
  drive_mode: DriveMode;
  photos: string[];
  notes: string | null;
  status: PartnerVehicleStatus;
  review_note: string | null;
  vehicle_id: string | null;
  created_at: string;
};

// The fleet vehicle (once approved): availability and who drives
export type FleetVehicle = {
  id: string;
  plate_number: string;
  status: 'available' | 'maintenance' | 'out_of_service';
  drive_mode: DriveMode;
  available_now: boolean;
  available_now_at: string | null;
};

export type AvailabilitySlot = { id: string; vehicle_id: string; start_at: string; end_at: string; note: string | null };

export type Mission = {
  id: string;
  reference: string;
  kind: 'rental' | 'ride';
  status: 'confirmed' | 'in_progress' | 'completed' | 'cancelled' | 'no_show';
  start_at: string;
  end_at: string;
  vehicle_id: string;
  plate_number: string;
  model_name: string;
  from_zone_name: string | null;
  to_zone_name: string | null;
  pickup_address: string;
  dropoff_address: string | null;
  client_name: string;
  contact_phone: string | null;
  driven_by_owner: boolean;
  with_driver: boolean;
  total_price: number;
  partner_share_pct: number | null;
  partner_amount: number;
};

export const DRIVE_MODES: Record<DriveMode, { label: string; hint: string }> = {
  owner: { label: 'Je conduis moi-même', hint: 'Vous conduisez votre véhicule pour chaque mission.' },
  zoko: { label: 'Je confie à Zoko', hint: 'Un chauffeur Zoko conduit, ou un client avec permis.' },
  either: { label: 'Les deux', hint: 'Zoko choisit selon la mission ; vous pouvez refuser.' },
};

export const PARTNER_STATUS: Record<PartnerStatus, string> = {
  pending: 'En cours de vérification',
  approved: 'Partenaire validé',
  rejected: 'Demande non retenue',
  suspended: 'Compte suspendu',
};

export const VEHICLE_STATUS: Record<PartnerVehicleStatus, string> = {
  pending: 'En vérification',
  approved: 'Validé',
  rejected: 'Non retenu',
};

export const MISSION_STATUS: Record<Mission['status'], string> = {
  confirmed: 'À venir',
  in_progress: 'En cours',
  completed: 'Terminée',
  cancelled: 'Annulée',
  no_show: 'Client absent',
};

export type PartnerSpace = {
  partner: Partner | null;
  vehicles: PartnerVehicle[];
  fleet: FleetVehicle[];
  missions: Mission[];
};

// Everything the Partner tab needs, in one call
export async function loadPartnerSpace(userId: string): Promise<PartnerSpace> {
  const { data: partner, error } = await supabase
    .from('partners')
    .select('profile_id, status, city, drives_self, license_number, message, review_note, created_at')
    .eq('profile_id', userId)
    .maybeSingle();
  if (error) throw new Error('Impossible de charger votre espace partenaire. Vérifiez votre connexion.');
  if (!partner || (partner as Partner).status !== 'approved') {
    return { partner: partner as Partner | null, vehicles: [], fleet: [], missions: [] };
  }
  const [vehicles, fleet, missions] = await Promise.all([
    supabase
      .from('partner_vehicles')
      .select('id, brand, name, year, color, plate_number, seats, transmission, city, drive_mode, photos, notes, status, review_note, vehicle_id, created_at')
      .eq('owner_id', userId)
      .order('created_at', { ascending: false }),
    supabase
      .from('vehicles')
      .select('id, plate_number, status, drive_mode, available_now, available_now_at')
      .eq('owner_id', userId),
    supabase.rpc('partner_missions'),
  ]);
  if (vehicles.error || fleet.error || missions.error) {
    throw new Error('Impossible de charger votre espace partenaire. Vérifiez votre connexion.');
  }
  return {
    partner: partner as Partner,
    vehicles: vehicles.data as PartnerVehicle[],
    fleet: fleet.data as FleetVehicle[],
    missions: missions.data as Mission[],
  };
}

export function dbMessage(error: { code?: string; message: string } | null, fallback: string) {
  if (!error) return fallback;
  if (error.code === 'P0001') return error.message;
  if (error.code === '23505') return 'Ce véhicule (plaque) est déjà enregistré.';
  return fallback;
}

// Sum of the partner's share for missions in the current month (company time zone ignored: close enough for an estimate)
export function monthEarnings(missions: Mission[]) {
  const now = new Date();
  return missions
    .filter((m) => {
      const d = new Date(m.start_at);
      return m.status === 'completed' && d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
    })
    .reduce((sum, m) => sum + m.partner_amount, 0);
}

import { NOT_CONFIGURED } from './catalog';
import { createCachedQuery } from './cached-query';
import { isSupabaseConfigured, supabase } from './supabase';

// Immediate rides: flat price per route "zone A <-> zone B" and per vehicle model.
// Zones are arrondissements or well-known quartiers, managed by the team.

export type RideZone = { id: string; city: string; name: string; district: string | null; position: number };

export type RideQuote = {
  model_id: string;
  price: number;
  ride_minutes: number; // driver pickup + trip
  available_count: number;
  drivers_free: number;
};

async function fetchZones(): Promise<RideZone[]> {
  if (!isSupabaseConfigured) throw new Error(NOT_CONFIGURED);
  // RLS: clients only see active zones
  const { data, error } = await supabase
    .from('ride_zones')
    .select('id, city, name, district, position')
    .eq('is_active', true)
    .order('position')
    .order('name');
  if (error) throw new Error('Impossible de charger les zones. Vérifiez votre connexion.');
  return data as RideZone[];
}

const zones = createCachedQuery(fetchZones);

export function useRideZones() {
  const { data, ...rest } = zones.useQuery();
  return { zones: data, ...rest };
}

export function citiesOf(list: RideZone[]) {
  return [...new Set(list.map((z) => z.city))].sort();
}

export async function fetchRideQuote(from: string, to: string): Promise<RideQuote[]> {
  const { data, error } = await supabase.rpc('ride_quote', { p_from: from, p_to: to });
  if (error) throw new Error('Impossible de calculer le prix. Vérifiez votre connexion.');
  return data as RideQuote[];
}

// "Lumumba → Loandjili"
export function routeLabel(from: string | null | undefined, to: string | null | undefined) {
  return `${from ?? '?'} → ${to ?? '?'}`;
}

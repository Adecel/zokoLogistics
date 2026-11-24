import { createCachedQuery } from './cached-query';
import { isSupabaseConfigured, supabase } from './supabase';

export type CatalogVehicle = {
  id: string;
  brand: string;
  name: string;
  seats: number;
  transmission: 'manual' | 'automatic';
  fuelType: 'petrol' | 'diesel' | 'hybrid' | 'electric';
  features: string[];
  description: string | null;
  prices: Record<number, number>; // hours -> FCFA
  durations: number[]; // hours with a current price, sorted
  photos: string[];
  vehicleCount: number;
};

type Row = {
  id: string;
  brand: string;
  name: string;
  seats: number;
  transmission: CatalogVehicle['transmission'];
  fuel_type: CatalogVehicle['fuelType'];
  features: string[] | null;
  description: string | null;
  prices: Record<string, number> | null;
  photos: string[] | null;
  vehicle_count: number;
};

function toVehicle(r: Row): CatalogVehicle {
  const prices: Record<number, number> = {};
  for (const [hours, price] of Object.entries(r.prices ?? {})) prices[Number(hours)] = price;
  return {
    id: r.id,
    brand: r.brand,
    name: r.name,
    seats: r.seats,
    transmission: r.transmission,
    fuelType: r.fuel_type,
    features: r.features ?? [],
    description: r.description,
    prices,
    durations: Object.keys(prices).map(Number).sort((a, b) => a - b),
    photos: r.photos ?? [],
    vehicleCount: r.vehicle_count,
  };
}

export const NOT_CONFIGURED = "La base de données n'est pas encore configurée (fichier .env.local).";

async function fetchCatalog(): Promise<CatalogVehicle[]> {
  if (!isSupabaseConfigured) throw new Error(NOT_CONFIGURED);
  const { data, error } = await supabase.rpc('vehicle_catalog');
  if (error) throw new Error('Impossible de charger les véhicules. Vérifiez votre connexion.');
  return (data as Row[]).map(toVehicle);
}

const catalog = createCachedQuery(fetchCatalog);

export function useCatalog() {
  const { data, ...rest } = catalog.useQuery();
  return { vehicles: data, ...rest };
}

// All durations offered by at least one vehicle (e.g. [6, 12])
export function allDurations(vehicles: CatalogVehicle[]) {
  return [...new Set(vehicles.flatMap((v) => v.durations))].sort((a, b) => a - b);
}

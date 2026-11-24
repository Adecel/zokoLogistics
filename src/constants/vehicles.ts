// Labels only. Vehicles, prices, durations and rules come from the database
// (src/lib/catalog.ts and src/lib/settings.ts).

export const TRANSMISSION_LABELS = { manual: 'Manuelle', automatic: 'Automatique' } as const;

export const FUEL_LABELS = { petrol: 'Essence', diesel: 'Diesel', hybrid: 'Hybride', electric: 'Électrique' } as const;

// 15000 -> "15 000 FCFA"
export function formatPrice(amount: number, currency = 'FCFA') {
  return `${String(amount).replace(/\B(?=(\d{3})+(?!\d))/g, ' ')} ${currency}`;
}

import { NOT_CONFIGURED } from './catalog';
import { createCachedQuery } from './cached-query';
import { isSupabaseConfigured, supabase } from './supabase';

// Every value here comes from the app_settings table (is_public = true).
// The defaults only fill a key that is missing from the database.
export type Settings = {
  city: string;
  timezone: string;
  utc_offset: string;
  currency_label: string;
  support_phone: string;
  support_whatsapp: string;
  min_days_ahead: number;
  max_days_ahead: number;
  booking_hours: { start: string; end: string; step_minutes: number };
  included_fuel_liters: number;
  free_cancel_until_days_before: number;
  same_day_cancel_refund_pct: number;
  welcome_tagline: string;
  home_subtitle: string;
  home_banner: { title: string; subtitle: string };
  pricing_note: string;
  booking_conditions: string[];
  payment_methods: PaymentMethodSetting[];
  payment_note: string;
  rides_enabled: boolean;
  ride_hours: { start: string; end: string };
  ride_pickup_minutes: number;
  partners_enabled: boolean;
  partner_share_pct_owner_drives: number;
  partner_share_pct_zoko_drives: number;
  partner_fee_note: string;
};

export type PaymentMethodKey = 'cash' | 'airtel_money' | 'mtn_mobile_money' | 'bank_transfer';

export type PaymentMethodSetting = {
  method: PaymentMethodKey;
  label: string;
  enabled: boolean;
  account_name: string;
  account_number: string;
  bank_name?: string;
  instructions: string;
};

const DEFAULTS: Settings = {
  city: '',
  timezone: 'Africa/Brazzaville',
  utc_offset: '+01:00',
  currency_label: 'FCFA',
  support_phone: '',
  support_whatsapp: '',
  min_days_ahead: 1,
  max_days_ahead: 30,
  booking_hours: { start: '06:00', end: '20:00', step_minutes: 30 },
  included_fuel_liters: 0,
  free_cancel_until_days_before: 1,
  same_day_cancel_refund_pct: 0,
  welcome_tagline: '',
  home_subtitle: '',
  home_banner: { title: '', subtitle: '' },
  pricing_note: '',
  booking_conditions: [],
  payment_methods: [],
  payment_note: '',
  rides_enabled: false,
  ride_hours: { start: '06:00', end: '22:00' },
  ride_pickup_minutes: 20,
  partners_enabled: false,
  partner_share_pct_owner_drives: 0,
  partner_share_pct_zoko_drives: 0,
  partner_fee_note: '',
};

async function fetchSettings(): Promise<Settings> {
  if (!isSupabaseConfigured) throw new Error(NOT_CONFIGURED);
  const { data, error } = await supabase.from('app_settings').select('key, value').eq('is_public', true);
  if (error) throw new Error('Impossible de charger les paramètres. Vérifiez votre connexion.');
  const settings: Record<string, unknown> = { ...DEFAULTS };
  for (const row of data as { key: string; value: unknown }[]) settings[row.key] = row.value;
  return settings as Settings;
}

const settings = createCachedQuery(fetchSettings);

export function useSettings() {
  const { data, ...rest } = settings.useQuery();
  return { settings: data, ...rest };
}

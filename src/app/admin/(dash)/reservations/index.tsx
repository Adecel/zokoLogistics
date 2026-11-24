import { router, useLocalSearchParams } from 'expo-router';
import { useMemo, useState } from 'react';
import { Text, View } from 'react-native';
import { RequirePermission } from '../../../../components/admin/shell';
import { Badge, Card, Choice, Empty, ListRow, Page, SearchBox, ui, useIsWide } from '../../../../components/admin/ui';
import { LoadError, Loading } from '../../../../components/load-state';
import {
  formatDateTime,
  formatMoney,
  paymentState,
  RESERVATION_STATUS,
  type ReservationStatus,
} from '../../../../lib/admin/labels';
import { unwrap, useLoad } from '../../../../lib/admin/use-load';
import { supabase } from '../../../../lib/supabase';

type Filter = 'all' | 'pending' | 'confirmed' | 'in_progress' | 'past' | 'cancelled';
type PayFilter = 'all' | 'unpaid' | 'partial' | 'paid';

const FILTERS: { value: Filter; label: string; statuses: ReservationStatus[] | null }[] = [
  { value: 'all', label: 'Toutes', statuses: null },
  { value: 'pending', label: 'En attente', statuses: ['pending'] },
  { value: 'confirmed', label: 'Confirmées', statuses: ['confirmed'] },
  { value: 'in_progress', label: 'En cours', statuses: ['in_progress'] },
  { value: 'past', label: 'Passées', statuses: ['completed'] },
  { value: 'cancelled', label: 'Annulées / refusées', statuses: ['cancelled', 'rejected', 'no_show'] },
];

type Row = {
  id: string;
  reference: string;
  status: ReservationStatus;
  start_at: string;
  duration_hours: number;
  client_name: string;
  client_phone: string | null;
  model_name: string;
  plate_number: string | null;
  driver_name: string | null;
  with_driver: boolean;
  amount_due: number;
  amount_paid: number;
  balance: number;
};

export default function ReservationsScreen() {
  return (
    <RequirePermission permission="reservations">
      <ReservationsList />
    </RequirePermission>
  );
}

function ReservationsList() {
  const params = useLocalSearchParams<{ status?: string }>();
  const wide = useIsWide();
  const [filter, setFilter] = useState<Filter>(
    FILTERS.some((f) => f.value === params.status) ? (params.status as Filter) : 'all',
  );
  const [pay, setPay] = useState<PayFilter>('all');
  const [search, setSearch] = useState('');

  const { data, error, loading, reload } = useLoad(async () => {
    let q = supabase
      .from('reservation_details')
      .select(
        'id, reference, status, start_at, duration_hours, client_name, client_phone, model_name, plate_number, driver_name, with_driver, amount_due, amount_paid, balance',
      )
      .limit(500);
    const statuses = FILTERS.find((f) => f.value === filter)?.statuses;
    if (statuses) q = q.in('status', statuses);
    // Upcoming first for active ones, most recent first for the rest
    const ascending = filter === 'pending' || filter === 'confirmed' || filter === 'in_progress';
    return unwrap(await q.order('start_at', { ascending })) as Row[];
  }, [filter]);

  const rows = useMemo(() => {
    const s = search.trim().toLowerCase();
    return (data ?? []).filter((r) => {
      if (s && ![r.reference, r.client_name, r.client_phone ?? '', r.plate_number ?? ''].some((v) => v.toLowerCase().includes(s))) {
        return false;
      }
      if (pay === 'all') return true;
      const state = paymentState(r).label;
      return (
        (pay === 'paid' && state === 'Payée') ||
        (pay === 'partial' && state === 'Paiement partiel') ||
        (pay === 'unpaid' && state === 'Non payée')
      );
    });
  }, [data, search, pay]);

  const totalDue = rows.reduce((sum, r) => sum + Math.max(0, r.balance), 0);

  return (
    <Page title="Réservations" subtitle="Toutes les réservations des clients" onRefresh={reload} refreshing={false}>
      <Card>
        <Choice options={FILTERS.map((f) => ({ value: f.value, label: f.label }))} value={filter} onChange={setFilter} />
        <View style={ui.wrap}>
          <SearchBox value={search} onChangeText={setSearch} placeholder="Référence, client, téléphone, plaque…" />
        </View>
        <Choice
          label="Paiement"
          options={[
            { value: 'all', label: 'Tous' },
            { value: 'unpaid', label: 'Non payées' },
            { value: 'partial', label: 'Partielles' },
            { value: 'paid', label: 'Payées' },
          ]}
          value={pay}
          onChange={setPay}
        />
      </Card>

      {loading && <Loading />}
      {error && <LoadError message={error} onRetry={reload} />}
      {data && (
        <Card title={`${rows.length} réservation(s)`} actions={<Text style={ui.muted}>Reste à encaisser : {formatMoney(totalDue)}</Text>}>
          {rows.length === 0 && <Empty icon="calendar-outline" text="Aucune réservation pour ces filtres." />}
          {rows.map((r) => {
            const st = RESERVATION_STATUS[r.status];
            const ps = paymentState(r);
            return (
              <ListRow key={r.id} onPress={() => router.push(`/admin/reservations/${r.id}`)}>
                <View style={[ui.flex1, wide && { flexDirection: 'row', alignItems: 'center', gap: 16 }]}>
                  <View style={wide ? { width: 150 } : undefined}>
                    <Text style={ui.strong}>{r.reference}</Text>
                    <Text style={ui.small}>{formatDateTime(r.start_at)}</Text>
                  </View>
                  <View style={wide ? ui.flex1 : undefined}>
                    <Text style={ui.body} numberOfLines={1}>
                      {r.client_name}
                    </Text>
                    <Text style={ui.small} numberOfLines={1}>
                      {r.model_name}
                      {r.plate_number ? ` · ${r.plate_number}` : ''} · {r.duration_hours} h ·{' '}
                      {r.with_driver ? (r.driver_name ?? 'chauffeur à attribuer') : 'sans chauffeur'}
                    </Text>
                  </View>
                  <View style={wide ? { width: 150, alignItems: 'flex-end' } : { marginTop: 4 }}>
                    <Text style={ui.strong}>{formatMoney(r.amount_due)}</Text>
                    {r.balance > 0 ? <Text style={ui.small}>Reste {formatMoney(r.balance)}</Text> : null}
                  </View>
                </View>
                <View style={[ui.gapSm, { alignItems: 'flex-end' }]}>
                  <Badge label={st.label} tone={st.tone} />
                  <Badge label={ps.label} tone={ps.tone} />
                </View>
              </ListRow>
            );
          })}
        </Card>
      )}
    </Page>
  );
}

import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { Text, View } from 'react-native';
import { RequirePermission } from '../../../../components/admin/shell';
import { Avatar, Badge, Card, Choice, Empty, ListRow, Page, SearchBox, ui, useIsWide } from '../../../../components/admin/ui';
import { LoadError, Loading } from '../../../../components/load-state';
import { formatDate, formatMoney } from '../../../../lib/admin/labels';
import { unwrap, useLoad } from '../../../../lib/admin/use-load';
import { can } from '../../../../lib/admin/roles';
import { useAuth } from '../../../../lib/auth';
import { supabase } from '../../../../lib/supabase';

type Client = {
  id: string;
  full_name: string;
  phone: string | null;
  email: string | null;
  is_active: boolean;
  created_at: string;
};

type Stats = {
  client_id: string;
  reservations: number;
  completed_rentals: number;
  cancellations: number;
  total_spent: number;
  last_rental_at: string | null;
};

type Sort = 'recent' | 'name' | 'spent' | 'reservations';

export default function ClientsScreen() {
  return (
    <RequirePermission permission="clients">
      <Clients />
    </RequirePermission>
  );
}

function Clients() {
  const { profile } = useAuth();
  // Reservation counts and amounts: not for the manager
  const seeReservations = can(profile?.role, 'reservations');
  const wide = useIsWide();
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<'all' | 'active' | 'inactive'>('active');
  const [sort, setSort] = useState<Sort>('recent');

  const { data, error, loading, reload } = useLoad(async () => {
    const [clients, stats] = await Promise.all([
      supabase
        .from('profiles')
        .select('id, full_name, phone, email, is_active, created_at')
        .eq('role', 'client')
        .is('requested_role', null)
        .neq('full_name', 'Compte supprimé')
        .then(unwrap),
      seeReservations
        ? supabase.from('report_client_stats').select('client_id, reservations, completed_rentals, cancellations, total_spent, last_rental_at').then(unwrap)
        : Promise.resolve([]),
    ]);
    const byId = new Map((stats as Stats[]).map((s) => [s.client_id, s]));
    return (clients as Client[]).map((c) => ({ ...c, stats: byId.get(c.id) }));
  }, []);

  const rows = useMemo(() => {
    const s = search.trim().toLowerCase();
    const list = (data ?? []).filter(
      (c) =>
        (status === 'all' || (status === 'active' ? c.is_active : !c.is_active)) &&
        (!s || [c.full_name, c.phone, c.email].some((v) => (v ?? '').toLowerCase().includes(s))),
    );
    return list.sort((a, b) => {
      if (sort === 'name') return a.full_name.localeCompare(b.full_name);
      if (sort === 'spent') return (b.stats?.total_spent ?? 0) - (a.stats?.total_spent ?? 0);
      if (sort === 'reservations') return (b.stats?.reservations ?? 0) - (a.stats?.reservations ?? 0);
      return b.created_at.localeCompare(a.created_at);
    });
  }, [data, search, status, sort]);

  return (
    <Page title="Clients" subtitle="Les utilisateurs de l’application Zoko" onRefresh={reload} refreshing={false}>
      <Card>
        <SearchBox value={search} onChangeText={setSearch} placeholder="Nom, téléphone, e-mail…" />
        <View style={[ui.wrap, { alignItems: 'flex-start', gap: 16 }]}>
          <Choice
            label="Statut"
            options={[
              { value: 'active', label: 'Actifs' },
              { value: 'inactive', label: 'Désactivés' },
              { value: 'all', label: 'Tous' },
            ]}
            value={status}
            onChange={setStatus}
          />
          <Choice
            label="Trier par"
            options={[
              { value: 'recent', label: 'Plus récents' },
              { value: 'name', label: 'Nom' },
              ...(seeReservations
                ? [
                    { value: 'reservations' as const, label: 'Réservations' },
                    { value: 'spent' as const, label: 'Montant dépensé' },
                  ]
                : []),
            ]}
            value={sort}
            onChange={setSort}
          />
        </View>
      </Card>
      {loading && <Loading />}
      {error && <LoadError message={error} onRetry={reload} />}
      {data && (
        <Card title={`${rows.length} client(s)`}>
          {rows.length === 0 && <Empty icon="people-outline" text="Aucun client." />}
          {rows.map((c) => (
            <ListRow key={c.id} onPress={() => router.push(`/admin/clients/${c.id}`)}>
              <Avatar name={c.full_name} />
              <View style={[ui.flex1, wide && { flexDirection: 'row', alignItems: 'center', gap: 16 }]}>
                <View style={wide ? ui.flex1 : undefined}>
                  <Text style={ui.strong}>{c.full_name}</Text>
                  <Text style={ui.small} numberOfLines={1}>
                    {c.phone ?? '—'}
                    {c.email ? ` · ${c.email}` : ''}
                  </Text>
                </View>
                <View style={wide ? { width: 220 } : { marginTop: 2 }}>
                  {seeReservations && (
                    <Text style={ui.small}>
                      {c.stats?.reservations ?? 0} réservation(s) · {formatMoney(c.stats?.total_spent ?? 0)}
                    </Text>
                  )}
                  <Text style={ui.small}>Inscrit le {formatDate(c.created_at)}</Text>
                </View>
              </View>
              {!c.is_active && <Badge label="Désactivé" tone="danger" />}
            </ListRow>
          ))}
        </Card>
      )}
    </Page>
  );
}

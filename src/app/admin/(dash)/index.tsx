import { router, type Href } from 'expo-router';
import { Text, View } from 'react-native';
import { Badge, Card, Empty, Grid, ListRow, Page, Stat, ui } from '../../../components/admin/ui';
import { LoadError, Loading } from '../../../components/load-state';
import {
  formatDateTime,
  formatMoney,
  paymentState,
  RESERVATION_STATUS,
  type ReservationStatus,
} from '../../../lib/admin/labels';
import { can } from '../../../lib/admin/roles';
import { unwrap, useLoad } from '../../../lib/admin/use-load';
import { useAuth } from '../../../lib/auth';
import { supabase } from '../../../lib/supabase';

type Stats = {
  pending_reservations: number;
  upcoming_confirmed: number;
  in_progress: number;
  today_departures: number;
  payments_to_verify: number;
  payments_to_verify_amount: number;
  revenue_month: number;
  unpaid_balance: number;
  vehicles_total: number;
  vehicles_available: number;
  drivers_available: number;
  clients_total: number;
  access_requests: number;
};

type Upcoming = {
  id: string;
  reference: string;
  status: ReservationStatus;
  start_at: string;
  duration_hours: number;
  client_name: string;
  model_name: string;
  plate_number: string | null;
  driver_name: string | null;
  with_driver: boolean;
  amount_due: number;
  amount_paid: number;
  balance: number;
};

export default function DashboardHome() {
  const { profile } = useAuth();
  const role = profile?.role;

  const { data, error, reload, loading } = useLoad(async () => {
    const [stats, upcoming] = await Promise.all([
      supabase.rpc('dashboard_stats').then(unwrap),
      supabase
        .from('reservation_details')
        .select(
          'id, reference, status, start_at, duration_hours, client_name, model_name, plate_number, driver_name, with_driver, amount_due, amount_paid, balance',
        )
        .in('status', ['pending', 'confirmed', 'in_progress'])
        .gte('end_at', new Date().toISOString())
        .order('start_at')
        .limit(8)
        .then(unwrap),
    ]);
    return { stats: stats as Stats, upcoming: upcoming as Upcoming[] };
  }, []);

  const go = (href: string) => () => router.push(href as Href);
  const hello = profile?.full_name.split(' ')[0];

  return (
    <Page title={`Bonjour ${hello ?? ''}`} subtitle="Vue d’ensemble de l’activité Zoko" refreshing={false} onRefresh={reload}>
      {loading && <Loading />}
      {error && <LoadError message={error} onRetry={reload} />}
      {data && (
        <>
          <Grid min={230}>
            <Stat
              label="Réservations en attente"
              value={data.stats.pending_reservations}
              icon="hourglass-outline"
              tone="warning"
              hint="À confirmer"
              onPress={go('/admin/reservations?status=pending')}
            />
            <Stat
              label="Départs aujourd’hui"
              value={data.stats.today_departures}
              icon="today-outline"
              tone="info"
              hint={`${data.stats.in_progress} location(s) en cours`}
              onPress={go('/admin/reservations?status=in_progress')}
            />
            <Stat
              label="Paiements à vérifier"
              value={data.stats.payments_to_verify}
              icon="wallet-outline"
              tone={data.stats.payments_to_verify ? 'danger' : 'success'}
              hint={formatMoney(data.stats.payments_to_verify_amount)}
              onPress={can(role, 'payments') ? go('/admin/payments') : undefined}
            />
            {can(role, 'reports') && (
              <Stat
                label="Encaissé ce mois"
                value={formatMoney(data.stats.revenue_month)}
                icon="trending-up-outline"
                tone="success"
                hint={`Reste à encaisser : ${formatMoney(data.stats.unpaid_balance)}`}
                onPress={go('/admin/reports')}
              />
            )}
          </Grid>

          <Grid min={230}>
            <Stat
              label="Véhicules disponibles"
              value={`${data.stats.vehicles_available} / ${data.stats.vehicles_total}`}
              icon="car-sport-outline"
              tone="info"
              onPress={can(role, 'fleet') ? go('/admin/vehicles') : undefined}
            />
            <Stat
              label="Chauffeurs disponibles"
              value={data.stats.drivers_available}
              icon="id-card-outline"
              tone="info"
              onPress={can(role, 'drivers') ? go('/admin/drivers') : undefined}
            />
            <Stat
              label="Clients actifs"
              value={data.stats.clients_total}
              icon="people-outline"
              tone="neutral"
              onPress={go('/admin/clients')}
            />
            {can(role, 'team') && (
              <Stat
                label="Demandes d’accès"
                value={data.stats.access_requests}
                icon="shield-checkmark-outline"
                tone={data.stats.access_requests ? 'warning' : 'neutral'}
                onPress={go('/admin/team')}
              />
            )}
          </Grid>

          <Card
            title="Prochaines locations"
            actions={<Text style={ui.link} onPress={go('/admin/reservations')}>Tout voir</Text>}
          >
            {data.upcoming.length === 0 ? (
              <Empty icon="calendar-outline" text="Aucune location à venir." />
            ) : (
              data.upcoming.map((r) => {
                const st = RESERVATION_STATUS[r.status];
                const pay = paymentState(r);
                return (
                  <ListRow key={r.id} onPress={go(`/admin/reservations/${r.id}`)}>
                    <View style={ui.flex1}>
                      <Text style={ui.strong}>
                        {r.reference} · {r.client_name}
                      </Text>
                      <Text style={ui.muted}>
                        {formatDateTime(r.start_at)} · {r.duration_hours} h · {r.model_name}
                        {r.plate_number ? ` (${r.plate_number})` : ''}
                      </Text>
                      <Text style={ui.small}>
                        {r.with_driver ? `Chauffeur : ${r.driver_name ?? 'à attribuer'}` : 'Sans chauffeur'}
                      </Text>
                    </View>
                    <View style={[ui.gapSm, { alignItems: 'flex-end' }]}>
                      <Badge label={st.label} tone={st.tone} />
                      <Badge label={pay.label} tone={pay.tone} />
                    </View>
                  </ListRow>
                );
              })
            )}
          </Card>
        </>
      )}
    </Page>
  );
}

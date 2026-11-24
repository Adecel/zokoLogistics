import { useMemo, useState } from 'react';
import { Platform, StyleSheet, Text, View } from 'react-native';
import { RequirePermission } from '../../../components/admin/shell';
import { Button, Card, Choice, Empty, Grid, Page, Stat, ui } from '../../../components/admin/ui';
import { LoadError, Loading } from '../../../components/load-state';
import { Colors, Radius } from '../../../constants/zoko';
import { formatDateTime, formatMoney, PAYMENT_METHODS, type PaymentMethod } from '../../../lib/admin/labels';
import { unwrap, useLoad } from '../../../lib/admin/use-load';
import { supabase } from '../../../lib/supabase';

type Revenue = { month: string; method: PaymentMethod; payments: number; gross_amount: number; refunded_amount: number; net_amount: number };
type VehiclePerf = { month: string; plate_number: string; model_name: string; rentals: number; rented_hours: number; revenue: number };
type DriverAct = { month: string; driver_name: string; rentals: number; driven_hours: number };
type Demand = { month: string; model_name: string; duration_hours: number; requests: number; confirmed: number; lost: number };

const MONTHS = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];
const monthLabel = (m: string) => `${MONTHS[Number(m.slice(5, 7)) - 1]} ${m.slice(0, 4)}`;

// First day of the last 12 months, as "YYYY-MM-01"
function lastMonths(count: number) {
  const d = new Date();
  return Array.from({ length: count }, (_, i) => {
    const x = new Date(d.getFullYear(), d.getMonth() - i, 1);
    return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-01`;
  });
}

export default function ReportsScreen() {
  return (
    <RequirePermission permission="reports">
      <Reports />
    </RequirePermission>
  );
}

function Reports() {
  const months = useMemo(() => lastMonths(12), []);
  const [month, setMonth] = useState(months[0]);

  const { data, error, loading, reload } = useLoad(async () => {
    const since = months[months.length - 1];
    const [revenue, vehicles, drivers, demand] = await Promise.all([
      supabase.from('report_monthly_revenue').select('*').gte('month', since).then(unwrap),
      supabase.from('report_vehicle_performance').select('month, plate_number, model_name, rentals, rented_hours, revenue').gte('month', since).then(unwrap),
      supabase.from('report_driver_activity').select('month, driver_name, rentals, driven_hours').gte('month', since).then(unwrap),
      supabase.from('report_model_demand').select('*').gte('month', since).then(unwrap),
    ]);
    return {
      revenue: revenue as Revenue[],
      vehicles: vehicles as VehiclePerf[],
      drivers: drivers as DriverAct[],
      demand: demand as Demand[],
    };
  }, []);

  const byMonth = useMemo(() => {
    const map = new Map<string, number>();
    for (const r of data?.revenue ?? []) map.set(r.month, (map.get(r.month) ?? 0) + Number(r.net_amount));
    return [...months].reverse().map((m) => ({ month: m, net: map.get(m) ?? 0 }));
  }, [data, months]);
  const maxNet = Math.max(1, ...byMonth.map((m) => m.net));

  const monthRevenue = (data?.revenue ?? []).filter((r) => r.month === month);
  const totals = monthRevenue.reduce(
    (t, r) => ({ gross: t.gross + Number(r.gross_amount), refunded: t.refunded + Number(r.refunded_amount), net: t.net + Number(r.net_amount), count: t.count + Number(r.payments) }),
    { gross: 0, refunded: 0, net: 0, count: 0 },
  );
  const monthVehicles = (data?.vehicles ?? []).filter((v) => v.month === month).sort((a, b) => b.revenue - a.revenue);
  const monthDrivers = (data?.drivers ?? []).filter((d) => d.month === month).sort((a, b) => b.rentals - a.rentals);
  const monthDemand = (data?.demand ?? []).filter((d) => d.month === month).sort((a, b) => b.requests - a.requests);

  return (
    <Page
      title="Rapports"
      subtitle="Argent encaissé, activité de la flotte et des chauffeurs"
      onRefresh={reload}
      refreshing={false}
      actions={Platform.OS === 'web' ? <Button title="Exporter les paiements (CSV)" variant="outline" icon="download-outline" onPress={() => exportPayments(month)} /> : undefined}
    >
      {loading && <Loading />}
      {error && <LoadError message={error} onRetry={reload} />}
      {data && (
        <>
          <Card title="Encaissé net par mois (12 derniers mois)">
            <View style={styles.chart}>
              {byMonth.map((m) => (
                <View key={m.month} style={styles.barCol}>
                  <Text style={styles.barValue} numberOfLines={1}>
                    {m.net ? `${Math.round(m.net / 1000)}k` : ''}
                  </Text>
                  <View style={styles.barTrack}>
                    <View style={[styles.bar, { height: `${(m.net / maxNet) * 100}%`, backgroundColor: m.month === month ? Colors.primary : '#9CCFEF' }]} />
                  </View>
                  <Text style={styles.barLabel} onPress={() => setMonth(m.month)}>
                    {monthLabel(m.month).split(' ')[0]}
                  </Text>
                </View>
              ))}
            </View>
          </Card>

          <Choice label="Mois analysé" options={months.slice(0, 6).map((m) => ({ value: m, label: monthLabel(m) }))} value={month} onChange={setMonth} />

          <Grid min={220}>
            <Stat label="Encaissé net" value={formatMoney(totals.net)} icon="trending-up-outline" tone="success" />
            <Stat label="Paiements reçus" value={formatMoney(totals.gross)} icon="arrow-down-circle-outline" hint={`${totals.count} paiement(s)`} />
            <Stat label="Remboursé" value={formatMoney(totals.refunded)} icon="arrow-up-circle-outline" tone="warning" />
          </Grid>

          <Grid min={360}>
            <Card title="Par moyen de paiement">
              {monthRevenue.length === 0 && <Empty text="Aucun paiement validé ce mois-ci." />}
              {monthRevenue.map((r) => (
                <Line key={r.method} label={PAYMENT_METHODS[r.method] ?? r.method} value={formatMoney(Number(r.net_amount))} hint={`${r.payments} paiement(s)`} share={totals.net ? Number(r.net_amount) / totals.net : 0} />
              ))}
            </Card>
            <Card title="Véhicules">
              {monthVehicles.length === 0 && <Empty text="Aucune location ce mois-ci." />}
              {monthVehicles.map((v) => (
                <Line key={v.plate_number} label={`${v.plate_number} · ${v.model_name}`} value={formatMoney(Number(v.revenue))} hint={`${v.rentals} location(s) · ${v.rented_hours} h`} />
              ))}
            </Card>
            <Card title="Chauffeurs">
              {monthDrivers.length === 0 && <Empty text="Aucune course ce mois-ci." />}
              {monthDrivers.map((d) => (
                <Line key={d.driver_name} label={d.driver_name} value={`${d.rentals} course(s)`} hint={`${d.driven_hours} h de conduite`} />
              ))}
            </Card>
            <Card title="Demande par modèle">
              {monthDemand.length === 0 && <Empty text="Aucune demande ce mois-ci." />}
              {monthDemand.map((d) => (
                <Line
                  key={`${d.model_name}-${d.duration_hours}`}
                  label={`${d.model_name} · ${d.duration_hours} h`}
                  value={`${d.requests} demande(s)`}
                  hint={`${d.confirmed} confirmée(s) · ${d.lost} perdue(s)`}
                />
              ))}
            </Card>
          </Grid>
        </>
      )}
    </Page>
  );
}

function Line({ label, value, hint, share }: { label: string; value: string; hint?: string; share?: number }) {
  return (
    <View style={styles.line}>
      <View style={ui.between}>
        <Text style={ui.body} numberOfLines={1}>
          {label}
        </Text>
        <Text style={ui.strong}>{value}</Text>
      </View>
      {hint ? <Text style={ui.small}>{hint}</Text> : null}
      {share !== undefined ? (
        <View style={styles.shareTrack}>
          <View style={[styles.share, { width: `${Math.round(share * 100)}%` }]} />
        </View>
      ) : null}
    </View>
  );
}

// Web only: download the month's validated payments as a CSV file (opens in Excel)
async function exportPayments(month: string) {
  const start = `${month}T00:00:00+01:00`;
  const next = new Date(month);
  next.setMonth(next.getMonth() + 1);
  const end = `${next.toISOString().slice(0, 10)}T00:00:00+01:00`;
  const { data } = await supabase
    .from('payments')
    .select('paid_at, kind, method, amount, transaction_reference, reservation:reservation_id(reference, client:client_id(full_name))')
    .eq('status', 'succeeded')
    .gte('paid_at', start)
    .lt('paid_at', end)
    .order('paid_at');
  type P = { paid_at: string; kind: string; method: PaymentMethod; amount: number; transaction_reference: string | null; reservation: { reference: string; client: { full_name: string } | null } | null };
  const rows = ((data ?? []) as unknown as P[]).map((p) => [
    formatDateTime(p.paid_at),
    p.kind === 'refund' ? 'Remboursement' : 'Paiement',
    PAYMENT_METHODS[p.method] ?? p.method,
    String(p.kind === 'refund' ? -p.amount : p.amount),
    p.transaction_reference ?? '',
    p.reservation?.reference ?? '',
    p.reservation?.client?.full_name ?? '',
  ]);
  const header = ['Date', 'Type', 'Moyen', 'Montant (FCFA)', 'N° transaction', 'Réservation', 'Client'];
  const csv = [header, ...rows].map((r) => r.map((c) => `"${c.replace(/"/g, '""')}"`).join(';')).join('\n');
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `zoko-paiements-${month.slice(0, 7)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

const styles = StyleSheet.create({
  chart: { flexDirection: 'row', alignItems: 'flex-end', gap: 6, height: 200 },
  barCol: { flex: 1, alignItems: 'center', gap: 4, height: '100%' },
  barTrack: { flex: 1, width: '70%', justifyContent: 'flex-end' },
  bar: { width: '100%', borderTopLeftRadius: 6, borderTopRightRadius: 6, minHeight: 2 },
  barValue: { fontSize: 10, color: Colors.textMuted },
  barLabel: { fontSize: 11, color: Colors.textMuted },
  line: { gap: 4, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: Colors.border },
  shareTrack: { height: 6, borderRadius: Radius.pill, backgroundColor: '#EEF2F7', overflow: 'hidden' },
  share: { height: '100%', backgroundColor: Colors.primary },
});

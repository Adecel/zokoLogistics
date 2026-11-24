import { Image } from 'expo-image';
import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { Linking, StyleSheet, Text, View } from 'react-native';
import { RequirePermission } from '../../../components/admin/shell';
import {
  Badge,
  Button,
  Card,
  Choice,
  Empty,
  FormError,
  Grid,
  ListRow,
  Page,
  SearchBox,
  Sheet,
  Stat,
  ui,
  useConfirm,
  useIsWide,
} from '../../../components/admin/ui';
import { LoadError, Loading } from '../../../components/load-state';
import {
  formatDateTime,
  formatMoney,
  PAYMENT_METHODS,
  PAYMENT_STATUS,
  type PaymentMethod,
  type PaymentStatus,
} from '../../../lib/admin/labels';
import { errorMessage, unwrap, useLoad } from '../../../lib/admin/use-load';
import { supabase } from '../../../lib/supabase';

type Row = {
  id: string;
  kind: 'payment' | 'refund';
  method: PaymentMethod;
  status: PaymentStatus;
  amount: number;
  transaction_reference: string | null;
  payer_phone: string | null;
  proof_path: string | null;
  created_at: string;
  paid_at: string | null;
  reservation: { id: string; reference: string; start_at: string; client: { full_name: string } | null } | null;
};

export default function PaymentsScreen() {
  return (
    <RequirePermission permission="payments">
      <Payments />
    </RequirePermission>
  );
}

function Payments() {
  const wide = useIsWide();
  const confirm = useConfirm();
  const [status, setStatus] = useState<PaymentStatus | 'all'>('pending');
  const [method, setMethod] = useState<PaymentMethod | 'all'>('all');
  const [search, setSearch] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [proofUrl, setProofUrl] = useState<string | null>(null);

  const { data, error, loading, reload } = useLoad(async () => {
    let q = supabase
      .from('payments')
      .select(
        'id, kind, method, status, amount, transaction_reference, payer_phone, proof_path, created_at, paid_at, reservation:reservation_id(id, reference, start_at, client:client_id(full_name))',
      )
      .order('created_at', { ascending: status === 'pending' })
      .limit(500);
    if (status !== 'all') q = q.eq('status', status);
    return unwrap(await q) as unknown as Row[];
  }, [status]);

  const rows = useMemo(() => {
    const s = search.trim().toLowerCase();
    return (data ?? []).filter(
      (p) =>
        (method === 'all' || p.method === method) &&
        (!s ||
          [p.reservation?.reference, p.reservation?.client?.full_name, p.transaction_reference, p.payer_phone].some((v) =>
            (v ?? '').toLowerCase().includes(s),
          )),
    );
  }, [data, method, search]);

  const totals = useMemo(() => {
    const t = { in: 0, out: 0 };
    for (const p of rows) {
      if (p.kind === 'refund') t.out += p.amount;
      else t.in += p.amount;
    }
    return t;
  }, [rows]);

  async function decide(p: Row, next: PaymentStatus) {
    const ok = await confirm({
      title: next === 'succeeded' ? 'Valider ce paiement' : 'Refuser ce paiement',
      message: `${formatMoney(p.amount)} · ${PAYMENT_METHODS[p.method]} · ${p.reservation?.reference ?? ''}`,
      confirmLabel: next === 'succeeded' ? 'Argent reçu' : 'Refuser',
      danger: next !== 'succeeded',
    });
    if (ok === null) return;
    setErr(null);
    const { error: e } = await supabase.from('payments').update({ status: next }).eq('id', p.id);
    if (e) setErr(errorMessage(e));
    else reload();
  }

  async function openProof(path: string) {
    const { data: signed, error: e } = await supabase.storage.from('payment-proofs').createSignedUrl(path, 600);
    if (e || !signed) setErr(errorMessage(e, 'Impossible d’ouvrir la preuve.'));
    else setProofUrl(signed.signedUrl);
  }

  return (
    <Page title="Paiements" subtitle="Vérifier l’argent reçu, suivre les remboursements" onRefresh={reload} refreshing={false}>
      <Card>
        <Choice
          options={[
            { value: 'pending', label: 'À vérifier' },
            { value: 'succeeded', label: 'Validés' },
            { value: 'failed', label: 'Refusés' },
            { value: 'all', label: 'Tous' },
          ]}
          value={status}
          onChange={setStatus}
        />
        <Choice
          label="Moyen"
          options={[
            { value: 'all', label: 'Tous' },
            ...(Object.keys(PAYMENT_METHODS) as PaymentMethod[]).map((m) => ({ value: m, label: PAYMENT_METHODS[m] })),
          ]}
          value={method}
          onChange={setMethod}
        />
        <SearchBox value={search} onChangeText={setSearch} placeholder="Référence, client, n° de transaction…" />
      </Card>

      <Grid min={220}>
        <Stat label="Paiements (liste)" value={formatMoney(totals.in)} icon="arrow-down-circle-outline" tone="success" />
        <Stat label="Remboursements (liste)" value={formatMoney(totals.out)} icon="arrow-up-circle-outline" tone="warning" />
        <Stat label="Lignes" value={rows.length} icon="list-outline" tone="neutral" />
      </Grid>

      <FormError message={err} />
      {loading && <Loading />}
      {error && <LoadError message={error} onRetry={reload} />}
      {data && (
        <Card>
          {rows.length === 0 && <Empty icon="wallet-outline" text={status === 'pending' ? 'Aucun paiement à vérifier. 👍' : 'Aucun paiement.'} />}
          {rows.map((p) => {
            const st = PAYMENT_STATUS[p.status];
            return (
              <ListRow key={p.id} onPress={p.reservation ? () => router.push(`/admin/reservations/${p.reservation!.id}`) : undefined}>
                <View style={[ui.flex1, wide && { flexDirection: 'row', alignItems: 'center', gap: 16 }]}>
                  <View style={wide ? { width: 170 } : undefined}>
                    <Text style={ui.strong}>
                      {p.kind === 'refund' ? '− ' : ''}
                      {formatMoney(p.amount)}
                    </Text>
                    <Text style={ui.small}>{PAYMENT_METHODS[p.method] ?? p.method}</Text>
                  </View>
                  <View style={wide ? ui.flex1 : undefined}>
                    <Text style={ui.body} numberOfLines={1}>
                      {p.reservation?.reference} · {p.reservation?.client?.full_name ?? '—'}
                    </Text>
                    <Text style={ui.small} numberOfLines={1}>
                      Déclaré le {formatDateTime(p.created_at)}
                      {p.transaction_reference ? ` · Réf. ${p.transaction_reference}` : ''}
                      {p.payer_phone ? ` · ${p.payer_phone}` : ''}
                    </Text>
                  </View>
                  <View style={[ui.wrap, wide ? { justifyContent: 'flex-end' } : { marginTop: 6 }]}>
                    {p.proof_path ? <Button title="Preuve" small variant="outline" icon="image-outline" onPress={() => openProof(p.proof_path!)} /> : null}
                    {p.status === 'pending' && (
                      <>
                        <Button title="Reçu" small variant="success" icon="checkmark" onPress={() => decide(p, 'succeeded')} />
                        <Button title="Refuser" small variant="danger" icon="close" onPress={() => decide(p, 'failed')} />
                      </>
                    )}
                  </View>
                </View>
                <View style={{ alignItems: 'flex-end', gap: 6 }}>
                  <Badge label={st.label} tone={st.tone} />
                  {p.kind === 'refund' && <Badge label="Remboursement" tone="warning" />}
                </View>
              </ListRow>
            );
          })}
        </Card>
      )}

      <Sheet visible={!!proofUrl} title="Preuve de paiement" onClose={() => setProofUrl(null)}>
        {proofUrl ? <Image source={{ uri: proofUrl }} style={styles.proof} contentFit="contain" /> : null}
        {proofUrl ? <Button title="Ouvrir dans un nouvel onglet" variant="outline" icon="open-outline" onPress={() => Linking.openURL(proofUrl)} /> : null}
      </Sheet>
    </Page>
  );
}

const styles = StyleSheet.create({
  proof: { width: '100%', height: 480, backgroundColor: '#F3F6FA', borderRadius: 12 },
});

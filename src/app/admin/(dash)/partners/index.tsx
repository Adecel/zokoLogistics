import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { Text, View } from 'react-native';
import { RequirePermission } from '../../../../components/admin/shell';
import { Badge, Card, Choice, Empty, ListRow, Page, SearchBox, ui } from '../../../../components/admin/ui';
import { LoadError, Loading } from '../../../../components/load-state';
import { formatDate } from '../../../../lib/admin/labels';
import { unwrap, useLoad } from '../../../../lib/admin/use-load';
import { supabase } from '../../../../lib/supabase';
import { PARTNER_TONES, PARTNER_LABELS, type AdminPartnerStatus } from '../../../../lib/admin/partner-labels';

type Row = {
  profile_id: string;
  status: AdminPartnerStatus;
  city: string;
  drives_self: boolean;
  created_at: string;
  profile: { full_name: string; phone: string | null; email: string | null } | null;
  vehicles: { status: 'pending' | 'approved' | 'rejected' }[];
};

type Filter = 'todo' | 'approved' | 'closed' | 'all';

export default function PartnersScreen() {
  return (
    <RequirePermission permission="partners">
      <PartnersList />
    </RequirePermission>
  );
}

function PartnersList() {
  const [filter, setFilter] = useState<Filter>('todo');
  const [search, setSearch] = useState('');
  const { data, error, loading, reload } = useLoad(
    async () =>
      unwrap(
        await supabase
          .from('partners')
          .select('profile_id, status, city, drives_self, created_at, profile:profiles!partners_profile_id_fkey(full_name, phone, email), vehicles:partner_vehicles(status)')
          .order('created_at', { ascending: false }),
      ) as unknown as Row[],
    [],
  );

  const todo = (r: Row) => r.status === 'pending' || (r.status === 'approved' && r.vehicles.some((v) => v.status === 'pending'));
  const rows = useMemo(() => {
    const s = search.trim().toLowerCase();
    return (data ?? []).filter((r) => {
      if (filter === 'todo' && !todo(r)) return false;
      if (filter === 'approved' && r.status !== 'approved') return false;
      if (filter === 'closed' && !['rejected', 'suspended'].includes(r.status)) return false;
      if (!s) return true;
      return [r.profile?.full_name, r.profile?.phone, r.profile?.email, r.city].some((v) => v?.toLowerCase().includes(s));
    });
  }, [data, filter, search]);

  const count = (f: Filter) =>
    (data ?? []).filter((r) =>
      f === 'todo' ? todo(r) : f === 'approved' ? r.status === 'approved' : f === 'closed' ? ['rejected', 'suspended'].includes(r.status) : true,
    ).length;

  return (
    <Page title="Partenaires" subtitle="Zoko Partenaire : propriétaires et véhicules à valider" onRefresh={reload} refreshing={false}>
      <Card>
        <Choice
          options={[
            { value: 'todo', label: 'À valider', count: count('todo') },
            { value: 'approved', label: 'Validés', count: count('approved') },
            { value: 'closed', label: 'Refusés / suspendus', count: count('closed') },
            { value: 'all', label: 'Tous', count: count('all') },
          ]}
          value={filter}
          onChange={setFilter}
        />
        <View style={ui.wrap}>
          <SearchBox value={search} onChangeText={setSearch} placeholder="Nom, téléphone, e-mail, ville…" />
        </View>
      </Card>

      {loading && <Loading />}
      {error && <LoadError message={error} onRetry={reload} />}
      {data && (
        <Card title={`${rows.length} partenaire(s)`}>
          {rows.length === 0 && <Empty icon="people-circle-outline" text="Aucun partenaire pour ce filtre." />}
          {rows.map((r) => {
            const pending = r.vehicles.filter((v) => v.status === 'pending').length;
            const approved = r.vehicles.filter((v) => v.status === 'approved').length;
            return (
              <ListRow key={r.profile_id} onPress={() => router.push(`/admin/partners/${r.profile_id}`)}>
                <View style={ui.flex1}>
                  <Text style={ui.strong}>{r.profile?.full_name ?? '—'}</Text>
                  <Text style={ui.small}>
                    {[r.city, r.profile?.phone, r.drives_self ? 'conduit lui-même' : 'confie à Zoko', `depuis le ${formatDate(r.created_at)}`]
                      .filter(Boolean)
                      .join(' · ')}
                  </Text>
                  <Text style={ui.small}>
                    {approved} véhicule(s) validé(s){pending ? ` · ${pending} à valider` : ''}
                  </Text>
                </View>
                <View style={[ui.gapSm, { alignItems: 'flex-end' }]}>
                  <Badge label={PARTNER_LABELS[r.status]} tone={PARTNER_TONES[r.status]} />
                  {pending > 0 && <Badge label={`${pending} véhicule(s) à valider`} tone="warning" />}
                </View>
              </ListRow>
            );
          })}
        </Card>
      )}
    </Page>
  );
}

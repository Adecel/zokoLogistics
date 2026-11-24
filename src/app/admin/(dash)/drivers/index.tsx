import { Image } from 'expo-image';
import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { RequirePermission } from '../../../../components/admin/shell';
import { Avatar, Badge, Button, Card, Choice, Empty, ListRow, Page, SearchBox, ui } from '../../../../components/admin/ui';
import { LoadError, Loading } from '../../../../components/load-state';
import { licenseState, type DriverRow } from '../../../../lib/admin/drivers';
import { unwrap, useLoad } from '../../../../lib/admin/use-load';
import { supabase } from '../../../../lib/supabase';

export default function DriversScreen() {
  return (
    <RequirePermission permission="drivers">
      <Drivers />
    </RequirePermission>
  );
}

function Drivers() {
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<'all' | 'available' | 'unavailable'>('all');
  const { data, error, loading, reload } = useLoad(
    async () =>
      unwrap(
        await supabase
          .from('drivers')
          .select('profile_id, license_number, license_expires_on, is_available, notes, profile:profile_id(full_name, phone, email, avatar_url, is_active)'),
      ) as unknown as DriverRow[],
    [],
  );

  const rows = useMemo(() => {
    const s = search.trim().toLowerCase();
    return (data ?? [])
      .filter((d) => d.profile && d.profile.full_name !== 'Compte supprimé')
      .filter((d) => (filter === 'all' ? true : filter === 'available' ? d.is_available && d.profile?.is_active : !d.is_available || !d.profile?.is_active))
      .filter((d) => !s || [d.profile?.full_name, d.profile?.phone, d.license_number].some((v) => (v ?? '').toLowerCase().includes(s)))
      .sort((a, b) => (a.profile?.full_name ?? '').localeCompare(b.profile?.full_name ?? ''));
  }, [data, search, filter]);

  return (
    <Page
      title="Chauffeurs"
      subtitle="Les chauffeurs proposés aux clients et attribués aux locations"
      onRefresh={reload}
      refreshing={false}
      actions={<Button title="Ajouter un chauffeur" icon="add" onPress={() => router.push('/admin/drivers/new')} />}
    >
      <Card>
        <SearchBox value={search} onChangeText={setSearch} placeholder="Nom, téléphone, n° de permis…" />
        <Choice
          options={[
            { value: 'all', label: 'Tous' },
            { value: 'available', label: 'Disponibles' },
            { value: 'unavailable', label: 'Indisponibles' },
          ]}
          value={filter}
          onChange={setFilter}
        />
      </Card>
      {loading && <Loading />}
      {error && <LoadError message={error} onRetry={reload} />}
      {data && (
        <Card title={`${rows.length} chauffeur(s)`}>
          {rows.length === 0 && <Empty icon="id-card-outline" text="Aucun chauffeur." />}
          {rows.map((d) => {
            const lic = licenseState(d.license_expires_on);
            const active = d.is_available && d.profile?.is_active;
            return (
              <ListRow key={d.profile_id} onPress={() => router.push(`/admin/drivers/${d.profile_id}`)}>
                {d.profile?.avatar_url ? (
                  <Image source={{ uri: d.profile.avatar_url }} style={styles.avatar} contentFit="cover" />
                ) : (
                  <Avatar name={d.profile?.full_name ?? '?'} />
                )}
                <View style={ui.flex1}>
                  <Text style={ui.strong}>{d.profile?.full_name}</Text>
                  <Text style={ui.small}>
                    {d.profile?.phone ?? '—'}
                    {d.license_number ? ` · Permis ${d.license_number}` : ''}
                  </Text>
                </View>
                <View style={{ alignItems: 'flex-end', gap: 6 }}>
                  <Badge label={!d.profile?.is_active ? 'Compte désactivé' : active ? 'Disponible' : 'Indisponible'} tone={active ? 'success' : 'neutral'} />
                  <Badge label={lic.label} tone={lic.tone} />
                </View>
              </ListRow>
            );
          })}
        </Card>
      )}
    </Page>
  );
}

const styles = StyleSheet.create({
  avatar: { width: 40, height: 40, borderRadius: 20 },
});

import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { Text, View } from 'react-native';
import { RequirePermission } from '../../../../components/admin/shell';
import { Badge, Button, Card, Empty, Grid, Page, SearchBox, ui } from '../../../../components/admin/ui';
import { LoadError, Loading } from '../../../../components/load-state';
import { VehicleImage } from '../../../../components/vehicle-image';
import { FUEL_LABELS, TRANSMISSION_LABELS } from '../../../../constants/vehicles';
import { formatMoney, VEHICLE_STATUS, type VehicleStatus } from '../../../../lib/admin/labels';
import { unwrap, useLoad } from '../../../../lib/admin/use-load';
import { supabase } from '../../../../lib/supabase';

type Model = {
  id: string;
  brand: string;
  name: string;
  seats: number;
  transmission: keyof typeof TRANSMISSION_LABELS;
  fuel_type: keyof typeof FUEL_LABELS;
  is_active: boolean;
  vehicle_photos: { url: string; position: number }[];
  vehicles: { id: string; plate_number: string; status: VehicleStatus }[];
  rates: { duration_hours: number; price: number; valid_from: string; valid_to: string | null }[];
};

export default function VehiclesScreen() {
  return (
    <RequirePermission permission="fleet">
      <Vehicles />
    </RequirePermission>
  );
}

function Vehicles() {
  const [search, setSearch] = useState('');
  const { data, error, loading, reload } = useLoad(
    async () => ({
      // "Now" for current prices, taken when the data is fetched
      now: Date.now(),
      models: unwrap(
        await supabase
          .from('vehicle_models')
          .select(
            'id, brand, name, seats, transmission, fuel_type, is_active, vehicle_photos(url, position), vehicles(id, plate_number, status), rates(duration_hours, price, valid_from, valid_to)',
          )
          .order('brand')
          .order('name'),
      ) as Model[],
    }),
    [],
  );

  const models = useMemo(() => {
    const s = search.trim().toLowerCase();
    return (data?.models ?? []).filter(
      (m) => !s || `${m.brand} ${m.name}`.toLowerCase().includes(s) || m.vehicles.some((v) => v.plate_number.toLowerCase().includes(s)),
    );
  }, [data, search]);

  const now = data?.now ?? 0;

  return (
    <Page
      title="Véhicules"
      subtitle="Modèles proposés aux clients, tarifs, photos et flotte réelle"
      onRefresh={reload}
      refreshing={false}
      actions={<Button title="Ajouter un véhicule" icon="add" onPress={() => router.push('/admin/vehicles/new')} />}
    >
      <SearchBox value={search} onChangeText={setSearch} placeholder="Marque, modèle ou plaque…" />
      {loading && <Loading />}
      {error && <LoadError message={error} onRetry={reload} />}
      {data && models.length === 0 && <Empty icon="car-sport-outline" text="Aucun véhicule. Ajoutez le premier." />}
      <Grid min={300}>
        {models.map((m) => {
          const photo = [...m.vehicle_photos].sort((a, b) => a.position - b.position)[0]?.url;
          const rates = m.rates
            .filter((r) => new Date(r.valid_from).getTime() <= now && (!r.valid_to || new Date(r.valid_to).getTime() > now))
            .sort((a, b) => a.duration_hours - b.duration_hours);
          const available = m.vehicles.filter((v) => v.status === 'available').length;
          return (
            <Card key={m.id} style={{ padding: 0, overflow: 'hidden', gap: 0 }}>
              <VehicleImage uri={photo} size={56} style={{ height: 160, borderRadius: 0 }} />
              <View style={{ padding: 16, gap: 8 }}>
                <View style={ui.between}>
                  <Text style={ui.title}>
                    {m.brand} {m.name}
                  </Text>
                  <Badge label={m.is_active ? 'Visible' : 'Masqué'} tone={m.is_active ? 'success' : 'neutral'} />
                </View>
                <Text style={ui.small}>
                  {m.seats} places · {TRANSMISSION_LABELS[m.transmission]} · {FUEL_LABELS[m.fuel_type]}
                </Text>
                <Text style={ui.muted}>
                  {rates.length ? rates.map((r) => `${r.duration_hours} h : ${formatMoney(r.price)}`).join('  ·  ') : 'Aucun tarif en vigueur'}
                </Text>
                <View style={ui.wrap}>
                  <Badge label={`${available} / ${m.vehicles.length} disponible(s)`} tone={available ? 'info' : 'warning'} />
                  {m.vehicles.slice(0, 4).map((v) => (
                    <Badge key={v.id} label={v.plate_number} tone={VEHICLE_STATUS[v.status].tone} />
                  ))}
                </View>
                <Button title="Gérer" variant="outline" icon="create-outline" small onPress={() => router.push(`/admin/vehicles/${m.id}`)} />
              </View>
            </Card>
          );
        })}
      </Grid>
    </Page>
  );
}

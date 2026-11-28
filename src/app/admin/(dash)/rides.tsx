import { useMemo, useState } from 'react';
import { Text, View } from 'react-native';
import { RequirePermission } from '../../../components/admin/shell';
import {
  Badge,
  Button,
  Card,
  Choice,
  Empty,
  FieldRow,
  FormError,
  ListRow,
  Notice,
  Page,
  Sheet,
  TextField,
  Toggle,
  ui,
  useConfirm,
} from '../../../components/admin/ui';
import { LoadError, Loading } from '../../../components/load-state';
import { formatMoney } from '../../../lib/admin/labels';
import { errorMessage, unwrap, useLoad } from '../../../lib/admin/use-load';
import { supabase } from '../../../lib/supabase';

// Immediate rides: zones (arrondissements / quartiers) and the flat price of
// each route "zone A <-> zone B" for each vehicle model. Agents can edit all of it.

type Zone = { id: string; city: string; name: string; district: string | null; is_active: boolean; position: number };
type Route = { id: string; zone_a: string; zone_b: string; duration_minutes: number };
type Fare = { id: string; route_id: string; model_id: string; price: number };
type Model = { id: string; brand: string; name: string };
type VehicleCity = { city: string; model_id: string };

const pairKey = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`);

export default function RidesScreen() {
  return (
    <RequirePermission permission="rides">
      <RidesAdmin />
    </RequirePermission>
  );
}

function RidesAdmin() {
  const { data, error, loading, reload } = useLoad(async () => {
    const [zones, routes, fares, models, vehicles] = await Promise.all([
      supabase.from('ride_zones').select('id, city, name, district, is_active, position').order('position').order('name').then(unwrap),
      supabase.from('ride_routes').select('id, zone_a, zone_b, duration_minutes').then(unwrap),
      supabase.from('ride_fares').select('id, route_id, model_id, price').is('valid_to', null).then(unwrap),
      supabase.from('vehicle_models').select('id, brand, name').eq('is_active', true).order('name').then(unwrap),
      supabase.from('vehicles').select('city, model_id').neq('status', 'out_of_service').then(unwrap),
    ]);
    return {
      zones: zones as Zone[],
      routes: routes as Route[],
      fares: fares as Fare[],
      models: models as Model[],
      vehicles: vehicles as VehicleCity[],
    };
  }, []);

  const cities = useMemo(() => [...new Set((data?.zones ?? []).map((z) => z.city))].sort(), [data]);
  const [chosenCity, setCity] = useState<string | null>(null);
  const city = chosenCity && cities.includes(chosenCity) ? chosenCity : (cities[0] ?? null);
  const [zoneSheet, setZoneSheet] = useState<{ zone: Zone | null; city: string } | null>(null);

  if (loading) return <Loading />;
  if (error || !data) return <LoadError message={error ?? 'Chargement impossible.'} onRetry={reload} />;

  const zones = data.zones.filter((z) => z.city === city);
  const vehiclesHere = data.vehicles.filter((v) => v.city === city).length;

  return (
    <Page
      title="Courses"
      subtitle="Zones et prix forfaitaires des courses immédiates"
      onRefresh={reload}
      refreshing={false}
      actions={<Button title="Nouvelle ville" small variant="outline" icon="add" onPress={() => setZoneSheet({ zone: null, city: '' })} />}
    >
      {cities.length === 0 ? (
        <Card>
          <Empty icon="map-outline" text="Aucune zone. Créez une ville et ses arrondissements." />
        </Card>
      ) : (
        <>
          <Card>
            <Choice label="Ville" options={cities.map((c) => ({ value: c, label: c }))} value={city!} onChange={setCity} />
            {vehiclesHere === 0 ? (
              <Notice
                tone="warning"
                text={`Aucun véhicule basé à ${city} : les clients verront « indisponible ». Indiquez la ville des plaques dans Véhicules.`}
              />
            ) : (
              <Text style={ui.muted}>
                {vehiclesHere} véhicule(s) basé(s) à {city}. Chaque course bloque un véhicule pendant l’approche du chauffeur et le
                trajet : il n’est pas proposé aux locations sur ce créneau.
              </Text>
            )}
          </Card>

          <Zones zones={zones} onAdd={() => setZoneSheet({ zone: null, city: city! })} onEdit={(z) => setZoneSheet({ zone: z, city: z.city })} />
          <Prices zones={zones} routes={data.routes} fares={data.fares} models={data.models} onChanged={reload} />
        </>
      )}

      <ZoneSheet
        state={zoneSheet}
        onClose={() => setZoneSheet(null)}
        onSaved={(savedCity) => {
          setZoneSheet(null);
          setCity(savedCity);
          reload();
        }}
      />
    </Page>
  );
}

// ---------------------------------------------------------------------------

function Zones({ zones, onAdd, onEdit }: { zones: Zone[]; onAdd: () => void; onEdit: (z: Zone) => void }) {
  return (
    <Card title={`Zones (${zones.length})`} actions={<Button title="Ajouter une zone" small icon="add" onPress={onAdd} />}>
      <Text style={ui.muted}>Arrondissements ou quartiers connus. Une zone masquée n’est plus proposée aux clients.</Text>
      {zones.map((z) => (
        <ListRow key={z.id} onPress={() => onEdit(z)}>
          <View style={ui.flex1}>
            <Text style={ui.strong}>{z.name}</Text>
            {z.district ? <Text style={ui.small}>{z.district}</Text> : null}
          </View>
          <Badge label={z.is_active ? 'Proposée' : 'Masquée'} tone={z.is_active ? 'success' : 'neutral'} />
        </ListRow>
      ))}
    </Card>
  );
}

function ZoneSheet({
  state,
  onClose,
  onSaved,
}: {
  state: { zone: Zone | null; city: string } | null;
  onClose: () => void;
  onSaved: (city: string) => void;
}) {
  const confirm = useConfirm();
  const zone = state?.zone ?? null;
  const [form, setForm] = useState({ city: '', name: '', district: '', position: '0', active: true });
  const [openedFor, setOpenedFor] = useState<object | null>(null);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // Fill the form each time the sheet opens
  if (state && openedFor !== state) {
    setOpenedFor(state);
    setErr(null);
    setForm({
      city: zone?.city ?? state.city,
      name: zone?.name ?? '',
      district: zone?.district ?? '',
      position: String(zone?.position ?? 0),
      active: zone?.is_active ?? true,
    });
  }

  async function save() {
    if (!form.city.trim()) return setErr('Indiquez la ville.');
    if (!form.name.trim()) return setErr('Indiquez le nom de la zone.');
    setSaving(true);
    setErr(null);
    const values = {
      city: form.city.trim(),
      name: form.name.trim(),
      district: form.district.trim() || null,
      position: parseInt(form.position, 10) || 0,
      is_active: form.active,
    };
    const { error } = zone
      ? await supabase.from('ride_zones').update(values).eq('id', zone.id)
      : await supabase.from('ride_zones').insert(values);
    setSaving(false);
    if (error) return setErr(errorMessage(error));
    onSaved(values.city);
  }

  async function remove() {
    if (!zone) return;
    const ok = await confirm({
      title: `Supprimer ${zone.name}`,
      message: 'Ses prix seront supprimés. Impossible si des courses l’ont déjà utilisée : masquez-la plutôt.',
      danger: true,
      confirmLabel: 'Supprimer',
    });
    if (ok === null) return;
    const { error } = await supabase.from('ride_zones').delete().eq('id', zone.id);
    if (error) return setErr(error.code === '23503' ? 'Des courses utilisent déjà cette zone : masquez-la plutôt.' : errorMessage(error));
    onSaved(zone.city);
  }

  return (
    <Sheet
      visible={!!state}
      title={zone ? `Modifier ${zone.name}` : 'Ajouter une zone'}
      onClose={onClose}
      footer={
        <>
          {zone && <Button title="Supprimer" variant="danger" icon="trash-outline" onPress={remove} />}
          <Button title="Annuler" variant="ghost" onPress={onClose} />
          <Button title="Enregistrer" onPress={save} loading={saving} />
        </>
      }
    >
      <FieldRow>
        <TextField
          label="Ville"
          placeholder="Pointe-Noire"
          value={form.city}
          onChangeText={(t) => setForm({ ...form, city: t })}
          editable={!zone}
          hint={zone ? 'La ville ne change pas une fois la zone créée.' : 'Écrivez-la toujours de la même façon.'}
        />
        <TextField label="Nom" placeholder="Tié-Tié, Grand Marché…" value={form.name} onChangeText={(t) => setForm({ ...form, name: t })} />
      </FieldRow>
      <FieldRow>
        <TextField
          label="Arrondissement (facultatif)"
          placeholder="3e arrondissement"
          value={form.district}
          onChangeText={(t) => setForm({ ...form, district: t })}
          hint="Aide le client à trouver un quartier"
        />
        <TextField label="Ordre d’affichage" keyboardType="number-pad" value={form.position} onChangeText={(t) => setForm({ ...form, position: t })} />
      </FieldRow>
      <Toggle label="Proposée aux clients" value={form.active} onChange={(v) => setForm({ ...form, active: v })} />
      <FormError message={err} />
    </Sheet>
  );
}

// ---------------------------------------------------------------------------

function Prices({
  zones,
  routes,
  fares,
  models,
  onChanged,
}: {
  zones: Zone[];
  routes: Route[];
  fares: Fare[];
  models: Model[];
  onChanged: () => void;
}) {
  const [chosenFrom, setFrom] = useState<string | null>(null);
  const from = zones.find((z) => z.id === chosenFrom) ?? zones[0];
  const [editing, setEditing] = useState<{ from: Zone; to: Zone } | null>(null);

  const routeByPair = useMemo(() => new Map(routes.map((r) => [pairKey(r.zone_a, r.zone_b), r])), [routes]);
  const faresByRoute = useMemo(() => {
    const map = new Map<string, Fare[]>();
    for (const f of fares) map.set(f.route_id, [...(map.get(f.route_id) ?? []), f]);
    return map;
  }, [fares]);

  // Completeness for this city: unordered pairs (including inside one zone) with at least one price
  const totalPairs = (zones.length * (zones.length + 1)) / 2;
  const pricedPairs = zones.reduce(
    (n, a, i) =>
      n +
      zones.slice(i).filter((b) => {
        const r = routeByPair.get(pairKey(a.id, b.id));
        return r && (faresByRoute.get(r.id)?.length ?? 0) > 0;
      }).length,
    0,
  );

  if (!from) return null;

  return (
    <Card title="Prix des trajets">
      <Text style={ui.muted}>
        Un prix par trajet et par véhicule. Le même prix s’applique dans les deux sens (A → B = B → A). Laissez vide un véhicule
        que vous ne proposez pas sur ce trajet.
      </Text>
      <Notice
        tone={pricedPairs === totalPairs ? 'success' : 'warning'}
        text={`${pricedPairs} trajet(s) sur ${totalPairs} ont un prix. Un trajet sans prix ne peut pas être commandé.`}
      />
      <Choice label="Départ" options={zones.map((z) => ({ value: z.id, label: z.name }))} value={from.id} onChange={setFrom} />

      {zones.map((to) => {
        const route = routeByPair.get(pairKey(from.id, to.id));
        const list = route ? (faresByRoute.get(route.id) ?? []) : [];
        return (
          <ListRow key={to.id} onPress={() => setEditing({ from, to })}>
            <View style={ui.flex1}>
              <Text style={ui.strong}>
                → {to.name}
                {to.id === from.id ? ' (dans la zone)' : ''}
              </Text>
              <Text style={ui.small}>
                {list.length
                  ? models
                      .map((m) => {
                        const f = list.find((x) => x.model_id === m.id);
                        return f ? `${m.name} ${formatMoney(f.price)}` : null;
                      })
                      .filter(Boolean)
                      .join(' · ')
                  : 'Pas de prix'}
                {route ? ` · ${route.duration_minutes} min` : ''}
              </Text>
            </View>
            {list.length === 0 && <Badge label="À compléter" tone="warning" />}
          </ListRow>
        );
      })}

      <RouteSheet
        editing={editing}
        route={editing ? routeByPair.get(pairKey(editing.from.id, editing.to.id)) : undefined}
        fares={fares}
        models={models}
        onClose={() => setEditing(null)}
        onSaved={() => {
          setEditing(null);
          onChanged();
        }}
      />
    </Card>
  );
}

function RouteSheet({
  editing,
  route,
  fares,
  models,
  onClose,
  onSaved,
}: {
  editing: { from: Zone; to: Zone } | null;
  route: Route | undefined;
  fares: Fare[];
  models: Model[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [duration, setDuration] = useState('');
  const [prices, setPrices] = useState<Record<string, string>>({});
  const [openedFor, setOpenedFor] = useState<object | null>(null);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // Fill the form each time the sheet opens
  if (editing && openedFor !== editing) {
    setOpenedFor(editing);
    setErr(null);
    setDuration(String(route?.duration_minutes ?? 30));
    setPrices(
      Object.fromEntries(
        models.map((m) => {
          const f = route && fares.find((x) => x.route_id === route.id && x.model_id === m.id);
          return [m.id, f ? String(f.price) : ''];
        }),
      ),
    );
  }

  async function save() {
    if (!editing) return;
    const minutes = parseInt(duration, 10);
    if (!minutes || minutes < 5 || minutes > 600) return setErr('Durée du trajet entre 5 et 600 minutes.');
    const payload: Record<string, number | null> = {};
    for (const m of models) {
      const digits = (prices[m.id] ?? '').replace(/\D/g, '');
      payload[m.id] = digits ? parseInt(digits, 10) : null;
      if (payload[m.id] === 0) return setErr(`Prix invalide pour ${m.name}.`);
    }
    setSaving(true);
    setErr(null);
    const { error } = await supabase.rpc('save_ride_route', {
      p_from: editing.from.id,
      p_to: editing.to.id,
      p_duration_minutes: minutes,
      p_prices: payload,
    });
    setSaving(false);
    if (error) return setErr(errorMessage(error));
    onSaved();
  }

  return (
    <Sheet
      visible={!!editing}
      title={editing ? (editing.from.id === editing.to.id ? `Dans ${editing.from.name}` : `${editing.from.name} ↔ ${editing.to.name}`) : ''}
      onClose={onClose}
      footer={
        <>
          <Button title="Annuler" variant="ghost" onPress={onClose} />
          <Button title="Enregistrer" onPress={save} loading={saving} />
        </>
      }
    >
      <TextField
        label="Durée estimée du trajet (minutes)"
        keyboardType="number-pad"
        value={duration}
        onChangeText={setDuration}
        hint="Le véhicule est bloqué pendant ce temps, plus le temps d’approche du chauffeur (Paramètres)."
      />
      <Text style={ui.strong}>Prix par véhicule (FCFA)</Text>
      <FieldRow>
        {models.map((m) => (
          <TextField
            key={m.id}
            label={`${m.brand} ${m.name}`}
            keyboardType="number-pad"
            placeholder="Non proposé"
            value={prices[m.id] ?? ''}
            onChangeText={(t) => setPrices({ ...prices, [m.id]: t })}
          />
        ))}
      </FieldRow>
      <Notice text="Un nouveau prix s’applique aux nouvelles courses. Les courses déjà commandées gardent leur prix." />
      <FormError message={err} />
    </Sheet>
  );
}

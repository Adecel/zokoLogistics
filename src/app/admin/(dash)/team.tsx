import { useState } from 'react';
import { Text, View } from 'react-native';
import { RequirePermission } from '../../../components/admin/shell';
import {
  Avatar,
  Badge,
  Button,
  Card,
  Choice,
  Empty,
  FormError,
  ListRow,
  Notice,
  Page,
  SearchBox,
  Sheet,
  ui,
  useConfirm,
} from '../../../components/admin/ui';
import { LoadError, Loading } from '../../../components/load-state';
import { formatDate } from '../../../lib/admin/labels';
import { ROLE_DESCRIPTIONS, ROLE_LABELS, STAFF_ROLES, type Role } from '../../../lib/admin/roles';
import { errorMessage, unwrap, useLoad } from '../../../lib/admin/use-load';
import { useAuth } from '../../../lib/auth';
import { supabase } from '../../../lib/supabase';

type Member = {
  id: string;
  full_name: string;
  email: string | null;
  phone: string | null;
  role: Role;
  requested_role: Role | null;
  is_active: boolean;
  created_at: string;
};

const FIELDS = 'id, full_name, email, phone, role, requested_role, is_active, created_at';

export default function TeamScreen() {
  return (
    <RequirePermission permission="team">
      <Team />
    </RequirePermission>
  );
}

function Team() {
  const { profile } = useAuth();
  const confirm = useConfirm();
  const [err, setErr] = useState<string | null>(null);
  const [editing, setEditing] = useState<Member | null>(null);
  const [adding, setAdding] = useState(false);

  const { data, error, loading, reload } = useLoad(async () => {
    const [requests, members] = await Promise.all([
      supabase.from('profiles').select(FIELDS).not('requested_role', 'is', null).eq('role', 'client').order('created_at').then(unwrap),
      supabase.from('profiles').select(FIELDS).in('role', STAFF_ROLES).order('full_name').then(unwrap),
    ]);
    return { requests: requests as Member[], members: members as Member[] };
  }, []);

  async function update(m: Member, values: Partial<Member>, success?: () => void) {
    setErr(null);
    const { error: e } = await supabase.from('profiles').update(values).eq('id', m.id);
    if (e) return setErr(errorMessage(e));
    success?.();
    reload();
  }

  async function approve(m: Member, role: Role) {
    const ok = await confirm({
      title: `Accepter ${m.full_name}`,
      message: `Rôle : ${ROLE_LABELS[role]} — ${ROLE_DESCRIPTIONS[role] ?? ''}`,
      confirmLabel: 'Accepter',
    });
    if (ok !== null) await update(m, { role, requested_role: null });
  }

  async function reject(m: Member) {
    const ok = await confirm({
      title: `Refuser la demande de ${m.full_name}`,
      message: 'Le compte reste un simple compte client, sans accès au tableau de bord.',
      danger: true,
      confirmLabel: 'Refuser',
    });
    if (ok !== null) await update(m, { requested_role: null });
  }

  async function remove(m: Member) {
    const ok = await confirm({
      title: `Supprimer le compte de ${m.full_name}`,
      message: 'Le compte et son accès sont supprimés définitivement.',
      danger: true,
      confirmLabel: 'Supprimer',
    });
    if (ok === null) return;
    const { error: e } = await supabase.rpc('admin_delete_user', { p_user_id: m.id });
    if (e) setErr(errorMessage(e, 'Suppression impossible.'));
    else reload();
  }

  return (
    <Page
      title="Équipe"
      subtitle="Qui a accès au tableau de bord, et avec quels droits"
      onRefresh={reload}
      refreshing={false}
      actions={<Button title="Ajouter un membre" icon="person-add-outline" onPress={() => setAdding(true)} />}
    >
      <FormError message={err} />
      {loading && <Loading />}
      {error && <LoadError message={error} onRetry={reload} />}
      {data && (
        <>
          <Card title={`Demandes d’accès (${data.requests.length})`}>
            {data.requests.length === 0 && <Text style={ui.muted}>Aucune demande en attente.</Text>}
            {data.requests.map((m) => (
              <ListRow key={m.id}>
                <Avatar name={m.full_name} />
                <View style={ui.flex1}>
                  <Text style={ui.strong}>{m.full_name}</Text>
                  <Text style={ui.small}>
                    {m.email} · {m.phone ?? '—'} · le {formatDate(m.created_at)}
                  </Text>
                  <Text style={ui.small}>Demande : {ROLE_LABELS[m.requested_role!]}</Text>
                </View>
                <View style={[ui.wrap, { justifyContent: 'flex-end' }]}>
                  <Button title={`Accepter (${ROLE_LABELS[m.requested_role!]})`} small variant="success" icon="checkmark" onPress={() => approve(m, m.requested_role!)} />
                  <Button title="Autre rôle" small variant="outline" onPress={() => setEditing({ ...m, role: m.requested_role! })} />
                  <Button title="Refuser" small variant="danger" icon="close" onPress={() => reject(m)} />
                </View>
              </ListRow>
            ))}
          </Card>

          <Card title={`Membres (${data.members.length})`}>
            {data.members.map((m) => {
              const me = m.id === profile?.id;
              return (
                <ListRow key={m.id}>
                  <Avatar name={m.full_name} />
                  <View style={ui.flex1}>
                    <Text style={ui.strong}>
                      {m.full_name}
                      {me ? ' (vous)' : ''}
                    </Text>
                    <Text style={ui.small}>
                      {m.email ?? '—'} · {m.phone ?? '—'}
                    </Text>
                  </View>
                  <View style={{ alignItems: 'flex-end', gap: 6 }}>
                    <Badge label={ROLE_LABELS[m.role]} tone={m.role === 'admin' ? 'danger' : m.role === 'accountant' ? 'success' : 'info'} />
                    {!m.is_active && <Badge label="Désactivé" tone="neutral" />}
                  </View>
                  {!me && (
                    <View style={[ui.wrap, { justifyContent: 'flex-end' }]}>
                      <Button title="Rôle" small variant="outline" icon="swap-horizontal-outline" onPress={() => setEditing(m)} />
                      <Button
                        title={m.is_active ? 'Désactiver' : 'Réactiver'}
                        small
                        variant="ghost"
                        onPress={() => update(m, { is_active: !m.is_active })}
                      />
                      <Button title="Supprimer" small variant="danger" icon="trash-outline" onPress={() => remove(m)} />
                    </View>
                  )}
                </ListRow>
              );
            })}
          </Card>

          <Notice text="Admin : tous les droits et seul à pouvoir supprimer · Gérant : flotte, chauffeurs, réservations, clients, paramètres · Finance : paiements, remboursements, frais et rapports · Agent : réservations." />
        </>
      )}

      <RoleSheet
        key={editing ? `${editing.id}-${editing.role}` : 'none'}
        member={editing}
        onClose={() => setEditing(null)}
        onSave={(m, role) => update(m, { role, requested_role: null }, () => setEditing(null))}
      />
      <AddMemberSheet visible={adding} onClose={() => setAdding(false)} onDone={reload} />
    </Page>
  );
}

function RoleSheet({ member, onClose, onSave }: { member: Member | null; onClose: () => void; onSave: (m: Member, role: Role) => void }) {
  // Remounted for each member (key), so the choice starts from their current role
  const [role, setRole] = useState<Role>(!member || member.role === 'client' ? 'manager' : member.role);
  const options: Role[] = [...STAFF_ROLES, 'client'];
  return (
    <Sheet
      visible={!!member}
      title={`Rôle de ${member?.full_name ?? ''}`}
      onClose={onClose}
      footer={
        <>
          <Button title="Annuler" variant="ghost" onPress={onClose} />
          <Button title="Enregistrer" onPress={() => member && onSave(member, role)} />
        </>
      }
    >
      <Choice options={options.map((r) => ({ value: r, label: r === 'client' ? 'Retirer l’accès (client)' : ROLE_LABELS[r] }))} value={role} onChange={setRole} />
      <Text style={ui.muted}>{ROLE_DESCRIPTIONS[role] ?? 'Plus d’accès au tableau de bord.'}</Text>
    </Sheet>
  );
}

// Give a role to an existing account (found by e-mail, phone or name)
function AddMemberSheet({ visible, onClose, onDone }: { visible: boolean; onClose: () => void; onDone: () => void }) {
  const [search, setSearch] = useState('');
  const [results, setResults] = useState<Member[]>([]);
  const [role, setRole] = useState<Role>('manager');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function find() {
    const s = search.trim();
    if (s.length < 2) return;
    setBusy(true);
    setErr(null);
    const like = `%${s.replace(/[%,()]/g, '')}%`;
    const { data, error } = await supabase
      .from('profiles')
      .select(FIELDS)
      .eq('role', 'client')
      .or(`email.ilike.${like},phone.ilike.${like},full_name.ilike.${like}`)
      .limit(10);
    setBusy(false);
    if (error) return setErr(errorMessage(error));
    setResults(data as Member[]);
  }

  async function give(m: Member) {
    setErr(null);
    const { error } = await supabase.from('profiles').update({ role, requested_role: null }).eq('id', m.id);
    if (error) return setErr(errorMessage(error));
    setResults([]);
    setSearch('');
    onClose();
    onDone();
  }

  return (
    <Sheet visible={visible} title="Ajouter un membre" onClose={onClose}>
      <Text style={ui.muted}>
        La personne doit d’abord avoir un compte (application Zoko ou « Demander un accès »). Cherchez-la puis donnez-lui un rôle.
      </Text>
      <View style={ui.row}>
        <SearchBox value={search} onChangeText={setSearch} placeholder="E-mail, téléphone ou nom" />
        <Button title="Chercher" onPress={find} loading={busy} />
      </View>
      <Choice label="Rôle à donner" options={STAFF_ROLES.map((r) => ({ value: r, label: ROLE_LABELS[r] }))} value={role} onChange={setRole} />
      {results.length === 0 && search.length > 1 && !busy && <Empty icon="search" text="Lancez la recherche pour voir les comptes." />}
      {results.map((m) => (
        <ListRow key={m.id}>
          <Avatar name={m.full_name} size={34} />
          <View style={ui.flex1}>
            <Text style={ui.strong}>{m.full_name}</Text>
            <Text style={ui.small}>
              {m.email ?? '—'} · {m.phone ?? '—'}
            </Text>
          </View>
          <Button title={`Donner ${ROLE_LABELS[role]}`} small onPress={() => give(m)} />
        </ListRow>
      ))}
      <FormError message={err} />
    </Sheet>
  );
}

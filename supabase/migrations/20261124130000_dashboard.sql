-- =====================================================================
-- Tableau de bord de l'équipe Zoko
--
-- Rôles utilisés par le tableau de bord :
--   admin       Admin    : tous les droits, seul à pouvoir supprimer
--   accountant  Finance  : paiements, remboursements, frais, rapports
--   manager     Gérant   : flotte, chauffeurs, réservations, clients, paramètres
--   (agent      Agent    : suit et confirme les réservations)
--
-- Inscription au tableau de bord = demande d'accès (profiles.requested_role).
-- Un admin l'accepte en donnant le rôle. Le tout premier admin se crée à la
-- main dans le SQL Editor :
--   update public.profiles set role = 'admin' where email = 'votre@email.com';
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1. Demandes d'accès à l'équipe
-- ---------------------------------------------------------------------
alter table public.profiles add column if not exists requested_role public.user_role;
comment on column public.profiles.requested_role is
  'Rôle demandé à l''inscription sur le tableau de bord, en attente de validation par un admin.';

create or replace function public.handle_new_user()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_requested text := new.raw_user_meta_data ->> 'requested_role';
begin
  insert into public.profiles (id, full_name, phone, email, requested_role)
  values (
    new.id,
    coalesce(nullif(trim(new.raw_user_meta_data ->> 'full_name'), ''), 'Client Zoko'),
    coalesce(nullif(trim(new.raw_user_meta_data ->> 'phone'), ''), new.phone),
    coalesce(nullif(lower(trim(new.raw_user_meta_data ->> 'email')), ''), new.email),
    -- seulement un rôle d'équipe ; le rôle réel reste « client » jusqu'à validation
    case when v_requested in ('admin', 'accountant', 'manager', 'agent')
         then v_requested::public.user_role end
  );
  return new;
end;
$$;


-- ---------------------------------------------------------------------
-- 2. Rôles
-- ---------------------------------------------------------------------
create or replace function public.is_admin()
returns boolean
language sql stable security definer set search_path = ''
as $$
  select coalesce(public.current_user_role() = 'admin', false)
$$;

-- Garde-fou des profils :
--  - seul un admin change un rôle ou une demande d'accès
--  - la gérante peut activer / désactiver un client ou un chauffeur
create or replace function public.profiles_guard()
returns trigger
language plpgsql set search_path = ''
as $$
begin
  if coalesce(current_setting('zoko.account_deletion', true), '') = 'on'
     or coalesce(current_setting('zoko.admin_action', true), '') = 'on' then
    return new;
  end if;
  if auth.uid() is null then
    return new;  -- SQL Editor / tâches planifiées
  end if;

  if (new.role is distinct from old.role or new.requested_role is distinct from old.requested_role)
     and not public.is_admin() then
    raise exception 'Seul un administrateur peut modifier le rôle d''un compte';
  end if;

  if new.is_active is distinct from old.is_active and not public.is_admin() then
    if not (public.is_manager() and old.role in ('client', 'driver')) then
      raise exception 'Vous ne pouvez pas modifier le statut de ce compte';
    end if;
  end if;

  if new.id = auth.uid() and old.role = 'admin'
     and (new.role <> 'admin' or not new.is_active) then
    raise exception 'Vous ne pouvez pas retirer vos propres droits d''administrateur';
  end if;

  -- La gérante ne modifie pas les comptes de l'équipe (sauf le sien)
  if new.id <> auth.uid() and not public.is_admin()
     and old.role in ('admin', 'manager', 'accountant', 'agent') then
    raise exception 'Seul un administrateur peut modifier un compte de l''équipe';
  end if;

  return new;
end;
$$;


-- ---------------------------------------------------------------------
-- 3. Droits : la gérante crée et modifie, seul l'admin supprime.
--    Finance gère les frais en plus des paiements.
-- ---------------------------------------------------------------------
drop policy if exists "models: gestion" on public.vehicle_models;
create policy "models: ajout" on public.vehicle_models
  for insert to authenticated with check (public.is_manager());
create policy "models: modification" on public.vehicle_models
  for update to authenticated using (public.is_manager()) with check (public.is_manager());
create policy "models: suppression" on public.vehicle_models
  for delete to authenticated using (public.is_admin());

-- Photos : retirer une photo fait partie de la modification d'un véhicule
drop policy if exists "photos: gestion" on public.vehicle_photos;
create policy "photos: gestion" on public.vehicle_photos
  for all to authenticated using (public.is_manager()) with check (public.is_manager());

drop policy if exists "vehicles: gestion" on public.vehicles;
create policy "vehicles: ajout" on public.vehicles
  for insert to authenticated with check (public.is_manager());
create policy "vehicles: modification" on public.vehicles
  for update to authenticated using (public.is_manager()) with check (public.is_manager());
create policy "vehicles: suppression" on public.vehicles
  for delete to authenticated using (public.is_admin());

drop policy if exists "rates: gestion" on public.rates;
create policy "rates: ajout" on public.rates
  for insert to authenticated with check (public.is_manager());
create policy "rates: modification" on public.rates
  for update to authenticated using (public.is_manager()) with check (public.is_manager());
create policy "rates: suppression" on public.rates
  for delete to authenticated using (public.is_admin());

drop policy if exists "drivers: gestion" on public.drivers;
create policy "drivers: ajout" on public.drivers
  for insert to authenticated with check (public.is_manager());
create policy "drivers: modification" on public.drivers
  for update to authenticated using (public.is_manager()) with check (public.is_manager());
create policy "drivers: suppression" on public.drivers
  for delete to authenticated using (public.is_admin());

drop policy if exists "promotions: gestion" on public.promotions;
create policy "promotions: ajout" on public.promotions
  for insert to authenticated with check (public.is_manager());
create policy "promotions: modification" on public.promotions
  for update to authenticated using (public.is_manager()) with check (public.is_manager());
create policy "promotions: suppression" on public.promotions
  for delete to authenticated using (public.is_admin());

drop policy if exists "settings: gestion" on public.app_settings;
create policy "settings: modification" on public.app_settings
  for update to authenticated using (public.is_manager()) with check (public.is_manager());
create policy "settings: ajout" on public.app_settings
  for insert to authenticated with check (public.is_admin());
create policy "settings: suppression" on public.app_settings
  for delete to authenticated using (public.is_admin());

drop policy if exists "reservations: suppression" on public.reservations;
create policy "reservations: suppression" on public.reservations
  for delete to authenticated using (public.is_admin());

drop policy if exists "charges: gestion" on public.reservation_charges;
create policy "charges: ajout" on public.reservation_charges
  for insert to authenticated
  with check (public.is_staff() or public.current_user_role() = 'accountant');
create policy "charges: modification" on public.reservation_charges
  for update to authenticated
  using (public.is_staff() or public.current_user_role() = 'accountant')
  with check (public.is_staff() or public.current_user_role() = 'accountant');
create policy "charges: suppression" on public.reservation_charges
  for delete to authenticated using (public.is_admin());

drop policy if exists "payments: suppression" on public.payments;
create policy "payments: suppression" on public.payments
  for delete to authenticated using (public.is_admin());

-- Les chauffeurs sont visibles par Finance (rapports)
drop policy if exists "drivers: lecture" on public.drivers;
create policy "drivers: lecture" on public.drivers
  for select to authenticated using (profile_id = auth.uid() or public.can_view_finance());

-- Photos des chauffeurs : même espace public que les véhicules, dossier drivers/
-- (géré par la politique « vehicle photos: gestion gérante » existante)


-- ---------------------------------------------------------------------
-- 4. Créer un chauffeur depuis le tableau de bord
--    Un chauffeur a un compte (pour une future app chauffeur) ; il est créé
--    ici sans mot de passe utilisable. Il pourra le définir plus tard.
-- ---------------------------------------------------------------------
create or replace function public.admin_create_driver(
  p_full_name text,
  p_phone text,
  p_email text default null,
  p_license_number text default null,
  p_license_expires_on date default null,
  p_notes text default null,
  p_avatar_url text default null
)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  v_id    uuid := gen_random_uuid();
  v_email text := nullif(lower(trim(coalesce(p_email, ''))), '');
  v_phone text := nullif(trim(coalesce(p_phone, '')), '');
begin
  if not public.is_manager() then
    raise exception 'Action réservée à la gérante et à l''administrateur';
  end if;
  if length(trim(coalesce(p_full_name, ''))) < 2 then
    raise exception 'Indiquez le nom du chauffeur';
  end if;
  if v_phone is null then
    raise exception 'Indiquez le téléphone du chauffeur';
  end if;
  if exists (select 1 from public.profiles where public.phone_digits(phone) = public.phone_digits(v_phone)) then
    raise exception 'Ce numéro est déjà utilisé par un autre compte';
  end if;
  if v_email is not null and exists (select 1 from auth.users where lower(email) = v_email) then
    raise exception 'Cette adresse e-mail est déjà utilisée par un autre compte';
  end if;

  insert into auth.users (
    instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
    confirmation_token, recovery_token, email_change_token_new, email_change
  ) values (
    '00000000-0000-0000-0000-000000000000', v_id, 'authenticated', 'authenticated',
    coalesce(v_email, 'chauffeur-' || public.phone_digits(v_phone) || '@chauffeurs.zoko.invalid'),
    '', now(),
    '{"provider": "email", "providers": ["email"]}'::jsonb,
    jsonb_build_object('full_name', trim(p_full_name), 'phone', v_phone, 'email', v_email),
    now(), now(), '', '', '', ''
  );

  -- Le profil est créé par handle_new_user ; on lui donne le rôle chauffeur
  perform set_config('zoko.admin_action', 'on', true);
  update public.profiles
     set role = 'driver', avatar_url = nullif(trim(coalesce(p_avatar_url, '')), '')
   where id = v_id;
  perform set_config('zoko.admin_action', 'off', true);

  insert into public.drivers (profile_id, license_number, license_expires_on, notes)
  values (v_id, nullif(trim(coalesce(p_license_number, '')), ''), p_license_expires_on, nullif(trim(coalesce(p_notes, '')), ''));

  return v_id;
end;
$$;

revoke execute on function public.admin_create_driver(text, text, text, text, date, text, text) from public, anon;
grant execute on function public.admin_create_driver(text, text, text, text, date, text, text) to authenticated;


-- ---------------------------------------------------------------------
-- 5. Supprimer un compte (admin seulement)
--    Sans historique : suppression complète.
--    Avec des réservations : anonymisé et désactivé (la comptabilité garde l'historique).
-- ---------------------------------------------------------------------
create or replace function public.admin_delete_user(p_user_id uuid)
returns text
language plpgsql security definer set search_path = ''
as $$
declare
  v_role public.user_role;
begin
  if not public.is_admin() then
    raise exception 'Action réservée à l''administrateur';
  end if;
  if p_user_id = auth.uid() then
    raise exception 'Vous ne pouvez pas supprimer votre propre compte ici';
  end if;
  select role into v_role from public.profiles where id = p_user_id;
  if v_role is null then
    raise exception 'Compte introuvable';
  end if;
  if exists (
    select 1 from public.reservations
    where (client_id = p_user_id or driver_id = p_user_id) and status in ('confirmed', 'in_progress')
  ) then
    raise exception 'Ce compte a une location confirmée ou en cours. Terminez-la ou réattribuez-la d''abord.';
  end if;

  delete from public.notifications where user_id = p_user_id;
  -- Demandes en attente du client : annulées
  update public.reservations
     set status = 'cancelled', cancellation_reason = 'Compte supprimé par Zoko'
   where client_id = p_user_id and status = 'pending';
  -- Chauffeur demandé sur des réservations en attente : Zoko en choisira un autre
  update public.reservations set driver_id = null where driver_id = p_user_id and status = 'pending';

  if not exists (select 1 from public.reservations where client_id = p_user_id or driver_id = p_user_id) then
    delete from auth.users where id = p_user_id;  -- profil et fiche chauffeur suivent en cascade
    return 'deleted';
  end if;

  perform set_config('zoko.account_deletion', 'on', true);
  update public.profiles
     set full_name = 'Compte supprimé', phone = null, email = null, avatar_url = null,
         is_active = false, requested_role = null
   where id = p_user_id;
  update public.drivers set is_available = false where profile_id = p_user_id;
  update auth.users
     set email = 'supprime-' || p_user_id || '@compte-supprime.invalid',
         phone = null, encrypted_password = '', raw_user_meta_data = '{}'::jsonb,
         banned_until = 'infinity'
   where id = p_user_id;
  delete from auth.identities where user_id = p_user_id;
  delete from auth.sessions where user_id = p_user_id;
  return 'anonymized';
end;
$$;

revoke execute on function public.admin_delete_user(uuid) from public, anon;
grant execute on function public.admin_delete_user(uuid) to authenticated;


-- ---------------------------------------------------------------------
-- 6. Véhicules libres pour confirmer une réservation
-- ---------------------------------------------------------------------
create or replace function public.vehicles_for_reservation(p_reservation_id uuid)
returns table (vehicle_id uuid, plate_number text, color text, status public.vehicle_status, is_free boolean)
language sql stable security definer set search_path = ''
as $$
  select v.id, v.plate_number, v.color, v.status,
         v.status = 'available' and not exists (
           select 1 from public.reservations o
           where o.vehicle_id = v.id
             and o.id <> r.id
             and o.status in ('confirmed', 'in_progress')
             and tstzrange(o.start_at, o.end_at) && tstzrange(r.start_at, r.end_at))
  from public.reservations r
  join public.vehicles v on v.model_id = r.model_id
  where r.id = p_reservation_id
    and public.can_view_finance()
  order by v.plate_number
$$;

revoke execute on function public.vehicles_for_reservation(uuid) from public, anon;
grant execute on function public.vehicles_for_reservation(uuid) to authenticated;


-- ---------------------------------------------------------------------
-- 7. Chiffres de l'accueil du tableau de bord (une seule requête)
-- ---------------------------------------------------------------------
create or replace function public.dashboard_stats()
returns jsonb
language sql stable security definer set search_path = ''
as $$
  with tz as (select coalesce(public.setting('timezone') #>> '{}', 'Africa/Brazzaville') as name)
  select case when not public.can_view_finance() then null else jsonb_build_object(
    'pending_reservations', (select count(*) from public.reservations where status = 'pending'),
    'upcoming_confirmed', (select count(*) from public.reservations where status = 'confirmed' and start_at > now()),
    'in_progress', (select count(*) from public.reservations where status = 'in_progress'),
    'today_departures', (select count(*) from public.reservations, tz
                         where status in ('confirmed', 'in_progress')
                           and (start_at at time zone tz.name)::date = (now() at time zone tz.name)::date),
    'payments_to_verify', (select count(*) from public.payments where status = 'pending'),
    'payments_to_verify_amount', (select coalesce(sum(amount), 0) from public.payments where status = 'pending' and kind = 'payment'),
    'revenue_month', (select coalesce(sum(case kind when 'payment' then amount else -amount end), 0)
                      from public.payments, tz
                      where status = 'succeeded'
                        and date_trunc('month', paid_at at time zone tz.name) = date_trunc('month', now() at time zone tz.name)),
    'unpaid_balance', (select coalesce(sum(balance), 0) from public.reservation_balances
                       where status in ('pending', 'confirmed', 'in_progress', 'completed') and balance > 0),
    'vehicles_total', (select count(*) from public.vehicles),
    'vehicles_available', (select count(*) from public.vehicles where status = 'available'),
    'drivers_available', (select count(*) from public.drivers d join public.profiles p on p.id = d.profile_id
                          where d.is_available and p.is_active),
    'clients_total', (select count(*) from public.profiles where role = 'client' and is_active and requested_role is null),
    'access_requests', (select count(*) from public.profiles where requested_role is not null and role = 'client')
  ) end
$$;

revoke execute on function public.dashboard_stats() from public, anon;
grant execute on function public.dashboard_stats() to authenticated;


-- ---------------------------------------------------------------------
-- 8. Notification à l'admin pour chaque demande d'accès
-- ---------------------------------------------------------------------
create or replace function public.profiles_access_request_notify()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if new.requested_role is not null and (tg_op = 'INSERT' or old.requested_role is null) then
    insert into public.notifications (user_id, type, title, body)
    select p.id, 'other', 'Demande d''accès au tableau de bord',
           new.full_name || coalesce(' · ' || new.email, '') || ' demande le rôle ' ||
           case new.requested_role::text
             when 'admin' then 'Admin' when 'accountant' then 'Finance'
             when 'manager' then 'Gérant' when 'agent' then 'Agent' else new.requested_role::text end
    from public.profiles p
    where p.role = 'admin' and p.is_active and p.id <> new.id;
  end if;
  return new;
end;
$$;

drop trigger if exists profiles_access_request_notify on public.profiles;
create trigger profiles_access_request_notify
  after insert or update of requested_role on public.profiles
  for each row execute function public.profiles_access_request_notify();


-- ---------------------------------------------------------------------
-- 9. Un compte désactivé ne peut plus réserver
-- ---------------------------------------------------------------------
drop policy if exists "reservations: création" on public.reservations;
create policy "reservations: création" on public.reservations
  for insert to authenticated
  with check (
    (client_id = auth.uid() and exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_active))
    or public.is_staff()
  );

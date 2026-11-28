-- =====================================================================
-- Réservations, Paiements, Promotions : réservés à Finance (et Admin)
--
--  - Réservations : Finance (lecture), Agents (confirmer, attribuer,
--    démarrer, terminer) et Admin.
--  - Paiements, remboursements, frais, promotions, rapports : Finance et Admin.
--  - Le gérant n'y a plus accès (flotte, chauffeurs, partenaires, clients,
--    paramètres restent à lui) et ne reçoit plus ces notifications.
--  - Les agents voient les paiements d'une réservation (pour savoir si elle
--    est payée) mais ne les valident plus.
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1. Qui peut quoi
-- ---------------------------------------------------------------------
create or replace function public.can_see_reservations()
returns boolean
language sql stable security definer set search_path = ''
as $$
  select coalesce(public.current_user_role() in ('admin', 'accountant', 'agent'), false)
$$;

create or replace function public.can_operate_reservations()
returns boolean
language sql stable security definer set search_path = ''
as $$
  select coalesce(public.current_user_role() in ('admin', 'agent'), false)
$$;

create or replace function public.can_handle_money()
returns boolean
language sql stable security definer set search_path = ''
as $$
  select coalesce(public.current_user_role() in ('admin', 'accountant'), false)
$$;


-- ---------------------------------------------------------------------
-- 2. Règles d'accès aux tables
-- ---------------------------------------------------------------------
drop policy if exists "reservations: lecture" on public.reservations;
create policy "reservations: lecture" on public.reservations
  for select to authenticated
  using (client_id = auth.uid() or driver_id = auth.uid() or public.can_see_reservations());

drop policy if exists "reservations: création" on public.reservations;
create policy "reservations: création" on public.reservations
  for insert to authenticated
  with check (
    (client_id = auth.uid() and exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_active))
    or public.can_operate_reservations()
  );

drop policy if exists "reservations: modification équipe" on public.reservations;
create policy "reservations: modification équipe" on public.reservations
  for update to authenticated
  using (public.can_operate_reservations()) with check (public.can_operate_reservations());

drop policy if exists "history: lecture" on public.reservation_status_history;
create policy "history: lecture" on public.reservation_status_history
  for select to authenticated
  using (public.can_see_reservations() or exists (
    select 1 from public.reservations r
    where r.id = reservation_id and (r.client_id = auth.uid() or r.driver_id = auth.uid())));

drop policy if exists "charges: lecture" on public.reservation_charges;
create policy "charges: lecture" on public.reservation_charges
  for select to authenticated
  using (public.can_see_reservations() or exists (
    select 1 from public.reservations r where r.id = reservation_id and r.client_id = auth.uid()));
drop policy if exists "charges: ajout" on public.reservation_charges;
create policy "charges: ajout" on public.reservation_charges
  for insert to authenticated with check (public.can_handle_money());
drop policy if exists "charges: modification" on public.reservation_charges;
create policy "charges: modification" on public.reservation_charges
  for update to authenticated using (public.can_handle_money()) with check (public.can_handle_money());

drop policy if exists "payments: lecture" on public.payments;
create policy "payments: lecture" on public.payments
  for select to authenticated
  using (public.can_see_reservations() or exists (
    select 1 from public.reservations r where r.id = reservation_id and r.client_id = auth.uid()));
drop policy if exists "payments: déclaration" on public.payments;
create policy "payments: déclaration" on public.payments
  for insert to authenticated
  with check (public.can_handle_money() or exists (
    select 1 from public.reservations r where r.id = reservation_id and r.client_id = auth.uid()));
drop policy if exists "payments: validation" on public.payments;
create policy "payments: validation" on public.payments
  for update to authenticated using (public.can_handle_money()) with check (public.can_handle_money());

drop policy if exists "payment proofs: lecture" on storage.objects;
create policy "payment proofs: lecture" on storage.objects
  for select to authenticated
  using (bucket_id = 'payment-proofs'
         and ((storage.foldername(name))[1] = auth.uid()::text or public.can_handle_money()));

drop policy if exists "promotions: lecture" on public.promotions;
create policy "promotions: lecture" on public.promotions
  for select to authenticated
  using ((is_active and starts_at <= now() and (ends_at is null or ends_at > now())) or public.can_handle_money());
drop policy if exists "promotions: ajout" on public.promotions;
create policy "promotions: ajout" on public.promotions
  for insert to authenticated with check (public.can_handle_money());
drop policy if exists "promotions: modification" on public.promotions;
create policy "promotions: modification" on public.promotions
  for update to authenticated using (public.can_handle_money()) with check (public.can_handle_money());


-- ---------------------------------------------------------------------
-- 3. Accueil du tableau de bord : chaque rôle ne reçoit que ses chiffres
-- ---------------------------------------------------------------------
create or replace function public.dashboard_stats()
returns jsonb
language sql stable security definer set search_path = ''
as $$
  with tz as (select coalesce(public.setting('timezone') #>> '{}', 'Africa/Brazzaville') as name)
  select case when not public.can_view_finance() then null else
    jsonb_build_object(
      'vehicles_total', (select count(*) from public.vehicles),
      'vehicles_available', (select count(*) from public.vehicles where status = 'available'),
      'drivers_available', (select count(*) from public.drivers d join public.profiles p on p.id = d.profile_id
                            where d.is_available and p.is_active),
      'clients_total', (select count(*) from public.profiles where role = 'client' and is_active and requested_role is null),
      'access_requests', (select count(*) from public.profiles where requested_role is not null and role = 'client')
    )
    || case when public.can_see_reservations() then jsonb_build_object(
      'pending_reservations', (select count(*) from public.reservations where status = 'pending'),
      'upcoming_confirmed', (select count(*) from public.reservations where status = 'confirmed' and start_at > now()),
      'in_progress', (select count(*) from public.reservations where status = 'in_progress'),
      'today_departures', (select count(*) from public.reservations, tz
                           where status in ('confirmed', 'in_progress')
                             and (start_at at time zone tz.name)::date = (now() at time zone tz.name)::date)
    ) else '{}'::jsonb end
    || case when public.can_handle_money() then jsonb_build_object(
      'payments_to_verify', (select count(*) from public.payments where status = 'pending'),
      'payments_to_verify_amount', (select coalesce(sum(amount), 0) from public.payments where status = 'pending' and kind = 'payment'),
      'revenue_month', (select coalesce(sum(case kind when 'payment' then amount else -amount end), 0)
                        from public.payments, tz
                        where status = 'succeeded'
                          and date_trunc('month', paid_at at time zone tz.name) = date_trunc('month', now() at time zone tz.name)),
      'unpaid_balance', (select coalesce(sum(balance), 0) from public.reservation_balances
                         where status in ('pending', 'confirmed', 'in_progress', 'completed') and balance > 0)
    ) else '{}'::jsonb end
  end
$$;


-- ---------------------------------------------------------------------
-- 4. Fonctions reprises de leur dernière version : seuls les rôles changent
--    (notifications : le gérant est remplacé par l'admin ; paiements : Finance)
-- ---------------------------------------------------------------------
-- (d'après 20261128120000_rides.sql)
create or replace function public.reservations_after_write()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_tz    text := coalesce(public.setting('timezone') #>> '{}', 'Africa/Brazzaville');
  v_ride  boolean := new.kind = 'ride';
  v_title text;
  v_type  public.notification_type;
  v_when  text;
begin
  if tg_op = 'INSERT' or new.status is distinct from old.status then
    insert into public.reservation_status_history (reservation_id, from_status, to_status, changed_by, note)
    values (
      new.id,
      case when tg_op = 'UPDATE' then old.status end,
      new.status,
      auth.uid(),
      case when new.status in ('cancelled', 'rejected') then new.cancellation_reason end
    );
  end if;

  if v_ride then
    select f.name || ' → ' || t.name into v_when
    from public.ride_zones f, public.ride_zones t
    where f.id = new.from_zone_id and t.id = new.to_zone_id;
    v_when := coalesce(v_when, 'Course') || ' · ' || to_char(new.start_at at time zone v_tz, 'HH24:MI');
  else
    v_when := to_char(new.start_at at time zone v_tz, 'DD/MM/YYYY à HH24:MI') || ' · ' || new.duration_hours || ' h';
  end if;

  -- Nouvelle demande : confirmer au client, prévenir l'équipe
  if tg_op = 'INSERT' then
    insert into public.notifications (user_id, type, title, body, reservation_id)
    values (
      new.client_id, 'reservation_created',
      case when v_ride then 'Demande de course envoyée' else 'Demande de réservation envoyée' end,
      new.reference || ' · ' || v_when || case when v_ride
        then '. Un agent vous attribue un véhicule et un chauffeur.'
        else '. Un agent va la vérifier et la confirmer.' end,
      new.id);

    insert into public.notifications (user_id, type, title, body, reservation_id)
    select p.id, 'reservation_created',
           case when v_ride then 'Nouvelle course immédiate ' else 'Nouvelle réservation ' end || new.reference,
           case when v_ride then v_when else 'Début le ' || v_when end,
           new.id
    from public.profiles p
    where p.role in ('agent', 'admin') and p.is_active and p.id <> new.client_id;
    return new;
  end if;

  -- Changement de statut : prévenir le client
  if new.status is distinct from old.status then
    v_type := case new.status
      when 'confirmed'   then 'reservation_confirmed'
      when 'rejected'    then 'reservation_rejected'
      when 'cancelled'   then 'reservation_cancelled'
      when 'in_progress' then 'rental_started'
      when 'completed'   then 'rental_ended'
      when 'pending'     then 'reservation_updated'
      else null
    end::public.notification_type;
    v_title := case
      when v_ride then case new.status
        when 'confirmed'   then 'Course confirmée : votre chauffeur arrive'
        when 'rejected'    then 'Course refusée'
        when 'cancelled'   then 'Course annulée'
        when 'in_progress' then 'Votre course a commencé'
        when 'completed'   then 'Course terminée'
        else null end
      else case new.status
        when 'confirmed'   then 'Réservation confirmée'
        when 'rejected'    then 'Réservation refusée'
        when 'cancelled'   then 'Réservation annulée'
        when 'in_progress' then 'Votre location a commencé'
        when 'completed'   then 'Location terminée'
        when 'pending'     then 'Réservation modifiée, en attente de confirmation'
        else null end
    end;
    if v_type is not null and v_title is not null then
      insert into public.notifications (user_id, type, title, body, reservation_id)
      values (new.client_id, v_type, v_title,
              case when v_ride then 'Course ' else 'Réservation ' end || new.reference || ' · ' || v_when, new.id);

      -- Début / fin, annulations et modifications : prévenir aussi l'équipe
      if new.status in ('in_progress', 'completed', 'cancelled', 'pending') then
        insert into public.notifications (user_id, type, title, body, reservation_id)
        select p.id, v_type, v_title || ' · ' || new.reference, v_when, new.id
        from public.profiles p
        where p.is_active and p.id <> new.client_id
          and (p.role = 'admin' or (p.role = 'agent' and new.status in ('cancelled', 'pending')));
      end if;
    end if;
  end if;

  return new;
end;
$$;

-- (d'après 20261122210000_more_notifications.sql)
create or replace function public.payments_after_write()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_res    public.reservations;
  v_amount text := replace(to_char(new.amount, 'FM999G999G999'), ',', ' ') || ' FCFA';
  v_method text := case new.method::text
    when 'cash' then 'Espèces'
    when 'airtel_money' then 'Airtel Money'
    when 'mtn_mobile_money' then 'Mobile Money'
    when 'bank_transfer' then 'Virement'
    else new.method::text
  end;
begin
  select * into v_res from public.reservations where id = new.reservation_id;

  -- Paiement déclaré par le client (en attente de vérification)
  if tg_op = 'INSERT' and new.kind = 'payment' and new.status = 'pending' then
    insert into public.notifications (user_id, type, title, body, reservation_id)
    values (
      v_res.client_id, 'payment_received',
      case when new.method::text = 'cash' then 'Paiement en espèces choisi' else 'Paiement déclaré' end,
      case when new.method::text = 'cash'
        then v_amount || ' à remettre au chauffeur au départ · ' || v_res.reference
        else v_amount || ' par ' || v_method || ' · en cours de vérification · ' || v_res.reference
      end,
      v_res.id);

    insert into public.notifications (user_id, type, title, body, reservation_id)
    select p.id, 'payment_received',
           case when new.method::text = 'cash' then 'Paiement espèces prévu · ' else 'Paiement à vérifier · ' end
             || v_res.reference,
           v_amount || ' · ' || v_method || case when new.proof_path is not null then ' · preuve jointe' else '' end,
           v_res.id
    from public.profiles p
    where p.role in ('accountant', 'admin') and p.is_active and p.id <> v_res.client_id;
  end if;

  -- Paiement validé ou remboursement effectué
  if new.status = 'succeeded' and (tg_op = 'INSERT' or old.status <> 'succeeded') then
    insert into public.notifications (user_id, type, title, body, reservation_id)
    values (
      v_res.client_id,
      case new.kind when 'refund' then 'payment_refunded' else 'payment_received' end::public.notification_type,
      case new.kind when 'refund' then 'Remboursement effectué' else 'Paiement validé' end,
      v_amount || ' · Réservation ' || v_res.reference,
      v_res.id);

    insert into public.notifications (user_id, type, title, body, reservation_id)
    select p.id,
           case new.kind when 'refund' then 'payment_refunded' else 'payment_received' end::public.notification_type,
           case new.kind when 'refund' then 'Remboursement ' else 'Paiement validé ' end || v_res.reference,
           v_amount || ' · ' || v_method,
           v_res.id
    from public.profiles p
    where p.role in ('accountant', 'admin') and p.is_active and p.id <> v_res.client_id;
  end if;

  -- Paiement refusé par l'équipe
  if tg_op = 'UPDATE' and new.status = 'failed' and old.status <> 'failed' then
    insert into public.notifications (user_id, type, title, body, reservation_id)
    values (v_res.client_id, 'other', 'Paiement non validé',
            v_amount || ' · ' || v_method || ' · ' || coalesce(new.notes, 'Contactez Zoko ou choisissez un autre moyen.'),
            v_res.id);
  end if;

  return new;
end;
$$;

-- (d'après 20261122200000_payment_cash_and_proofs.sql)
create or replace function public.payments_before_write()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if not public.can_handle_money() and auth.uid() is not null then
    -- Le client déclare son paiement ; un agent le valide ensuite
    if tg_op = 'UPDATE' then
      raise exception 'Action non autorisée';
    end if;
    if not exists (select 1 from public.reservations r where r.id = new.reservation_id and r.client_id = auth.uid()) then
      raise exception 'Réservation introuvable';
    end if;
    -- La preuve doit être dans le dossier du client
    if new.proof_path is not null and split_part(new.proof_path, '/', 1) <> auth.uid()::text then
      raise exception 'Preuve de paiement invalide';
    end if;
    new.kind := 'payment';
    new.status := 'pending';
    new.paid_at := null;
    new.verified_by := null;
    new.verified_at := null;
    if new.method::text = 'cash' then
      new.transaction_reference := null;  -- encaissé par le chauffeur, validé ensuite par l'équipe
    end if;
  end if;

  if tg_op = 'INSERT' then
    new.recorded_by := coalesce(new.recorded_by, auth.uid());
  end if;

  if new.status = 'succeeded' and (tg_op = 'INSERT' or old.status <> 'succeeded') then
    new.paid_at := coalesce(new.paid_at, now());
    new.verified_at := coalesce(new.verified_at, now());
    new.verified_by := coalesce(new.verified_by, auth.uid());
  end if;
  return new;
end;
$$;

-- (d'après 20261129120000_partners.sql)
create or replace function public.create_reminders()
returns integer
language plpgsql security definer set search_path = ''
as $$
declare
  v_tz    text := coalesce(public.setting('timezone') #>> '{}', 'Africa/Brazzaville');
  v_total integer := 0;
  v_n     integer;
begin
  insert into public.notifications (user_id, type, title, body, reservation_id)
  select r.client_id, 'rental_reminder', 'Rappel : votre location approche',
         to_char(r.start_at at time zone v_tz, 'DD/MM à HH24:MI') || ' · ' || m.brand || ' ' || m.name
           || ' · ' || r.pickup_address,
         r.id
  from public.reservations r
  join public.vehicle_models m on m.id = r.model_id
  where r.kind = 'rental'
    and r.status = 'confirmed'
    and r.start_at between now() + interval '3 hours' and now() + interval '24 hours'
    and not exists (
      select 1 from public.notifications n
      where n.reservation_id = r.id and n.user_id = r.client_id and n.title = 'Rappel : votre location approche');
  get diagnostics v_n = row_count;
  v_total := v_total + v_n;

  insert into public.notifications (user_id, type, title, body, reservation_id)
  select r.client_id, 'rental_reminder', 'Départ dans moins de 2 heures',
         'Votre chauffeur vous retrouve à ' || to_char(r.start_at at time zone v_tz, 'HH24:MI')
           || ' · ' || r.pickup_address || '. Pensez à votre pièce d''identité.',
         r.id
  from public.reservations r
  where r.kind = 'rental'
    and r.status = 'confirmed'
    and r.start_at between now() and now() + interval '2 hours'
    and not exists (
      select 1 from public.notifications n
      where n.reservation_id = r.id and n.user_id = r.client_id and n.title = 'Départ dans moins de 2 heures');
  get diagnostics v_n = row_count;
  v_total := v_total + v_n;

  insert into public.notifications (user_id, type, title, body, reservation_id)
  select r.client_id, 'other', 'Paiement en attente',
         'Payez la réservation ' || r.reference || ' pour qu''un agent puisse la confirmer.',
         r.id
  from public.reservations r
  where r.kind = 'rental'
    and r.status = 'pending'
    and r.total_price > 0
    and r.created_at < now() - interval '2 hours'
    and r.start_at > now()
    and not exists (
      select 1 from public.payments p
      where p.reservation_id = r.id and p.kind = 'payment' and p.status in ('pending', 'succeeded'))
    and not exists (
      select 1 from public.notifications n
      where n.reservation_id = r.id and n.user_id = r.client_id and n.title = 'Paiement en attente');
  get diagnostics v_n = row_count;
  v_total := v_total + v_n;

  insert into public.notifications (user_id, type, title, body, reservation_id)
  select p.id, 'other', 'Chauffeur à attribuer · ' || r.reference,
         'Départ le ' || to_char(r.start_at at time zone v_tz, 'DD/MM à HH24:MI') || ' · ' || r.pickup_address,
         r.id
  from public.reservations r
  cross join public.profiles p
  where r.status = 'confirmed'
    and r.with_driver
    and not r.driven_by_owner
    and r.driver_id is null
    and r.start_at between now() - interval '2 hours' and now() + interval '24 hours'
    and p.role in ('agent', 'admin') and p.is_active
    and not exists (
      select 1 from public.notifications n
      where n.reservation_id = r.id and n.user_id = p.id and n.title = 'Chauffeur à attribuer · ' || r.reference);
  get diagnostics v_n = row_count;
  v_total := v_total + v_n;

  return v_total;
end;
$$;

-- (d'après 20261129120000_partners.sql)
create or replace function public.partner_decline_mission(p_reservation_id uuid, p_reason text)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_res public.reservations;
  v_tz  text := coalesce(public.setting('timezone') #>> '{}', 'Africa/Brazzaville');
begin
  select r.* into v_res
  from public.reservations r
  join public.vehicles v on v.id = r.vehicle_id
  where r.id = p_reservation_id and v.owner_id = auth.uid();
  if v_res.id is null then
    raise exception 'Mission introuvable';
  end if;
  if v_res.status <> 'confirmed' then
    raise exception 'Cette mission a déjà commencé ou est terminée : appelez Zoko.';
  end if;
  if length(trim(coalesce(p_reason, ''))) = 0 then
    raise exception 'Indiquez pourquoi vous refusez cette mission';
  end if;

  perform set_config('zoko.partner_decline', 'on', true);
  update public.reservations
     set status = 'pending',
         vehicle_id = null,
         driver_id = null,
         driven_by_owner = false,
         partner_share_pct = null,
         confirmed_at = null,
         confirmed_by = null,
         internal_notes = concat_ws(E'\n', internal_notes,
           'Refusée par le partenaire le ' || to_char(now() at time zone v_tz, 'DD/MM à HH24:MI') || ' : ' || trim(p_reason))
   where id = v_res.id;
  perform set_config('zoko.partner_decline', '', true);

  insert into public.notifications (user_id, type, title, body, reservation_id)
  select p.id, 'other', 'Mission refusée par un partenaire · ' || v_res.reference,
         'À réattribuer. Motif : ' || trim(p_reason), v_res.id
  from public.profiles p
  where p.role in ('agent', 'admin') and p.is_active;
end;
$$;

-- (d'après 20261129120000_partners.sql)
create or replace function public.vehicles_for_reservation(p_reservation_id uuid)
returns table (
  vehicle_id uuid, plate_number text, color text, status public.vehicle_status, is_free boolean,
  owner_name text, drive_mode public.drive_mode, partner_free boolean
)
language sql stable security definer set search_path = ''
as $$
  select v.id, v.plate_number, v.color, v.status,
         v.status = 'available'
           and public.vehicle_free_for(v.id, r.start_at, r.end_at)
           and not exists (
             select 1 from public.reservations o
             where o.vehicle_id = v.id
               and o.id <> r.id
               and o.status in ('confirmed', 'in_progress')
               and tstzrange(o.start_at, o.end_at) && tstzrange(r.start_at, r.end_at)),
         op.full_name,
         v.drive_mode,
         public.vehicle_free_for(v.id, r.start_at, r.end_at)
  from public.reservations r
  join public.vehicles v on v.model_id = r.model_id
  left join public.ride_zones z on z.id = r.from_zone_id
  left join public.profiles op on op.id = v.owner_id
  where r.id = p_reservation_id
    and public.can_operate_reservations()
    and (r.kind = 'rental' or v.city = z.city)
    and (r.with_driver or v.drive_mode <> 'owner')
  order by v.owner_id nulls first, v.plate_number
$$;

-- (d'après 20261129120000_partners.sql)
create or replace function public.reservation_owner_contact(p_reservation_id uuid)
returns jsonb
language sql stable security definer set search_path = ''
as $$
  select jsonb_build_object('name', o.full_name, 'phone', o.phone)
  from public.reservations r
  join public.vehicles v on v.id = r.vehicle_id
  join public.profiles o on o.id = v.owner_id
  where r.id = p_reservation_id
    and r.driven_by_owner
    and (r.client_id = auth.uid() or public.can_see_reservations())
$$;

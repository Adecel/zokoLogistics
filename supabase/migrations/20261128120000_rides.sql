-- =====================================================================
-- Courses immédiates (prix forfaitaires par zone)
--
-- Faute de GPS fiable, le prix d'une course ne dépend pas de la distance :
-- il est fixé par trajet « zone de départ ↔ zone d'arrivée » (arrondissement
-- ou quartier connu) et par modèle de véhicule. Tout est modifiable par
-- l'équipe (gérant, agents, admin) depuis le tableau de bord.
--
--  - ride_zones  : zones d'une ville (arrondissement ou quartier)
--  - ride_routes : trajet A ↔ B (même prix dans les deux sens) + durée estimée
--  - ride_fares  : prix d'un trajet pour un modèle, avec historique
--  - vehicles.city : ville où le véhicule est basé
--
-- Une course est une réservation (reservations.kind = 'ride') : elle bloque
-- un véhicule réel de maintenant jusqu'à « approche + trajet ». La contrainte
-- anti double réservation s'applique donc aussi entre courses et locations.
-- Le client paie au chauffeur à la fin ; l'équipe enregistre le paiement.
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1. Ville des véhicules
-- ---------------------------------------------------------------------
alter table public.vehicles
  add column if not exists city text not null default 'Pointe-Noire'
  check (length(trim(city)) > 0);
comment on column public.vehicles.city is 'Ville où le véhicule est basé : une course ne reçoit qu''un véhicule de sa ville.';


-- ---------------------------------------------------------------------
-- 2. Zones, trajets et prix
-- ---------------------------------------------------------------------
create table public.ride_zones (
  id          uuid primary key default gen_random_uuid(),
  city        text not null check (length(trim(city)) > 0),
  name        text not null check (length(trim(name)) > 0),
  district    text,                                   -- arrondissement d'un quartier (facultatif)
  is_active   boolean not null default true,          -- proposée aux clients
  position    smallint not null default 0,            -- ordre d'affichage
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (city, name)
);
comment on table public.ride_zones is 'Zones des courses : arrondissements ou quartiers reconnus, par ville.';

-- Trajet entre deux zones (zone_a <= zone_b : A → B et B → A sont le même trajet).
-- zone_a = zone_b : course à l'intérieur d'une même zone.
create table public.ride_routes (
  id                uuid primary key default gen_random_uuid(),
  zone_a            uuid not null references public.ride_zones (id) on delete cascade,
  zone_b            uuid not null references public.ride_zones (id) on delete cascade,
  duration_minutes  smallint not null check (duration_minutes between 5 and 600),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  check (zone_a <= zone_b),
  unique (zone_a, zone_b)
);
comment on table public.ride_routes is 'Trajets entre deux zones, avec la durée estimée de la course.';

-- Prix d'un trajet pour un modèle, historisé comme les tarifs de location
create table public.ride_fares (
  id          uuid primary key default gen_random_uuid(),
  route_id    uuid not null references public.ride_routes (id) on delete cascade,
  model_id    uuid not null references public.vehicle_models (id) on delete cascade,
  price       integer not null check (price > 0),
  valid_from  timestamptz not null default now(),
  valid_to    timestamptz,
  created_by  uuid references public.profiles (id) on delete set null,
  created_at  timestamptz not null default now(),
  check (valid_to is null or valid_to > valid_from),
  constraint ride_fares_no_overlap exclude using gist (
    route_id with =,
    model_id with =,
    tstzrange(valid_from, valid_to) with &&
  )
);
comment on table public.ride_fares is 'Prix des courses par trajet et par modèle (historique conservé).';

create index on public.ride_zones (city, position, name);
create index on public.ride_routes (zone_b);
create index on public.ride_fares (route_id, model_id, valid_from desc);
create index on public.vehicles (city);

create trigger set_updated_at before update on public.ride_zones
  for each row execute function public.set_updated_at();
create trigger set_updated_at before update on public.ride_routes
  for each row execute function public.set_updated_at();

-- Une zone qui a déjà des trajets ne peut pas changer de ville
create or replace function public.ride_zones_guard()
returns trigger
language plpgsql set search_path = ''
as $$
begin
  if new.city is distinct from old.city and exists (
    select 1 from public.ride_routes r where r.zone_a = old.id or r.zone_b = old.id
  ) then
    raise exception 'Cette zone a déjà des tarifs : créez une nouvelle zone dans l''autre ville.';
  end if;
  return new;
end;
$$;

create trigger ride_zones_guard before update on public.ride_zones
  for each row execute function public.ride_zones_guard();


-- ---------------------------------------------------------------------
-- 3. Une course est une réservation
-- ---------------------------------------------------------------------
create type public.reservation_kind as enum ('rental', 'ride');

alter table public.reservations
  add column kind          public.reservation_kind not null default 'rental',
  add column from_zone_id  uuid references public.ride_zones (id) on delete restrict,
  add column to_zone_id    uuid references public.ride_zones (id) on delete restrict,
  add column ride_fare_id  uuid references public.ride_fares (id) on delete restrict,
  add column ride_minutes  smallint check (ride_minutes > 0);

comment on column public.reservations.kind is 'rental = location à l''heure, ride = course immédiate zone → zone.';
comment on column public.reservations.ride_minutes is 'Course : minutes bloquées sur le véhicule (approche + trajet).';

alter table public.reservations
  add constraint reservations_ride_fields check (
    kind = 'rental'
    or (from_zone_id is not null and to_zone_id is not null and ride_minutes is not null and with_driver)
  );

create index on public.reservations (kind, status, start_at);


-- ---------------------------------------------------------------------
-- 4. Prix en vigueur d'un trajet pour un modèle
-- ---------------------------------------------------------------------
create or replace function public.current_ride_fare(p_route_id uuid, p_model_id uuid, p_at timestamptz default now())
returns public.ride_fares
language sql stable security definer set search_path = ''
as $$
  select f.* from public.ride_fares f
  where f.route_id = p_route_id
    and f.model_id = p_model_id
    and f.valid_from <= p_at
    and (f.valid_to is null or f.valid_to > p_at)
  limit 1
$$;


-- ---------------------------------------------------------------------
-- 5. Règles de la réservation : même fonction qu'avant (driver_choice),
--    avec une branche « course » pour le prix, la fin et les droits du client.
-- ---------------------------------------------------------------------
create or replace function public.reservations_before_write()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_rate        public.rates;
  v_promo       public.promotions;
  v_staff       boolean := public.is_staff();
  v_min_days    integer := coalesce((public.setting('min_days_ahead'))::integer, 1);
  v_tz          text    := coalesce(public.setting('timezone') #>> '{}', 'Africa/Brazzaville');
  v_uses        integer;
  v_reprice     boolean;
  -- courses
  v_from        public.ride_zones;
  v_to          public.ride_zones;
  v_route       public.ride_routes;
  v_fare        public.ride_fares;
  v_pickup      integer := coalesce((public.setting('ride_pickup_minutes'))::integer, 20);
  v_hours       jsonb   := public.setting('ride_hours');
  v_time        time;
  v_reason      text;
begin
  if tg_op = 'UPDATE' and new.kind is distinct from old.kind then
    raise exception 'Le type de réservation ne peut pas changer';
  end if;

  -- Règles propres aux clients (l'équipe peut saisir une réservation pour un client)
  if not v_staff and auth.uid() is not null then
    if tg_op = 'INSERT' then
      new.client_id := auth.uid();
      new.status := 'pending';
      new.vehicle_id := null;
      new.internal_notes := null;
      if new.kind = 'ride' then
        -- Course immédiate : départ maintenant, chauffeur attribué par Zoko, pas de code promo
        new.start_at := now();
        new.with_driver := true;
        new.driver_id := null;
        new.promotion_id := null;
        new.client_license_number := null;
      end if;
    elsif old.kind = 'ride' then
      if old.client_id <> auth.uid() then
        raise exception 'Course introuvable';
      end if;
      if old.status not in ('pending', 'confirmed') then
        raise exception 'Cette course ne peut plus être annulée';
      end if;
      if new.status <> 'cancelled' then
        raise exception 'Une course ne peut pas être modifiée. Annulez-la puis commandez-en une nouvelle.';
      end if;
      -- Le client peut seulement annuler : tout le reste est conservé
      v_reason := new.cancellation_reason;
      new := old;
      new.status := 'cancelled';
      new.cancellation_reason := v_reason;
    else
      if old.client_id <> auth.uid() then
        raise exception 'Réservation introuvable';
      end if;
      if old.status not in ('pending', 'confirmed') or old.start_at <= now() then
        raise exception 'Cette réservation ne peut plus être modifiée';
      end if;
      -- Le client peut seulement annuler, ou modifier date / durée / lieux / téléphone / notes / chauffeur
      if new.status <> old.status and new.status <> 'cancelled' then
        raise exception 'Action non autorisée';
      end if;
      new.client_id := old.client_id;
      new.vehicle_id := old.vehicle_id;
      new.internal_notes := old.internal_notes;
      new.confirmed_by := old.confirmed_by;
      new.confirmed_at := old.confirmed_at;
      new.actual_start_at := old.actual_start_at;
      new.actual_end_at := old.actual_end_at;
      new.promotion_id := old.promotion_id;
      -- Une réservation confirmée dont la date, le modèle ou le choix du chauffeur change repasse en attente
      if new.status <> 'cancelled' and old.status = 'confirmed'
         and (new.start_at, new.duration_hours, new.model_id, new.with_driver, new.driver_id)
             is distinct from (old.start_at, old.duration_hours, old.model_id, old.with_driver, old.driver_id) then
        new.status := 'pending';
        new.vehicle_id := null;
        new.confirmed_by := null;
        new.confirmed_at := null;
      end if;
    end if;

    -- Location : au moins N jour(s) à l'avance (date locale)
    if new.kind = 'rental' and new.status <> 'cancelled'
       and (tg_op = 'INSERT' or new.start_at is distinct from old.start_at)
       and (new.start_at at time zone v_tz)::date < ((now() at time zone v_tz)::date + v_min_days) then
      raise exception 'La réservation doit être faite au moins % jour(s) à l''avance', v_min_days;
    end if;

    -- Course : service ouvert et dans les heures prévues
    if new.kind = 'ride' and tg_op = 'INSERT' then
      if coalesce((public.setting('rides_enabled'))::boolean, true) is false then
        raise exception 'Les courses ne sont pas disponibles pour le moment';
      end if;
      if v_hours is not null then
        v_time := (now() at time zone v_tz)::time;
        if v_time < (v_hours ->> 'start')::time or v_time > (v_hours ->> 'end')::time then
          raise exception 'Les courses sont disponibles entre % et %', v_hours ->> 'start', v_hours ->> 'end';
        end if;
      end if;
    end if;
  end if;

  -- Référence lisible
  if tg_op = 'INSERT' then
    new.reference := 'ZK-' || to_char(now() at time zone v_tz, 'YYYY') || '-'
                     || lpad(nextval('public.reservation_number_seq')::text, 5, '0');
  end if;

  -- Le véhicule attribué doit correspondre au modèle réservé
  if new.vehicle_id is not null and not exists (
    select 1 from public.vehicles v where v.id = new.vehicle_id and v.model_id = new.model_id
  ) then
    raise exception 'Le véhicule attribué ne correspond pas au modèle réservé';
  end if;

  if new.kind = 'ride' then
    -- -----------------------------------------------------------------
    -- Course : prix du trajet pour ce modèle, durée bloquée = approche + trajet
    -- -----------------------------------------------------------------
    if tg_op = 'INSERT'
       or (new.model_id, new.from_zone_id, new.to_zone_id)
          is distinct from (old.model_id, old.from_zone_id, old.to_zone_id) then
      select * into v_from from public.ride_zones where id = new.from_zone_id;
      select * into v_to   from public.ride_zones where id = new.to_zone_id;
      if v_from.id is null or v_to.id is null then
        raise exception 'Choisissez la zone de départ et la zone d''arrivée';
      end if;
      if v_from.city <> v_to.city then
        raise exception 'Le départ et l''arrivée doivent être dans la même ville';
      end if;
      if not v_staff and not (v_from.is_active and v_to.is_active) then
        raise exception 'Cette zone n''est pas desservie pour le moment';
      end if;
      select * into v_route from public.ride_routes
      where zone_a = least(new.from_zone_id, new.to_zone_id)
        and zone_b = greatest(new.from_zone_id, new.to_zone_id);
      if v_route.id is not null then
        v_fare := public.current_ride_fare(v_route.id, new.model_id);
      end if;
      if v_fare.id is null then
        raise exception 'Aucun prix pour ce trajet avec ce véhicule';
      end if;
      new.ride_fare_id := v_fare.id;
      new.rate_id := null;
      new.promotion_id := null;
      new.base_price := v_fare.price;
      new.discount_amount := 0;
      new.ride_minutes := v_route.duration_minutes + v_pickup;
    end if;
    new.duration_hours := greatest(1, ceil(new.ride_minutes / 60.0))::smallint;
    new.end_at := new.start_at + make_interval(mins => new.ride_minutes);

    -- Le véhicule doit être basé dans la ville de la course
    if new.vehicle_id is not null and not exists (
      select 1 from public.vehicles v
      join public.ride_zones z on z.id = new.from_zone_id
      where v.id = new.vehicle_id and v.city = z.city
    ) then
      raise exception 'Ce véhicule n''est pas basé dans la ville de la course';
    end if;

    -- Client : il doit rester un véhicule libre de ce modèle maintenant
    if tg_op = 'INSERT' and not v_staff and auth.uid() is not null
       and coalesce((select q.available_count from public.ride_quote(new.from_zone_id, new.to_zone_id) q
                     where q.model_id = new.model_id), 0) <= 0 then
      raise exception 'Plus aucun véhicule de ce modèle n''est libre pour le moment. Choisissez-en un autre.';
    end if;
  else
    -- -----------------------------------------------------------------
    -- Location : inchangé
    -- -----------------------------------------------------------------
    new.end_at := new.start_at + make_interval(hours => new.duration_hours);

    v_reprice := tg_op = 'INSERT'
      or (new.model_id, new.duration_hours, new.promotion_id)
         is distinct from (old.model_id, old.duration_hours, old.promotion_id);

    if v_reprice then
      v_rate := public.current_rate(new.model_id, new.duration_hours);
      if v_rate.id is null then
        raise exception 'Aucun tarif en vigueur pour ce véhicule et cette durée';
      end if;
      new.rate_id := v_rate.id;
      new.base_price := v_rate.price;
      new.discount_amount := 0;

      if new.promotion_id is not null then
        select * into v_promo from public.promotions p
        where p.id = new.promotion_id
          and p.is_active
          and p.starts_at <= now()
          and (p.ends_at is null or p.ends_at > now());
        if v_promo.id is null then
          raise exception 'Code promo invalide ou expiré';
        end if;
        if v_promo.max_uses is not null then
          select count(*) into v_uses from public.reservations r
          where r.promotion_id = v_promo.id
            and r.status not in ('cancelled', 'rejected')
            and r.id <> new.id;
          if v_uses >= v_promo.max_uses then
            raise exception 'Ce code promo a atteint sa limite d''utilisation';
          end if;
        end if;
        new.discount_amount := least(
          new.base_price,
          case v_promo.discount_type
            when 'percent' then (new.base_price * v_promo.discount_value) / 100
            else v_promo.discount_value
          end
        );
      end if;
    end if;
  end if;

  -- Horodatage des changements de statut
  if tg_op = 'INSERT' or new.status is distinct from old.status then
    case new.status
      when 'confirmed' then
        new.confirmed_at := coalesce(new.confirmed_at, now());
        new.confirmed_by := coalesce(new.confirmed_by, auth.uid());
      when 'in_progress' then
        new.actual_start_at := coalesce(new.actual_start_at, now());
      when 'completed' then
        new.actual_end_at := coalesce(new.actual_end_at, now());
      when 'cancelled', 'rejected' then
        new.cancelled_at := coalesce(new.cancelled_at, now());
        new.cancelled_by := coalesce(new.cancelled_by, auth.uid());
      else null;
    end case;
  end if;

  return new;
end;
$$;


-- Fenêtre de réservation (max jours, heures de départ) : ne concerne que les locations
create or replace function public.reservations_check_window()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_tz        text    := coalesce(public.setting('timezone') #>> '{}', 'Africa/Brazzaville');
  v_max_days  integer := coalesce((public.setting('max_days_ahead'))::integer, 60);
  v_hours     jsonb   := public.setting('booking_hours');
  v_local     timestamp;
  v_time      time;
begin
  if new.kind = 'ride' or public.is_staff() or auth.uid() is null or new.status = 'cancelled' then
    return new;
  end if;
  if tg_op = 'UPDATE' and new.start_at is not distinct from old.start_at then
    return new;
  end if;

  v_local := new.start_at at time zone v_tz;

  if v_local::date > (now() at time zone v_tz)::date + v_max_days then
    raise exception 'Les réservations sont ouvertes jusqu''à % jours à l''avance', v_max_days;
  end if;

  if v_hours is not null then
    v_time := v_local::time;
    if v_time < (v_hours ->> 'start')::time or v_time > (v_hours ->> 'end')::time then
      raise exception 'Heure de début possible entre % et %', v_hours ->> 'start', v_hours ->> 'end';
    end if;
  end if;

  return new;
end;
$$;


-- ---------------------------------------------------------------------
-- 6. Notifications : « course » au lieu de « réservation » quand il le faut
-- ---------------------------------------------------------------------
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
    where p.role in ('manager', 'agent') and p.is_active and p.id <> new.client_id;
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
          and (p.role = 'manager' or (p.role = 'agent' and new.status in ('cancelled', 'pending')));
      end if;
    end if;
  end if;

  return new;
end;
$$;


-- ---------------------------------------------------------------------
-- 7. Rappels automatiques : les courses (immédiates, payées à la fin)
--    ne reçoivent ni rappel de départ ni relance de paiement.
-- ---------------------------------------------------------------------
create or replace function public.create_reminders()
returns integer
language plpgsql security definer set search_path = ''
as $$
declare
  v_tz    text := coalesce(public.setting('timezone') #>> '{}', 'Africa/Brazzaville');
  v_total integer := 0;
  v_n     integer;
begin
  -- 1. La veille : location confirmée qui commence dans 3 à 24 h
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

  -- 2. Départ dans moins de 2 heures
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

  -- 3. Paiement en attente : réservation créée il y a plus de 2 h, aucun paiement déclaré
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

  -- 4. Équipe : location ou course confirmée dans moins de 24 h sans chauffeur attribué
  insert into public.notifications (user_id, type, title, body, reservation_id)
  select p.id, 'other', 'Chauffeur à attribuer · ' || r.reference,
         'Départ le ' || to_char(r.start_at at time zone v_tz, 'DD/MM à HH24:MI') || ' · ' || r.pickup_address,
         r.id
  from public.reservations r
  cross join public.profiles p
  where r.status = 'confirmed'
    and r.with_driver
    and r.driver_id is null
    and r.start_at between now() - interval '2 hours' and now() + interval '24 hours'
    and p.role in ('manager', 'agent') and p.is_active
    and not exists (
      select 1 from public.notifications n
      where n.reservation_id = r.id and n.user_id = p.id and n.title = 'Chauffeur à attribuer · ' || r.reference);
  get diagnostics v_n = row_count;
  v_total := v_total + v_n;

  return v_total;
end;
$$;


-- ---------------------------------------------------------------------
-- 8. Véhicules proposés pour confirmer : même ville pour une course
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
  left join public.ride_zones z on z.id = r.from_zone_id
  where r.id = p_reservation_id
    and public.can_view_finance()
    and (r.kind = 'rental' or v.city = z.city)
  order by v.plate_number
$$;


-- ---------------------------------------------------------------------
-- 9. Devis d'une course : prix et véhicules libres maintenant, par modèle
--    (le client ne voit pas les réservations des autres)
-- ---------------------------------------------------------------------
create or replace function public.ride_quote(p_from uuid, p_to uuid)
returns table (model_id uuid, price integer, ride_minutes integer, available_count integer, drivers_free integer)
language sql stable security definer set search_path = ''
as $$
  with ctx as (
    select f.city,
           rt.id as route_id,
           rt.duration_minutes + coalesce((public.setting('ride_pickup_minutes'))::integer, 20) as minutes
    from public.ride_zones f
    join public.ride_zones t on t.id = p_to and t.city = f.city and t.is_active
    join public.ride_routes rt on rt.zone_a = least(p_from, p_to) and rt.zone_b = greatest(p_from, p_to)
    where f.id = p_from and f.is_active
  ),
  win as (
    select ctx.*, tstzrange(now(), now() + make_interval(mins => ctx.minutes)) as w from ctx
  ),
  drv as (
    select count(*)::integer as n
    from public.drivers d
    join public.profiles pr on pr.id = d.profile_id
    cross join win
    where d.is_available and pr.is_active and pr.role = 'driver'
      and not exists (
        select 1 from public.reservations r
        where r.driver_id = d.profile_id
          and r.status in ('confirmed', 'in_progress')
          and tstzrange(r.start_at, r.end_at) && win.w)
  )
  select
    m.id,
    fa.price,
    win.minutes,
    greatest(0,
      (select count(*) from public.vehicles v
       where v.model_id = m.id and v.city = win.city and v.status = 'available'
         and not exists (
           select 1 from public.reservations r
           where r.vehicle_id = v.id
             and r.status in ('confirmed', 'in_progress')
             and tstzrange(r.start_at, r.end_at) && win.w))
      -- les demandes en attente sur ce modèle réduisent aussi la disponibilité
      - (select count(*) from public.reservations r
         left join public.ride_zones rz on rz.id = r.from_zone_id
         where r.model_id = m.id and r.status = 'pending'
           and tstzrange(r.start_at, r.end_at) && win.w
           and (r.kind = 'rental' or rz.city = win.city))
    )::integer,
    drv.n
  from win
  cross join drv
  join public.ride_fares fa on fa.route_id = win.route_id
    and fa.valid_from <= now() and (fa.valid_to is null or fa.valid_to > now())
  join public.vehicle_models m on m.id = fa.model_id and m.is_active
  order by fa.price
$$;

revoke execute on function public.ride_quote(uuid, uuid) from public, anon;
grant execute on function public.ride_quote(uuid, uuid) to authenticated;


-- ---------------------------------------------------------------------
-- 10. Enregistrer un trajet et ses prix en une fois (tableau de bord)
--     p_prices = {"<model_id>": 2000, "<model_id>": null}  (null = plus proposé)
--     Un prix modifié ferme l'ancien et en ouvre un nouveau (historique gardé).
-- ---------------------------------------------------------------------
create or replace function public.save_ride_route(
  p_from uuid,
  p_to uuid,
  p_duration_minutes integer,
  p_prices jsonb
)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  v_route  uuid;
  v_key    text;
  v_val    jsonb;
  v_price  integer;
  v_fare   public.ride_fares;
  v_now    timestamptz := now();
begin
  if not public.is_staff() then
    raise exception 'Action réservée à l''équipe Zoko';
  end if;
  if (select count(*) from public.ride_zones where id in (p_from, p_to)) <> (case when p_from = p_to then 1 else 2 end)
     or (select count(distinct city) from public.ride_zones where id in (p_from, p_to)) <> 1 then
    raise exception 'Les deux zones doivent exister et être dans la même ville';
  end if;
  if p_duration_minutes is null or p_duration_minutes not between 5 and 600 then
    raise exception 'Durée du trajet entre 5 et 600 minutes';
  end if;

  insert into public.ride_routes (zone_a, zone_b, duration_minutes)
  values (least(p_from, p_to), greatest(p_from, p_to), p_duration_minutes)
  on conflict (zone_a, zone_b) do update set duration_minutes = excluded.duration_minutes
  returning id into v_route;

  for v_key, v_val in select key, value from jsonb_each(coalesce(p_prices, '{}'::jsonb)) loop
    v_price := nullif(v_val #>> '{}', '')::integer;
    if v_price is not null and v_price <= 0 then
      raise exception 'Prix invalide';
    end if;
    v_fare := public.current_ride_fare(v_route, v_key::uuid);
    continue when v_fare.id is not null and v_fare.price = v_price;
    continue when v_fare.id is null and v_price is null;
    if v_fare.id is not null then
      update public.ride_fares set valid_to = v_now where id = v_fare.id;
    end if;
    if v_price is not null then
      insert into public.ride_fares (route_id, model_id, price, valid_from, created_by)
      values (v_route, v_key::uuid, v_price, v_now, auth.uid());
    end if;
  end loop;

  return v_route;
end;
$$;

revoke execute on function public.save_ride_route(uuid, uuid, integer, jsonb) from public, anon;
grant execute on function public.save_ride_route(uuid, uuid, integer, jsonb) to authenticated;


-- ---------------------------------------------------------------------
-- 11. Vue détaillée : colonnes des courses (ajoutées à la fin)
-- ---------------------------------------------------------------------
create or replace view public.reservation_details with (security_invoker = true) as
select
  r.id,
  r.reference,
  r.status,
  r.start_at,
  r.end_at,
  (r.start_at at time zone 'Africa/Brazzaville')::date as start_date_local,
  r.duration_hours,
  r.pickup_address,
  r.dropoff_address,
  r.contact_phone,
  r.client_id,
  c.full_name   as client_name,
  c.phone       as client_phone,
  r.model_id,
  m.brand || ' ' || m.name as model_name,
  r.vehicle_id,
  v.plate_number,
  r.driver_id,
  d.full_name   as driver_name,
  r.base_price,
  r.discount_amount,
  pr.code       as promotion_code,
  b.extra_charges,
  b.amount_due,
  b.amount_paid,
  b.amount_refunded,
  b.balance,
  r.actual_start_at,
  r.actual_end_at,
  r.created_at,
  r.confirmed_at,
  r.cancelled_at,
  r.cancellation_reason,
  r.with_driver,
  r.client_license_number,
  d.phone       as driver_phone,
  d.avatar_url  as driver_avatar_url,
  r.kind,
  r.from_zone_id,
  fz.name       as from_zone_name,
  r.to_zone_id,
  tz.name       as to_zone_name,
  fz.city       as ride_city,
  r.ride_minutes
from public.reservations r
join public.profiles c        on c.id = r.client_id
join public.vehicle_models m  on m.id = r.model_id
left join public.vehicles v   on v.id = r.vehicle_id
left join public.profiles d   on d.id = r.driver_id
left join public.promotions pr on pr.id = r.promotion_id
left join public.reservation_balances b on b.reservation_id = r.id
left join public.ride_zones fz on fz.id = r.from_zone_id
left join public.ride_zones tz on tz.id = r.to_zone_id;


-- ---------------------------------------------------------------------
-- 12. Sécurité : tout le monde lit les zones et les prix, l'équipe
--     (gérant, agents, admin) les modifie.
-- ---------------------------------------------------------------------
alter table public.ride_zones  enable row level security;
alter table public.ride_routes enable row level security;
alter table public.ride_fares  enable row level security;

create policy "ride zones: lecture" on public.ride_zones
  for select to anon, authenticated using (is_active or public.is_staff());
create policy "ride zones: ajout" on public.ride_zones
  for insert to authenticated with check (public.is_staff());
create policy "ride zones: modification" on public.ride_zones
  for update to authenticated using (public.is_staff()) with check (public.is_staff());
create policy "ride zones: suppression" on public.ride_zones
  for delete to authenticated using (public.is_staff());

create policy "ride routes: lecture" on public.ride_routes
  for select to anon, authenticated using (true);
create policy "ride routes: suppression" on public.ride_routes
  for delete to authenticated using (public.is_staff());

create policy "ride fares: lecture" on public.ride_fares
  for select to anon, authenticated using (true);

grant select on public.ride_zones, public.ride_routes, public.ride_fares to anon;
grant select, insert, update, delete on public.ride_zones, public.ride_routes, public.ride_fares to authenticated;

-- =====================================================================
-- Zoko Partenaire : des particuliers mettent leur véhicule à disposition
--
--  1. Un client demande à devenir partenaire (gratuit pendant le lancement).
--     Le gérant accepte ou refuse.
--  2. Le partenaire validé propose ses véhicules. Le gérant valide chaque
--     véhicule en le rattachant à un modèle du catalogue (prix) ou en créant
--     un nouveau modèle. Le véhicule entre alors dans la flotte (vehicles)
--     avec un propriétaire (owner_id).
--  3. Le partenaire indique quand son véhicule est disponible :
--       - « disponible maintenant » (courses immédiates) ;
--       - des plages futures (réservations).
--     Et qui conduit : lui-même, un chauffeur Zoko, ou les deux.
--  4. Un véhicule partenaire n'est proposé et attribuable que s'il est
--     disponible sur le créneau. Le partenaire voit ses missions, peut en
--     refuser une (elle repart chez les agents) et voit ses gains estimés
--     (pourcentage réglable dans les paramètres).
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1. Types et tables
-- ---------------------------------------------------------------------
create type public.partner_status as enum ('pending', 'approved', 'rejected', 'suspended');
create type public.partner_vehicle_status as enum ('pending', 'approved', 'rejected');
create type public.drive_mode as enum (
  'owner',   -- le propriétaire conduit toujours lui-même
  'zoko',    -- le véhicule est confié à Zoko (chauffeur Zoko ou client sans chauffeur)
  'either'   -- les deux, au choix de l'agent
);

-- Demande / statut de partenaire (un par compte)
create table public.partners (
  profile_id      uuid primary key references public.profiles (id) on delete cascade,
  status          public.partner_status not null default 'pending',
  city            text not null check (length(trim(city)) > 0),
  drives_self     boolean not null default true,      -- souhaite conduire lui-même
  license_number  text,                               -- obligatoire s'il conduit
  message         text,
  review_note     text,                               -- motif de refus / suspension (visible par le partenaire)
  reviewed_by     uuid references public.profiles (id) on delete set null,
  reviewed_at     timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  check (not drives_self or length(trim(coalesce(license_number, ''))) > 0)
);
comment on table public.partners is 'Zoko Partenaire : propriétaires qui mettent leur véhicule à disposition.';

-- Véhicule proposé par un partenaire (avant et après validation)
create table public.partner_vehicles (
  id            uuid primary key default gen_random_uuid(),
  owner_id      uuid not null references public.partners (profile_id) on delete cascade,
  brand         text not null check (length(trim(brand)) > 0),
  name          text not null check (length(trim(name)) > 0),
  year          smallint check (year between 1990 and 2100),
  color         text,
  plate_number  text not null check (length(trim(plate_number)) > 0),
  seats         smallint not null default 4 check (seats > 0),
  transmission  public.transmission_type not null default 'manual',
  city          text not null check (length(trim(city)) > 0),
  drive_mode    public.drive_mode not null default 'either',
  photos        text[] not null default '{}',
  notes         text,
  status        public.partner_vehicle_status not null default 'pending',
  review_note   text,
  reviewed_by   uuid references public.profiles (id) on delete set null,
  reviewed_at   timestamptz,
  vehicle_id    uuid unique references public.vehicles (id) on delete set null,   -- véhicule de la flotte une fois validé
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
comment on table public.partner_vehicles is 'Véhicules proposés par les partenaires ; validés par le gérant.';
create unique index partner_vehicles_plate_key on public.partner_vehicles (upper(plate_number)) where status <> 'rejected';
create index on public.partner_vehicles (owner_id);
create index on public.partner_vehicles (status);

-- Véhicules de la flotte : propriétaire, qui conduit, disponibilité immédiate
alter table public.vehicles
  add column owner_id          uuid references public.partners (profile_id) on delete restrict,
  add column drive_mode        public.drive_mode not null default 'zoko',
  add column available_now     boolean not null default false,
  add column available_now_at  timestamptz;
comment on column public.vehicles.owner_id is 'Partenaire propriétaire (vide = véhicule Zoko).';
comment on column public.vehicles.available_now is 'Partenaire : disponible tout de suite (courses immédiates).';
create index on public.vehicles (owner_id);

-- Plages de disponibilité futures d'un véhicule partenaire
create table public.vehicle_availability (
  id          uuid primary key default gen_random_uuid(),
  vehicle_id  uuid not null references public.vehicles (id) on delete cascade,
  start_at    timestamptz not null,
  end_at      timestamptz not null,
  note        text,
  created_at  timestamptz not null default now(),
  check (end_at > start_at),
  check (end_at - start_at <= interval '62 days')
);
create index on public.vehicle_availability (vehicle_id, start_at);

-- Réservations : qui conduit, part du partenaire figée à l'attribution
alter table public.reservations
  add column driven_by_owner    boolean not null default false,
  add column partner_share_pct  smallint check (partner_share_pct between 0 and 100),
  add constraint reservations_owner_drives check (not driven_by_owner or (with_driver and driver_id is null));
comment on column public.reservations.driven_by_owner is 'Le propriétaire (partenaire) conduit son véhicule.';
comment on column public.reservations.partner_share_pct is 'Part du partenaire (%) au moment de l''attribution.';

create trigger set_updated_at before update on public.partners
  for each row execute function public.set_updated_at();
create trigger set_updated_at before update on public.partner_vehicles
  for each row execute function public.set_updated_at();


-- ---------------------------------------------------------------------
-- 2. Fonctions utilitaires
-- ---------------------------------------------------------------------
create or replace function public.is_partner()
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.partners p
    join public.profiles pr on pr.id = p.profile_id
    where p.profile_id = auth.uid() and p.status = 'approved' and pr.is_active)
$$;

create or replace function public.is_vehicle_owner(p_vehicle_id uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (select 1 from public.vehicles v where v.id = p_vehicle_id and v.owner_id = auth.uid())
$$;

-- Un véhicule est-il proposable sur ce créneau ? (Zoko : toujours ; partenaire :
-- partenaire validé ET [disponible maintenant pour un départ dans l'heure,
-- OU une plage de disponibilité couvre tout le créneau]).
-- L'état du véhicule (entretien...) et les chevauchements sont vérifiés à part.
create or replace function public.vehicle_free_for(p_vehicle_id uuid, p_start timestamptz, p_end timestamptz)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select coalesce((
    select v.owner_id is null or (
      exists (
        select 1 from public.partners p
        join public.profiles pr on pr.id = p.profile_id
        where p.profile_id = v.owner_id and p.status = 'approved' and pr.is_active)
      and (
        (v.available_now and p_start <= now() + interval '1 hour')
        or exists (
          select 1 from public.vehicle_availability a
          where a.vehicle_id = v.id and a.start_at <= p_start and a.end_at >= p_end)
      )
    )
    from public.vehicles v where v.id = p_vehicle_id
  ), false)
$$;


-- ---------------------------------------------------------------------
-- 3. Règles de la réservation : version « courses » + véhicules partenaires
-- ---------------------------------------------------------------------
create or replace function public.reservations_before_write()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_rate        public.rates;
  v_promo       public.promotions;
  -- l'équipe, ou un partenaire qui refuse une mission (fonction partner_decline_mission)
  v_staff       boolean := public.is_staff() or coalesce(current_setting('zoko.partner_decline', true), '') = 'on';
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
  -- partenaires
  v_vehicle     public.vehicles;
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
      new.driven_by_owner := false;
      if new.kind = 'ride' then
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
      new.driven_by_owner := old.driven_by_owner;
      new.partner_share_pct := old.partner_share_pct;
      if new.status <> 'cancelled' and old.status = 'confirmed'
         and (new.start_at, new.duration_hours, new.model_id, new.with_driver, new.driver_id)
             is distinct from (old.start_at, old.duration_hours, old.model_id, old.with_driver, old.driver_id) then
        new.status := 'pending';
        new.vehicle_id := null;
        new.confirmed_by := null;
        new.confirmed_at := null;
      end if;
    end if;

    if new.kind = 'rental' and new.status <> 'cancelled'
       and (tg_op = 'INSERT' or new.start_at is distinct from old.start_at)
       and (new.start_at at time zone v_tz)::date < ((now() at time zone v_tz)::date + v_min_days) then
      raise exception 'La réservation doit être faite au moins % jour(s) à l''avance', v_min_days;
    end if;

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

  if tg_op = 'INSERT' then
    new.reference := 'ZK-' || to_char(now() at time zone v_tz, 'YYYY') || '-'
                     || lpad(nextval('public.reservation_number_seq')::text, 5, '0');
  end if;

  if new.vehicle_id is not null and not exists (
    select 1 from public.vehicles v where v.id = new.vehicle_id and v.model_id = new.model_id
  ) then
    raise exception 'Le véhicule attribué ne correspond pas au modèle réservé';
  end if;

  if new.kind = 'ride' then
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

    if new.vehicle_id is not null and not exists (
      select 1 from public.vehicles v
      join public.ride_zones z on z.id = new.from_zone_id
      where v.id = new.vehicle_id and v.city = z.city
    ) then
      raise exception 'Ce véhicule n''est pas basé dans la ville de la course';
    end if;

    if tg_op = 'INSERT' and not v_staff and auth.uid() is not null
       and coalesce((select q.available_count from public.ride_quote(new.from_zone_id, new.to_zone_id) q
                     where q.model_id = new.model_id), 0) <= 0 then
      raise exception 'Plus aucun véhicule de ce modèle n''est libre pour le moment. Choisissez-en un autre.';
    end if;
  else
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

  -- -------------------------------------------------------------------
  -- Véhicule partenaire : qui conduit, disponibilité, part du partenaire
  -- -------------------------------------------------------------------
  if new.vehicle_id is not null then
    select * into v_vehicle from public.vehicles where id = new.vehicle_id;
  end if;

  if v_vehicle.owner_id is null then
    new.driven_by_owner := false;
    new.partner_share_pct := null;
  else
    if v_vehicle.drive_mode = 'owner' then
      if not new.with_driver then
        raise exception 'Le propriétaire de ce véhicule le conduit lui-même : il ne peut pas être loué sans chauffeur';
      end if;
      new.driven_by_owner := true;
    elsif v_vehicle.drive_mode = 'zoko' or not new.with_driver then
      new.driven_by_owner := false;
    end if;
    if new.driven_by_owner then
      new.driver_id := null;
    end if;

    if new.status in ('pending', 'confirmed')
       and (tg_op = 'INSERT'
            or (new.vehicle_id, new.start_at, new.end_at)
               is distinct from (old.vehicle_id, old.start_at, old.end_at)
            or old.status not in ('pending', 'confirmed')) then
      if not public.vehicle_free_for(new.vehicle_id, new.start_at, new.end_at) then
        raise exception 'Ce véhicule partenaire n''est pas disponible sur ce créneau (voir ses disponibilités).';
      end if;
      -- Un propriétaire ne conduit pas deux véhicules en même temps
      if new.driven_by_owner and exists (
        select 1 from public.reservations o
        join public.vehicles ov on ov.id = o.vehicle_id
        where ov.owner_id = v_vehicle.owner_id
          and o.id <> new.id
          and o.driven_by_owner
          and o.status in ('confirmed', 'in_progress')
          and tstzrange(o.start_at, o.end_at) && tstzrange(new.start_at, new.end_at)
      ) then
        raise exception 'Le propriétaire conduit déjà un autre de ses véhicules sur ce créneau.';
      end if;
    end if;

    -- Part du partenaire figée à l'attribution (ou si le conducteur change)
    if tg_op = 'INSERT' or new.partner_share_pct is null
       or (new.vehicle_id, new.driven_by_owner) is distinct from (old.vehicle_id, old.driven_by_owner) then
      new.partner_share_pct := coalesce((public.setting(
        case when new.driven_by_owner then 'partner_share_pct_owner_drives' else 'partner_share_pct_zoko_drives' end
      ))::integer, 0);
    end if;
  end if;

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


-- ---------------------------------------------------------------------
-- 4. Disponibilité : les véhicules partenaires ne comptent que s'ils sont libres
-- ---------------------------------------------------------------------
create or replace function public.available_models(
  p_start timestamptz,
  p_duration smallint,
  p_exclude_reservation uuid default null
)
returns table (model_id uuid, available_count integer, price integer)
language sql stable security definer set search_path = ''
as $$
  select
    m.id,
    greatest(0, count(v.id) filter (
      where v.status = 'available'
        and public.vehicle_free_for(v.id, p_start, p_start + make_interval(hours => p_duration))
        and not exists (
          select 1 from public.reservations r
          where r.vehicle_id = v.id
            and r.status in ('confirmed', 'in_progress')
            and r.id is distinct from p_exclude_reservation
            and tstzrange(r.start_at, r.end_at) && tstzrange(p_start, p_start + make_interval(hours => p_duration))
        )
    )::integer
    - (
      select count(*) from public.reservations r
      where r.model_id = m.id
        and r.status = 'pending'
        and r.id is distinct from p_exclude_reservation
        and tstzrange(r.start_at, r.end_at) && tstzrange(p_start, p_start + make_interval(hours => p_duration))
    )::integer),
    (public.current_rate(m.id, p_duration)).price
  from public.vehicle_models m
  left join public.vehicles v on v.model_id = m.id
  where m.is_active
  group by m.id
$$;

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
    select ctx.*, now() as s, now() + make_interval(mins => ctx.minutes) as e,
           tstzrange(now(), now() + make_interval(mins => ctx.minutes)) as w
    from ctx
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
         and public.vehicle_free_for(v.id, win.s, win.e)
         and not exists (
           select 1 from public.reservations r
           where r.vehicle_id = v.id
             and r.status in ('confirmed', 'in_progress')
             and tstzrange(r.start_at, r.end_at) && win.w))
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

-- Véhicules proposés pour confirmer : propriétaire et qui conduit en plus
drop function if exists public.vehicles_for_reservation(uuid);
create function public.vehicles_for_reservation(p_reservation_id uuid)
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
    and public.can_view_finance()
    and (r.kind = 'rental' or v.city = z.city)
    and (r.with_driver or v.drive_mode <> 'owner')
  order by v.owner_id nulls first, v.plate_number
$$;

revoke execute on function public.vehicles_for_reservation(uuid) from public, anon;
grant execute on function public.vehicles_for_reservation(uuid) to authenticated;


-- ---------------------------------------------------------------------
-- 5. Rappel « Chauffeur à attribuer » : pas quand le propriétaire conduit
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
-- 6. Règles des demandes partenaire et des véhicules proposés
-- ---------------------------------------------------------------------
create or replace function public.partners_guard()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if public.is_manager() then
    if tg_op = 'INSERT' or new.status is distinct from old.status then
      new.reviewed_by := auth.uid();
      new.reviewed_at := now();
    end if;
    return new;
  end if;

  if tg_op = 'INSERT' then
    new.profile_id := auth.uid();
    new.status := 'pending';
    new.review_note := null;
    new.reviewed_by := null;
    new.reviewed_at := null;
    return new;
  end if;

  if old.profile_id <> auth.uid() then
    raise exception 'Action non autorisée';
  end if;
  -- Le partenaire peut corriger sa demande, et redemander après un refus
  if new.status is distinct from old.status and not (old.status = 'rejected' and new.status = 'pending') then
    raise exception 'Seul le gérant peut changer le statut d''un partenaire';
  end if;
  new.profile_id := old.profile_id;
  new.review_note := case when new.status = 'pending' and old.status = 'rejected' then null else old.review_note end;
  new.reviewed_by := old.reviewed_by;
  new.reviewed_at := old.reviewed_at;
  return new;
end;
$$;

create trigger partners_guard before insert or update on public.partners
  for each row execute function public.partners_guard();

create or replace function public.partner_vehicles_guard()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  new.plate_number := upper(trim(new.plate_number));
  if public.is_manager() then
    if tg_op = 'INSERT' or new.status is distinct from old.status then
      new.reviewed_by := auth.uid();
      new.reviewed_at := now();
    end if;
    return new;
  end if;

  if not public.is_partner() then
    raise exception 'Votre compte partenaire doit être validé avant d''ajouter un véhicule';
  end if;

  if tg_op = 'INSERT' then
    new.owner_id := auth.uid();
  elsif old.owner_id <> auth.uid() then
    raise exception 'Véhicule introuvable';
  elsif old.status = 'approved' then
    raise exception 'Ce véhicule est validé : changez sa disponibilité dans votre espace, ou contactez Zoko pour le reste.';
  end if;
  -- Nouvelle proposition ou correction : repart en vérification
  new.status := 'pending';
  new.review_note := null;
  new.reviewed_by := null;
  new.reviewed_at := null;
  new.vehicle_id := null;
  return new;
end;
$$;

create trigger partner_vehicles_guard before insert or update on public.partner_vehicles
  for each row execute function public.partner_vehicles_guard();

-- Un partenaire dont un véhicule est dans la flotte ne peut pas disparaître
-- (suppression de compte) : message clair au lieu d'une erreur technique
create or replace function public.partners_before_delete()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if exists (select 1 from public.vehicles where owner_id = old.profile_id) then
    raise exception 'Un de vos véhicules est encore dans la flotte Zoko. Contactez Zoko pour le retirer avant de supprimer votre compte.';
  end if;
  return old;
end;
$$;

create trigger partners_before_delete before delete on public.partners
  for each row execute function public.partners_before_delete();

-- Notifications : demandes au gérant, décisions au partenaire
create or replace function public.partners_notify()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_name text;
begin
  select full_name into v_name from public.profiles where id = new.profile_id;
  if new.status = 'pending' and (tg_op = 'INSERT' or old.status <> 'pending') then
    insert into public.notifications (user_id, type, title, body)
    select p.id, 'other', 'Nouvelle demande Zoko Partenaire', coalesce(v_name, '') || ' · ' || new.city
    from public.profiles p
    where p.role in ('manager', 'admin') and p.is_active and p.id <> new.profile_id;
  elsif tg_op = 'UPDATE' and new.status is distinct from old.status then
    insert into public.notifications (user_id, type, title, body)
    values (new.profile_id, 'other',
      case new.status
        when 'approved'  then 'Bienvenue chez Zoko Partenaire !'
        when 'rejected'  then 'Demande partenaire non retenue'
        when 'suspended' then 'Compte partenaire suspendu'
        else 'Compte partenaire mis à jour' end,
      case new.status
        when 'approved' then 'Ajoutez votre véhicule depuis l''onglet Partenaire.'
        else coalesce(new.review_note, 'Contactez Zoko pour en savoir plus.') end);
  end if;
  return new;
end;
$$;

create trigger partners_notify after insert or update of status on public.partners
  for each row execute function public.partners_notify();

create or replace function public.partner_vehicles_notify()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_name text;
begin
  if new.status = 'pending' and (tg_op = 'INSERT' or old.status <> 'pending') then
    select full_name into v_name from public.profiles where id = new.owner_id;
    insert into public.notifications (user_id, type, title, body)
    select p.id, 'other', 'Véhicule partenaire à valider',
           new.brand || ' ' || new.name || ' · ' || new.plate_number || ' · ' || coalesce(v_name, '')
    from public.profiles p
    where p.role in ('manager', 'admin') and p.is_active and p.id <> new.owner_id;
  elsif tg_op = 'UPDATE' and new.status is distinct from old.status and new.status in ('approved', 'rejected') then
    insert into public.notifications (user_id, type, title, body)
    values (new.owner_id, 'other',
      case new.status when 'approved' then 'Véhicule validé' else 'Véhicule non retenu' end,
      new.brand || ' ' || new.name || ' · ' || new.plate_number
        || case when new.status = 'approved'
             then '. Rendez-le disponible depuis votre espace partenaire.'
             else coalesce('. ' || new.review_note, '') end);
  end if;
  return new;
end;
$$;

create trigger partner_vehicles_notify after insert or update of status on public.partner_vehicles
  for each row execute function public.partner_vehicles_notify();

-- Missions : prévenir le propriétaire quand son véhicule est attribué ou retiré
create or replace function public.reservations_partner_notify()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_tz        text := coalesce(public.setting('timezone') #>> '{}', 'Africa/Brazzaville');
  v_owner     uuid;
  v_old_owner uuid;
  v_what      text;
begin
  if new.vehicle_id is not null then
    select owner_id into v_owner from public.vehicles where id = new.vehicle_id;
  end if;
  if tg_op = 'UPDATE' and old.vehicle_id is not null then
    select owner_id into v_old_owner from public.vehicles where id = old.vehicle_id;
  end if;

  v_what := case when new.kind = 'ride' then 'Course' else 'Location' end || ' · '
            || to_char(new.start_at at time zone v_tz, 'DD/MM à HH24:MI') || ' · ' || new.pickup_address;

  -- Nouvelle mission
  if v_owner is not null and new.status = 'confirmed'
     and (tg_op = 'INSERT' or new.vehicle_id is distinct from old.vehicle_id or old.status <> 'confirmed') then
    insert into public.notifications (user_id, type, title, body, reservation_id)
    values (v_owner, 'other', 'Nouvelle mission · ' || new.reference,
            v_what || case when new.driven_by_owner then '. Vous conduisez.' else '. Un chauffeur Zoko conduit.' end,
            new.id);
  end if;

  -- Mission retirée ou annulée (sauf si c'est le partenaire qui l'a refusée)
  if v_old_owner is not null and old.status in ('confirmed', 'in_progress')
     and coalesce(current_setting('zoko.partner_decline', true), '') <> 'on'
     and (new.vehicle_id is distinct from old.vehicle_id or new.status in ('cancelled', 'rejected', 'no_show')) then
    insert into public.notifications (user_id, type, title, body, reservation_id)
    values (v_old_owner, 'other', 'Mission annulée · ' || new.reference, v_what, new.id);
  end if;

  return new;
end;
$$;

create trigger reservations_partner_notify after insert or update on public.reservations
  for each row execute function public.reservations_partner_notify();


-- ---------------------------------------------------------------------
-- 7. Actions du partenaire (fonctions : il ne modifie jamais les tables directement)
-- ---------------------------------------------------------------------

-- Disponible maintenant / qui conduit
create or replace function public.partner_set_vehicle(
  p_vehicle_id uuid,
  p_available_now boolean default null,
  p_drive_mode public.drive_mode default null
)
returns void
language plpgsql security definer set search_path = ''
as $$
begin
  if not public.is_partner() then
    raise exception 'Votre compte partenaire n''est pas actif';
  end if;
  update public.vehicles
     set available_now = coalesce(p_available_now, available_now),
         available_now_at = case when p_available_now is not null then now() else available_now_at end,
         drive_mode = coalesce(p_drive_mode, drive_mode)
   where id = p_vehicle_id and owner_id = auth.uid();
  -- Une fois validé, c'est la fiche de la flotte (vehicles) qui fait foi
  if not found then
    raise exception 'Véhicule introuvable';
  end if;
end;
$$;

-- Missions du partenaire : uniquement ce dont il a besoin
create or replace function public.partner_missions()
returns table (
  id uuid, reference text, kind public.reservation_kind, status public.reservation_status,
  start_at timestamptz, end_at timestamptz, vehicle_id uuid, plate_number text, model_name text,
  from_zone_name text, to_zone_name text, pickup_address text, dropoff_address text,
  client_name text, contact_phone text, driven_by_owner boolean, with_driver boolean,
  total_price integer, partner_share_pct smallint, partner_amount integer
)
language sql stable security definer set search_path = ''
as $$
  select r.id, r.reference, r.kind, r.status, r.start_at, r.end_at, v.id, v.plate_number,
         m.brand || ' ' || m.name,
         fz.name, tz.name, r.pickup_address, r.dropoff_address,
         -- coordonnées du client seulement pendant la mission
         case when r.status in ('confirmed', 'in_progress') then c.full_name else split_part(c.full_name, ' ', 1) end,
         case when r.status in ('confirmed', 'in_progress') then r.contact_phone end,
         r.driven_by_owner, r.with_driver,
         r.total_price, r.partner_share_pct,
         (r.total_price * coalesce(r.partner_share_pct, 0) / 100)::integer
  from public.reservations r
  join public.vehicles v on v.id = r.vehicle_id and v.owner_id = auth.uid()
  join public.vehicle_models m on m.id = r.model_id
  join public.profiles c on c.id = r.client_id
  left join public.ride_zones fz on fz.id = r.from_zone_id
  left join public.ride_zones tz on tz.id = r.to_zone_id
  where r.status not in ('pending', 'rejected')
  order by r.start_at desc
  limit 300
$$;

-- Refuser une mission confirmée : elle repart chez les agents
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
  where p.role in ('manager', 'agent') and p.is_active;
end;
$$;

-- Gérant : valider un véhicule proposé (modèle existant, ou nouveau modèle créé
-- à partir de la fiche ; un nouveau modèle reste masqué tant qu'il n'a pas de tarifs)
create or replace function public.approve_partner_vehicle(
  p_partner_vehicle_id uuid,
  p_model_id uuid default null
)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  v_pv      public.partner_vehicles;
  v_model   uuid := p_model_id;
  v_vehicle uuid;
  v_i       integer := 0;
  v_url     text;
begin
  if not public.is_manager() then
    raise exception 'Seul le gérant peut valider un véhicule';
  end if;
  select * into v_pv from public.partner_vehicles where id = p_partner_vehicle_id for update;
  if v_pv.id is null then
    raise exception 'Véhicule introuvable';
  end if;
  if v_pv.vehicle_id is not null then
    raise exception 'Ce véhicule est déjà dans la flotte';
  end if;
  if not exists (select 1 from public.partners where profile_id = v_pv.owner_id and status = 'approved') then
    raise exception 'Validez d''abord le partenaire';
  end if;

  if v_model is null then
    insert into public.vehicle_models (brand, name, seats, transmission, features, is_active)
    values (trim(v_pv.brand), trim(v_pv.name), v_pv.seats, v_pv.transmission, '{"Avec chauffeur"}', false)
    on conflict (brand, name) do nothing
    returning id into v_model;
    if v_model is null then
      select id into v_model from public.vehicle_models where brand = trim(v_pv.brand) and name = trim(v_pv.name);
    else
      foreach v_url in array v_pv.photos loop
        insert into public.vehicle_photos (model_id, url, position) values (v_model, v_url, v_i);
        v_i := v_i + 1;
      end loop;
    end if;
  end if;

  insert into public.vehicles (model_id, plate_number, color, year, city, owner_id, drive_mode, status, notes)
  values (v_model, v_pv.plate_number, v_pv.color, v_pv.year, v_pv.city, v_pv.owner_id, v_pv.drive_mode, 'available',
          'Véhicule partenaire')
  returning id into v_vehicle;

  update public.partner_vehicles
     set status = 'approved', vehicle_id = v_vehicle, review_note = null
   where id = v_pv.id;

  return v_model;
end;
$$;

revoke execute on function public.partner_set_vehicle(uuid, boolean, public.drive_mode) from public, anon;
revoke execute on function public.partner_missions() from public, anon;
revoke execute on function public.partner_decline_mission(uuid, text) from public, anon;
revoke execute on function public.approve_partner_vehicle(uuid, uuid) from public, anon;
grant execute on function public.partner_set_vehicle(uuid, boolean, public.drive_mode) to authenticated;
grant execute on function public.partner_missions() to authenticated;
grant execute on function public.partner_decline_mission(uuid, text) to authenticated;
grant execute on function public.approve_partner_vehicle(uuid, uuid) to authenticated;


-- ---------------------------------------------------------------------
-- 8. Le client voit le propriétaire qui le conduit (nom et téléphone)
-- ---------------------------------------------------------------------
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
    and (r.client_id = auth.uid() or public.can_view_finance())
$$;

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
  r.ride_minutes,
  r.driven_by_owner,
  r.partner_share_pct,
  public.reservation_owner_contact(r.id) as owner_contact
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
-- 9. Sécurité
-- ---------------------------------------------------------------------
alter table public.partners             enable row level security;
alter table public.partner_vehicles     enable row level security;
alter table public.vehicle_availability enable row level security;

create policy "partners: lecture" on public.partners
  for select to authenticated using (profile_id = auth.uid() or public.can_view_finance());
create policy "partners: demande" on public.partners
  for insert to authenticated
  with check (exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_active));
create policy "partners: modification" on public.partners
  for update to authenticated
  using (profile_id = auth.uid() or public.is_manager())
  with check (profile_id = auth.uid() or public.is_manager());
create policy "partners: suppression" on public.partners
  for delete to authenticated using (public.is_admin());

create policy "partner vehicles: lecture" on public.partner_vehicles
  for select to authenticated using (owner_id = auth.uid() or public.can_view_finance());
create policy "partner vehicles: ajout" on public.partner_vehicles
  for insert to authenticated with check (public.is_partner() or public.is_manager());
create policy "partner vehicles: modification" on public.partner_vehicles
  for update to authenticated
  using (owner_id = auth.uid() or public.is_manager())
  with check (owner_id = auth.uid() or public.is_manager());
create policy "partner vehicles: suppression" on public.partner_vehicles
  for delete to authenticated
  using ((owner_id = auth.uid() and status <> 'approved') or public.is_manager());

create policy "vehicles: lecture propriétaire" on public.vehicles
  for select to authenticated using (owner_id = auth.uid());

create policy "availability: lecture" on public.vehicle_availability
  for select to authenticated using (public.is_vehicle_owner(vehicle_id) or public.can_view_finance());
create policy "availability: ajout" on public.vehicle_availability
  for insert to authenticated
  with check ((public.is_partner() and public.is_vehicle_owner(vehicle_id)) or public.is_manager());
create policy "availability: suppression" on public.vehicle_availability
  for delete to authenticated using (public.is_vehicle_owner(vehicle_id) or public.is_manager());

-- Photos des véhicules proposés : dossier partners/<id du partenaire>/
create policy "vehicle photos: envoi partenaire" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'vehicle-photos'
              and (storage.foldername(name))[1] = 'partners'
              and (storage.foldername(name))[2] = auth.uid()::text
              and public.is_partner());

grant select, insert, update, delete on public.partners, public.partner_vehicles, public.vehicle_availability to authenticated;

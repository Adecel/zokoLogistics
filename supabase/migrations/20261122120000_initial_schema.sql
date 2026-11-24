-- =====================================================================
-- ZOKO LOGISTICS ET VOYAGE : schéma initial de la base de données
-- Location de véhicules avec chauffeur, Pointe-Noire
--
-- Organisation :
--   1. Extensions et types
--   2. Tables (utilisateurs, flotte, tarifs, réservations, paiements...)
--   3. Fonctions utilitaires et triggers (règles métier côté serveur)
--   4. Sécurité : Row Level Security par rôle
--   5. Vues de rapports
--
-- Conventions :
--   - Montants en FCFA (XAF), entiers, sans décimales
--   - Dates en timestamptz (UTC en base, affichées en Africa/Brazzaville)
--   - Les prix sont calculés par le serveur, jamais envoyés par l'app
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1. EXTENSIONS ET TYPES
-- ---------------------------------------------------------------------

-- Permet les contraintes "pas de chevauchement" (anti double réservation)
create extension if not exists btree_gist with schema extensions;

create type public.user_role as enum (
  'client',      -- client de l'application
  'manager',     -- gérante : gère tout
  'agent',       -- agent : confirme et suit les réservations
  'driver',      -- chauffeur : voit ses courses
  'accountant',  -- comptabilité : paiements et rapports
  'admin'        -- administrateur technique
);

create type public.vehicle_status as enum ('available', 'maintenance', 'out_of_service');
create type public.transmission_type as enum ('manual', 'automatic');
create type public.fuel_type as enum ('petrol', 'diesel', 'hybrid', 'electric');

create type public.reservation_status as enum (
  'pending',      -- en attente de confirmation par un agent
  'confirmed',    -- confirmée (véhicule + chauffeur attribués)
  'in_progress',  -- location en cours
  'completed',    -- terminée
  'cancelled',    -- annulée (par le client ou l'équipe)
  'rejected',     -- refusée par l'équipe
  'no_show'       -- client absent
);

create type public.payment_method as enum ('airtel_money', 'mtn_mobile_money', 'bank_transfer');
create type public.payment_kind as enum ('payment', 'refund');
create type public.payment_status as enum ('pending', 'succeeded', 'failed', 'cancelled');
create type public.charge_type as enum ('overtime', 'fuel', 'other');
create type public.discount_type as enum ('percent', 'fixed');

create type public.notification_type as enum (
  'reservation_created',
  'reservation_confirmed',
  'reservation_rejected',
  'reservation_cancelled',
  'reservation_updated',
  'payment_received',
  'payment_refunded',
  'rental_reminder',
  'rental_started',
  'rental_ended',
  'promotion',
  'other'
);


-- ---------------------------------------------------------------------
-- 2. TABLES
-- ---------------------------------------------------------------------

-- Profil de chaque utilisateur (client ou membre de l'équipe).
-- Lié 1-1 au compte de connexion Supabase (auth.users).
create table public.profiles (
  id          uuid primary key references auth.users (id) on delete cascade,
  full_name   text not null check (length(trim(full_name)) >= 2),
  phone       text unique,
  email       text,
  role        public.user_role not null default 'client',
  avatar_url  text,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
comment on table public.profiles is 'Utilisateurs : clients et équipe Zoko (rôle).';

-- Modèle de véhicule (ce que le client choisit) : S-Presso, Jimny, Fronx...
create table public.vehicle_models (
  id            uuid primary key default gen_random_uuid(),
  brand         text not null,
  name          text not null,
  seats         smallint not null check (seats > 0),
  transmission  public.transmission_type not null,
  fuel_type     public.fuel_type not null default 'petrol',
  features      text[] not null default '{}',   -- ex. {Climatisation, GPS, Bluetooth}
  description   text,
  is_active     boolean not null default true,   -- visible dans le catalogue
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (brand, name)
);
comment on table public.vehicle_models is 'Catalogue : un modèle peut avoir plusieurs véhicules physiques.';

-- Photos d'un modèle (fichiers dans Supabase Storage)
create table public.vehicle_photos (
  id          uuid primary key default gen_random_uuid(),
  model_id    uuid not null references public.vehicle_models (id) on delete cascade,
  url         text not null,
  position    smallint not null default 0,
  created_at  timestamptz not null default now()
);

-- Véhicule physique (une plaque = une ligne). La flotte compte 4 véhicules.
create table public.vehicles (
  id            uuid primary key default gen_random_uuid(),
  model_id      uuid not null references public.vehicle_models (id) on delete restrict,
  plate_number  text not null unique,
  color         text,
  year          smallint check (year between 1990 and 2100),
  status        public.vehicle_status not null default 'available',
  mileage_km    integer check (mileage_km >= 0),
  notes         text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
comment on table public.vehicles is 'Flotte réelle. Les réservations sont attribuées à un véhicule précis.';

-- Tarifs par modèle et par durée, avec historique.
-- Un changement de prix = nouvelle ligne (l'ancienne reçoit valid_to),
-- ce qui garde les rapports justes dans le temps.
create table public.rates (
  id              uuid primary key default gen_random_uuid(),
  model_id        uuid not null references public.vehicle_models (id) on delete cascade,
  duration_hours  smallint not null check (duration_hours in (6, 12)),
  price           integer not null check (price > 0),
  valid_from      timestamptz not null default now(),
  valid_to        timestamptz,
  created_by      uuid references public.profiles (id) on delete set null,
  created_at      timestamptz not null default now(),
  check (valid_to is null or valid_to > valid_from),
  -- jamais deux tarifs actifs en même temps pour le même modèle et la même durée
  constraint rates_no_overlap exclude using gist (
    model_id with =,
    duration_hours with =,
    tstzrange(valid_from, valid_to) with &&
  )
);
comment on table public.rates is 'Grille tarifaire historisée (6 h / 12 h) par modèle.';

-- Chauffeurs : complément du profil (rôle driver). L'entreprise attribue le chauffeur.
create table public.drivers (
  profile_id         uuid primary key references public.profiles (id) on delete cascade,
  license_number     text unique,
  license_expires_on date,
  is_available       boolean not null default true,
  notes              text,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

-- Codes promo et offres spéciales
create table public.promotions (
  id              uuid primary key default gen_random_uuid(),
  code            text not null unique check (code = upper(code) and length(code) >= 3),
  description     text,
  discount_type   public.discount_type not null,
  discount_value  integer not null check (discount_value > 0),
  starts_at       timestamptz not null default now(),
  ends_at         timestamptz,
  max_uses        integer check (max_uses > 0),
  is_active       boolean not null default true,
  created_at      timestamptz not null default now(),
  check (discount_type <> 'percent' or discount_value <= 100),
  check (ends_at is null or ends_at > starts_at)
);

-- Numéro lisible des réservations : ZK-2026-00001
create sequence public.reservation_number_seq;

-- Réservation : le cœur de l'application
create table public.reservations (
  id                   uuid primary key default gen_random_uuid(),
  reference            text not null unique,
  client_id            uuid not null references public.profiles (id) on delete restrict,
  model_id             uuid not null references public.vehicle_models (id) on delete restrict,
  vehicle_id           uuid references public.vehicles (id) on delete restrict,      -- attribué par l'agent
  driver_id            uuid references public.drivers (profile_id) on delete set null, -- attribué par l'agent
  rate_id              uuid references public.rates (id) on delete restrict,          -- tarif appliqué
  promotion_id         uuid references public.promotions (id) on delete set null,

  start_at             timestamptz not null,
  duration_hours       smallint not null check (duration_hours in (6, 12)),
  end_at               timestamptz not null,            -- calculé : start_at + durée
  pickup_address       text not null check (length(trim(pickup_address)) > 0),
  dropoff_address      text,                            -- restitution possible ailleurs
  contact_phone        text not null,

  base_price           integer not null check (base_price >= 0),
  discount_amount      integer not null default 0 check (discount_amount >= 0),
  total_price          integer generated always as (base_price - discount_amount) stored,

  status               public.reservation_status not null default 'pending',
  client_notes         text,
  internal_notes       text,                            -- visible par l'équipe seulement (via l'app)

  confirmed_by         uuid references public.profiles (id) on delete set null,
  confirmed_at         timestamptz,
  cancelled_by         uuid references public.profiles (id) on delete set null,
  cancelled_at         timestamptz,
  cancellation_reason  text,
  actual_start_at      timestamptz,                     -- début réel de la location
  actual_end_at        timestamptz,                     -- fin réelle (dépassement éventuel)

  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),

  check (discount_amount <= base_price),
  check (end_at > start_at),
  check (actual_end_at is null or actual_start_at is null or actual_end_at > actual_start_at),
  check (status not in ('confirmed', 'in_progress', 'completed') or vehicle_id is not null),

  -- Anti double réservation : un véhicule ne peut pas avoir deux locations qui se chevauchent
  constraint reservations_vehicle_no_overlap exclude using gist (
    vehicle_id with =,
    tstzrange(start_at, end_at) with &&
  ) where (vehicle_id is not null and status in ('confirmed', 'in_progress')),

  -- Un chauffeur ne peut pas conduire deux locations en même temps
  constraint reservations_driver_no_overlap exclude using gist (
    driver_id with =,
    tstzrange(start_at, end_at) with &&
  ) where (driver_id is not null and status in ('confirmed', 'in_progress'))
);
comment on table public.reservations is 'Réservations clients. Le prix est figé au moment de la réservation.';

-- Frais supplémentaires : dépassement horaire, carburant au-delà des 5 L inclus...
create table public.reservation_charges (
  id              uuid primary key default gen_random_uuid(),
  reservation_id  uuid not null references public.reservations (id) on delete cascade,
  type            public.charge_type not null,
  description     text,
  amount          integer not null check (amount > 0),
  created_by      uuid references public.profiles (id) on delete set null,
  created_at      timestamptz not null default now()
);

-- Paiements et remboursements (paiement intégral, pas de caution)
create table public.payments (
  id                     uuid primary key default gen_random_uuid(),
  reservation_id         uuid not null references public.reservations (id) on delete restrict,
  kind                   public.payment_kind not null default 'payment',
  method                 public.payment_method not null,
  status                 public.payment_status not null default 'pending',
  amount                 integer not null check (amount > 0),
  transaction_reference  text,            -- n° de transaction Airtel / MTN / virement
  payer_phone            text,
  paid_at                timestamptz,
  recorded_by            uuid references public.profiles (id) on delete set null,
  verified_by            uuid references public.profiles (id) on delete set null,
  verified_at            timestamptz,
  notes                  text,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  check (status <> 'succeeded' or paid_at is not null)
);
create unique index payments_transaction_reference_key
  on public.payments (method, transaction_reference)
  where transaction_reference is not null;

-- Historique des statuts : traçabilité complète (qui a fait quoi, quand)
create table public.reservation_status_history (
  id              bigint generated always as identity primary key,
  reservation_id  uuid not null references public.reservations (id) on delete cascade,
  from_status     public.reservation_status,
  to_status       public.reservation_status not null,
  changed_by      uuid references public.profiles (id) on delete set null,
  note            text,
  changed_at      timestamptz not null default now()
);

-- Notifications dans l'app (clients et équipe)
create table public.notifications (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references public.profiles (id) on delete cascade,
  type            public.notification_type not null,
  title           text not null,
  body            text,
  reservation_id  uuid references public.reservations (id) on delete set null,
  read_at         timestamptz,
  created_at      timestamptz not null default now()
);

-- Paramètres modifiables par la gérante sans toucher au code
create table public.app_settings (
  key          text primary key,
  value        jsonb not null,
  description  text,
  updated_by   uuid references public.profiles (id) on delete set null,
  updated_at   timestamptz not null default now()
);

-- Index pour les écrans et les rapports
create index on public.vehicles (model_id);
create index on public.vehicle_photos (model_id, position);
create index on public.rates (model_id, duration_hours, valid_from desc);
create index on public.reservations (client_id, start_at desc);
create index on public.reservations (status, start_at);
create index on public.reservations (vehicle_id, start_at);
create index on public.reservations (driver_id, start_at);
create index on public.reservations (model_id, start_at);
create index on public.reservations (created_at);
create index on public.reservation_charges (reservation_id);
create index on public.payments (reservation_id);
create index on public.payments (status, paid_at);
create index on public.reservation_status_history (reservation_id, changed_at);
create index on public.notifications (user_id, created_at desc);
create index on public.notifications (user_id) where read_at is null;


-- ---------------------------------------------------------------------
-- 3. FONCTIONS ET TRIGGERS
-- ---------------------------------------------------------------------

-- Rôle de l'utilisateur connecté (null si non connecté)
create or replace function public.current_user_role()
returns public.user_role
language sql stable security definer set search_path = ''
as $$
  select role from public.profiles where id = auth.uid() and is_active
$$;

-- Équipe qui gère les réservations
create or replace function public.is_staff()
returns boolean
language sql stable security definer set search_path = ''
as $$
  select coalesce(public.current_user_role() in ('manager', 'agent', 'admin'), false)
$$;

-- Équipe avec droits de direction (flotte, tarifs, utilisateurs)
create or replace function public.is_manager()
returns boolean
language sql stable security definer set search_path = ''
as $$
  select coalesce(public.current_user_role() in ('manager', 'admin'), false)
$$;

-- Équipe qui peut voir l'argent (rapports, paiements)
create or replace function public.can_view_finance()
returns boolean
language sql stable security definer set search_path = ''
as $$
  select coalesce(public.current_user_role() in ('manager', 'agent', 'admin', 'accountant'), false)
$$;

-- Lecture d'un paramètre
create or replace function public.setting(p_key text)
returns jsonb
language sql stable security definer set search_path = ''
as $$
  select value from public.app_settings where key = p_key
$$;

-- updated_at automatique
create or replace function public.set_updated_at()
returns trigger
language plpgsql set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger set_updated_at before update on public.profiles
  for each row execute function public.set_updated_at();
create trigger set_updated_at before update on public.vehicle_models
  for each row execute function public.set_updated_at();
create trigger set_updated_at before update on public.vehicles
  for each row execute function public.set_updated_at();
create trigger set_updated_at before update on public.drivers
  for each row execute function public.set_updated_at();
create trigger set_updated_at before update on public.reservations
  for each row execute function public.set_updated_at();
create trigger set_updated_at before update on public.payments
  for each row execute function public.set_updated_at();

-- Création automatique du profil à l'inscription.
-- L'app envoie full_name et phone dans les metadata du signUp.
create or replace function public.handle_new_user()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  insert into public.profiles (id, full_name, phone, email)
  values (
    new.id,
    coalesce(nullif(trim(new.raw_user_meta_data ->> 'full_name'), ''), 'Client Zoko'),
    coalesce(nullif(trim(new.raw_user_meta_data ->> 'phone'), ''), new.phone),
    new.email
  );
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Un utilisateur ne peut pas changer son propre rôle ni s'activer lui-même
create or replace function public.profiles_guard()
returns trigger
language plpgsql set search_path = ''
as $$
begin
  if auth.uid() is not null and not public.is_manager()
     and (new.role is distinct from old.role or new.is_active is distinct from old.is_active) then
    raise exception 'Seule la gérante peut modifier le rôle ou le statut d''un compte';
  end if;
  return new;
end;
$$;

create trigger profiles_guard before update on public.profiles
  for each row execute function public.profiles_guard();

-- Tarif en vigueur pour un modèle et une durée
create or replace function public.current_rate(p_model_id uuid, p_duration smallint, p_at timestamptz default now())
returns public.rates
language sql stable security definer set search_path = ''
as $$
  select r.* from public.rates r
  where r.model_id = p_model_id
    and r.duration_hours = p_duration
    and r.valid_from <= p_at
    and (r.valid_to is null or r.valid_to > p_at)
  limit 1
$$;

-- Prix, référence, date de fin et règles métier calculés côté serveur
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
begin
  -- Règles propres aux clients (l'équipe peut saisir une réservation pour un client)
  if not v_staff and auth.uid() is not null then
    if tg_op = 'INSERT' then
      new.client_id := auth.uid();
      new.status := 'pending';
      new.vehicle_id := null;
      new.driver_id := null;
      new.internal_notes := null;
    else
      if old.client_id <> auth.uid() then
        raise exception 'Réservation introuvable';
      end if;
      if old.status not in ('pending', 'confirmed') or old.start_at <= now() then
        raise exception 'Cette réservation ne peut plus être modifiée';
      end if;
      -- Le client peut seulement annuler, ou modifier date / durée / lieux / téléphone / notes
      if new.status <> old.status and new.status <> 'cancelled' then
        raise exception 'Action non autorisée';
      end if;
      new.client_id := old.client_id;
      new.vehicle_id := old.vehicle_id;
      new.driver_id := old.driver_id;
      new.internal_notes := old.internal_notes;
      new.confirmed_by := old.confirmed_by;
      new.confirmed_at := old.confirmed_at;
      new.actual_start_at := old.actual_start_at;
      new.actual_end_at := old.actual_end_at;
      new.promotion_id := old.promotion_id;
      -- Une réservation confirmée dont la date ou le modèle change repasse en attente
      if new.status <> 'cancelled' and old.status = 'confirmed'
         and (new.start_at, new.duration_hours, new.model_id)
             is distinct from (old.start_at, old.duration_hours, old.model_id) then
        new.status := 'pending';
        new.vehicle_id := null;
        new.driver_id := null;
        new.confirmed_by := null;
        new.confirmed_at := null;
      end if;
    end if;

    -- Réservation au moins N jour(s) à l'avance (date locale Pointe-Noire)
    if new.status <> 'cancelled'
       and (tg_op = 'INSERT' or new.start_at is distinct from old.start_at)
       and (new.start_at at time zone v_tz)::date < ((now() at time zone v_tz)::date + v_min_days) then
      raise exception 'La réservation doit être faite au moins % jour(s) à l''avance', v_min_days;
    end if;
  end if;

  -- Référence lisible
  if tg_op = 'INSERT' then
    new.reference := 'ZK-' || to_char(now() at time zone v_tz, 'YYYY') || '-'
                     || lpad(nextval('public.reservation_number_seq')::text, 5, '0');
  end if;

  -- Fin de location
  new.end_at := new.start_at + make_interval(hours => new.duration_hours);

  -- Le véhicule attribué doit correspondre au modèle réservé
  if new.vehicle_id is not null and not exists (
    select 1 from public.vehicles v where v.id = new.vehicle_id and v.model_id = new.model_id
  ) then
    raise exception 'Le véhicule attribué ne correspond pas au modèle réservé';
  end if;

  -- Prix : recalculé à la création, ou si modèle / durée / promo changent
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

create trigger reservations_before_write
  before insert or update on public.reservations
  for each row execute function public.reservations_before_write();

-- Après écriture : historique des statuts + notifications
create or replace function public.reservations_after_write()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_title text;
  v_type  public.notification_type;
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

  -- Nouvelle réservation : prévenir l'équipe
  if tg_op = 'INSERT' then
    insert into public.notifications (user_id, type, title, body, reservation_id)
    select p.id, 'reservation_created', 'Nouvelle réservation ' || new.reference,
           'Début le ' || to_char(new.start_at at time zone 'Africa/Brazzaville', 'DD/MM/YYYY à HH24:MI')
           || ' · ' || new.duration_hours || ' h',
           new.id
    from public.profiles p
    where p.role in ('manager', 'agent') and p.is_active;
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
    v_title := case new.status
      when 'confirmed'   then 'Réservation confirmée'
      when 'rejected'    then 'Réservation refusée'
      when 'cancelled'   then 'Réservation annulée'
      when 'in_progress' then 'Votre location a commencé'
      when 'completed'   then 'Location terminée'
      when 'pending'     then 'Réservation modifiée, en attente de confirmation'
      else null
    end;
    if v_type is not null then
      insert into public.notifications (user_id, type, title, body, reservation_id)
      values (new.client_id, v_type, v_title, 'Réservation ' || new.reference, new.id);
    end if;

    -- Début / fin de location et annulations : prévenir aussi la gérante
    if new.status in ('in_progress', 'completed', 'cancelled') then
      insert into public.notifications (user_id, type, title, body, reservation_id)
      select p.id, v_type, v_title || ' · ' || new.reference, null, new.id
      from public.profiles p
      where p.role = 'manager' and p.is_active and p.id <> new.client_id;
    end if;
  end if;

  return new;
end;
$$;

create trigger reservations_after_write
  after insert or update on public.reservations
  for each row execute function public.reservations_after_write();

-- Paiements : règles client + notifications
create or replace function public.payments_before_write()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if not public.can_view_finance() and auth.uid() is not null then
    -- Le client déclare son paiement (n° de transaction) ; un agent le valide ensuite
    if tg_op = 'UPDATE' then
      raise exception 'Action non autorisée';
    end if;
    if not exists (select 1 from public.reservations r where r.id = new.reservation_id and r.client_id = auth.uid()) then
      raise exception 'Réservation introuvable';
    end if;
    new.kind := 'payment';
    new.status := 'pending';
    new.paid_at := null;
    new.verified_by := null;
    new.verified_at := null;
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

create trigger payments_before_write
  before insert or update on public.payments
  for each row execute function public.payments_before_write();

create or replace function public.payments_after_write()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_res public.reservations;
begin
  if new.status = 'succeeded' and (tg_op = 'INSERT' or old.status <> 'succeeded') then
    select * into v_res from public.reservations where id = new.reservation_id;

    insert into public.notifications (user_id, type, title, body, reservation_id)
    values (
      v_res.client_id,
      case new.kind when 'refund' then 'payment_refunded' else 'payment_received' end::public.notification_type,
      case new.kind when 'refund' then 'Remboursement effectué' else 'Paiement reçu' end,
      new.amount || ' FCFA · Réservation ' || v_res.reference,
      v_res.id
    );

    insert into public.notifications (user_id, type, title, body, reservation_id)
    select p.id,
           case new.kind when 'refund' then 'payment_refunded' else 'payment_received' end::public.notification_type,
           case new.kind when 'refund' then 'Remboursement ' else 'Paiement ' end || v_res.reference,
           new.amount || ' FCFA',
           v_res.id
    from public.profiles p
    where p.role in ('manager', 'accountant') and p.is_active;
  end if;
  return new;
end;
$$;

create trigger payments_after_write
  after insert or update on public.payments
  for each row execute function public.payments_after_write();

-- Disponibilité en temps réel : nombre de véhicules libres par modèle
-- pour un créneau donné (le client ne voit pas les réservations des autres).
create or replace function public.available_models(p_start timestamptz, p_duration smallint)
returns table (model_id uuid, available_count integer, price integer)
language sql stable security definer set search_path = ''
as $$
  select
    m.id,
    greatest(0, count(v.id) filter (
      where v.status = 'available'
        and not exists (
          select 1 from public.reservations r
          where r.vehicle_id = v.id
            and r.status in ('confirmed', 'in_progress')
            and tstzrange(r.start_at, r.end_at) && tstzrange(p_start, p_start + make_interval(hours => p_duration))
        )
    )::integer
    -- les demandes en attente sur ce modèle réduisent aussi la disponibilité affichée
    - (
      select count(*) from public.reservations r
      where r.model_id = m.id
        and r.status = 'pending'
        and tstzrange(r.start_at, r.end_at) && tstzrange(p_start, p_start + make_interval(hours => p_duration))
    )::integer),
    (public.current_rate(m.id, p_duration)).price
  from public.vehicle_models m
  left join public.vehicles v on v.model_id = m.id
  where m.is_active
  group by m.id
$$;


-- Catalogue public : modèles actifs avec tarifs en vigueur, photos et taille de flotte.
-- Une seule requête pour l'app (accueil, catalogue, fiche véhicule).
-- prices = {"6": 15000, "12": 20000}
create or replace function public.vehicle_catalog(p_model_id uuid default null)
returns table (
  id             uuid,
  brand          text,
  name           text,
  seats          smallint,
  transmission   public.transmission_type,
  fuel_type      public.fuel_type,
  features       text[],
  description    text,
  prices         jsonb,
  photos         text[],
  vehicle_count  integer
)
language sql stable security definer set search_path = ''
as $$
  select
    m.id, m.brand, m.name, m.seats, m.transmission, m.fuel_type, m.features, m.description,
    p.prices,
    coalesce((select array_agg(ph.url order by ph.position, ph.created_at)
              from public.vehicle_photos ph where ph.model_id = m.id), '{}'),
    (select count(*)::integer from public.vehicles v
     where v.model_id = m.id and v.status <> 'out_of_service')
  from public.vehicle_models m
  cross join lateral (
    select jsonb_object_agg(r.duration_hours::text, r.price) as prices
    from public.rates r
    where r.model_id = m.id
      and r.valid_from <= now()
      and (r.valid_to is null or r.valid_to > now())
  ) p
  where m.is_active
    and p.prices is not null                       -- pas de tarif = pas affiché
    and (p_model_id is null or m.id = p_model_id)
  order by (p.prices ->> '6')::integer nulls last, m.name
$$;

grant execute on function public.vehicle_catalog(uuid) to anon, authenticated;


-- ---------------------------------------------------------------------
-- 4. SÉCURITÉ (Row Level Security)
-- Chaque table est fermée par défaut ; les politiques ouvrent l'accès par rôle.
-- ---------------------------------------------------------------------

alter table public.profiles                   enable row level security;
alter table public.vehicle_models             enable row level security;
alter table public.vehicle_photos             enable row level security;
alter table public.vehicles                   enable row level security;
alter table public.rates                      enable row level security;
alter table public.drivers                    enable row level security;
alter table public.promotions                 enable row level security;
alter table public.reservations               enable row level security;
alter table public.reservation_charges        enable row level security;
alter table public.payments                   enable row level security;
alter table public.reservation_status_history enable row level security;
alter table public.notifications              enable row level security;
alter table public.app_settings               enable row level security;

-- Profils
create policy "profiles: lire le sien ou équipe" on public.profiles
  for select to authenticated
  using (id = auth.uid() or public.can_view_finance()
         or (public.current_user_role() = 'driver' and exists (
               select 1 from public.reservations r
               where r.client_id = profiles.id and r.driver_id = auth.uid())));
create policy "profiles: modifier le sien" on public.profiles
  for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());
create policy "profiles: gérante modifie tout" on public.profiles
  for update to authenticated
  using (public.is_manager()) with check (public.is_manager());

-- Catalogue : lisible par tous les utilisateurs connectés, géré par la gérante
create policy "models: lecture" on public.vehicle_models
  for select to anon, authenticated using (is_active or public.is_staff());
create policy "models: gestion" on public.vehicle_models
  for all to authenticated using (public.is_manager()) with check (public.is_manager());

create policy "photos: lecture" on public.vehicle_photos
  for select to anon, authenticated using (true);
create policy "photos: gestion" on public.vehicle_photos
  for all to authenticated using (public.is_manager()) with check (public.is_manager());

create policy "vehicles: lecture équipe" on public.vehicles
  for select to authenticated
  using (public.is_staff() or public.current_user_role() in ('driver', 'accountant'));
create policy "vehicles: gestion" on public.vehicles
  for all to authenticated using (public.is_manager()) with check (public.is_manager());

create policy "rates: lecture" on public.rates
  for select to anon, authenticated using (true);
create policy "rates: gestion" on public.rates
  for all to authenticated using (public.is_manager()) with check (public.is_manager());

-- Chauffeurs
create policy "drivers: lecture" on public.drivers
  for select to authenticated using (profile_id = auth.uid() or public.is_staff());
create policy "drivers: gestion" on public.drivers
  for all to authenticated using (public.is_manager()) with check (public.is_manager());

-- Promotions : les clients voient les offres actives
create policy "promotions: lecture" on public.promotions
  for select to authenticated
  using ((is_active and starts_at <= now() and (ends_at is null or ends_at > now())) or public.can_view_finance());
create policy "promotions: gestion" on public.promotions
  for all to authenticated using (public.is_manager()) with check (public.is_manager());

-- Réservations
create policy "reservations: lecture" on public.reservations
  for select to authenticated
  using (client_id = auth.uid() or driver_id = auth.uid() or public.can_view_finance());
create policy "reservations: création" on public.reservations
  for insert to authenticated
  with check (client_id = auth.uid() or public.is_staff());
create policy "reservations: modification client" on public.reservations
  for update to authenticated
  using (client_id = auth.uid()) with check (client_id = auth.uid());
create policy "reservations: modification équipe" on public.reservations
  for update to authenticated
  using (public.is_staff()) with check (public.is_staff());
create policy "reservations: suppression" on public.reservations
  for delete to authenticated using (public.is_manager());

-- Frais supplémentaires
create policy "charges: lecture" on public.reservation_charges
  for select to authenticated
  using (public.can_view_finance() or exists (
    select 1 from public.reservations r where r.id = reservation_id and r.client_id = auth.uid()));
create policy "charges: gestion" on public.reservation_charges
  for all to authenticated using (public.is_staff()) with check (public.is_staff());

-- Paiements
create policy "payments: lecture" on public.payments
  for select to authenticated
  using (public.can_view_finance() or exists (
    select 1 from public.reservations r where r.id = reservation_id and r.client_id = auth.uid()));
create policy "payments: déclaration" on public.payments
  for insert to authenticated
  with check (public.can_view_finance() or exists (
    select 1 from public.reservations r where r.id = reservation_id and r.client_id = auth.uid()));
create policy "payments: validation" on public.payments
  for update to authenticated
  using (public.can_view_finance()) with check (public.can_view_finance());

-- Historique : lecture seule (écrit par trigger)
create policy "history: lecture" on public.reservation_status_history
  for select to authenticated
  using (public.can_view_finance() or exists (
    select 1 from public.reservations r
    where r.id = reservation_id and (r.client_id = auth.uid() or r.driver_id = auth.uid())));

-- Notifications : chacun les siennes (lecture + marquer comme lu)
create policy "notifications: lecture" on public.notifications
  for select to authenticated using (user_id = auth.uid());
create policy "notifications: marquer lu" on public.notifications
  for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "notifications: envoi équipe" on public.notifications
  for insert to authenticated with check (public.is_staff());

-- Paramètres
create policy "settings: lecture" on public.app_settings
  for select to authenticated using (true);
create policy "settings: gestion" on public.app_settings
  for all to authenticated using (public.is_manager()) with check (public.is_manager());


-- ---------------------------------------------------------------------
-- 5. VUES DE RAPPORTS
-- security_invoker : chaque vue respecte les droits de l'utilisateur
-- (un client ne voit que ses lignes, la gérante voit tout).
-- Dates regroupées en heure locale de Pointe-Noire.
-- ---------------------------------------------------------------------

-- Solde de chaque réservation : dû, payé, remboursé, reste à payer
create view public.reservation_balances with (security_invoker = true) as
select
  r.id as reservation_id,
  r.reference,
  r.status,
  r.total_price,
  coalesce(c.charges, 0)                                   as extra_charges,
  r.total_price + coalesce(c.charges, 0)                   as amount_due,
  coalesce(p.paid, 0)                                      as amount_paid,
  coalesce(p.refunded, 0)                                  as amount_refunded,
  r.total_price + coalesce(c.charges, 0) - coalesce(p.paid, 0) + coalesce(p.refunded, 0) as balance
from public.reservations r
left join (
  select reservation_id, sum(amount)::integer as charges
  from public.reservation_charges group by reservation_id
) c on c.reservation_id = r.id
left join (
  select reservation_id,
         sum(amount) filter (where kind = 'payment')::integer as paid,
         sum(amount) filter (where kind = 'refund')::integer  as refunded
  from public.payments where status = 'succeeded' group by reservation_id
) p on p.reservation_id = r.id;

-- Vue détaillée : une ligne par réservation avec tout le contexte (exports, listes admin)
create view public.reservation_details with (security_invoker = true) as
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
  r.cancellation_reason
from public.reservations r
join public.profiles c        on c.id = r.client_id
join public.vehicle_models m  on m.id = r.model_id
left join public.vehicles v   on v.id = r.vehicle_id
left join public.profiles d   on d.id = r.driver_id
left join public.promotions pr on pr.id = r.promotion_id
left join public.reservation_balances b on b.reservation_id = r.id;

-- Activité par jour (date de début de location)
create view public.report_daily_activity with (security_invoker = true) as
select
  (r.start_at at time zone 'Africa/Brazzaville')::date      as day,
  count(*)                                                    as reservations,
  count(*) filter (where r.status = 'pending')                as pending,
  count(*) filter (where r.status in ('confirmed', 'in_progress', 'completed')) as confirmed,
  count(*) filter (where r.status = 'completed')              as completed,
  count(*) filter (where r.status in ('cancelled', 'rejected', 'no_show')) as cancelled,
  sum(r.duration_hours) filter (where r.status in ('confirmed', 'in_progress', 'completed')) as rented_hours,
  sum(r.total_price) filter (where r.status in ('confirmed', 'in_progress', 'completed'))    as booked_revenue
from public.reservations r
group by 1;

-- Chiffre d'affaires encaissé par mois et par moyen de paiement
create view public.report_monthly_revenue with (security_invoker = true) as
select
  date_trunc('month', p.paid_at at time zone 'Africa/Brazzaville')::date as month,
  p.method,
  count(*) filter (where p.kind = 'payment')                       as payments,
  coalesce(sum(p.amount) filter (where p.kind = 'payment'), 0)     as gross_amount,
  coalesce(sum(p.amount) filter (where p.kind = 'refund'), 0)      as refunded_amount,
  coalesce(sum(case p.kind when 'payment' then p.amount else -p.amount end), 0) as net_amount
from public.payments p
where p.status = 'succeeded'
group by 1, 2;

-- Performance de chaque véhicule par mois
create view public.report_vehicle_performance with (security_invoker = true) as
select
  date_trunc('month', r.start_at at time zone 'Africa/Brazzaville')::date as month,
  v.id            as vehicle_id,
  v.plate_number,
  m.brand || ' ' || m.name as model_name,
  count(r.id)                     as rentals,
  coalesce(sum(r.duration_hours), 0) as rented_hours,
  coalesce(sum(r.total_price), 0) + coalesce(sum(ch.charges), 0) as revenue
from public.reservations r
join public.vehicles v       on v.id = r.vehicle_id
join public.vehicle_models m on m.id = v.model_id
left join (
  select reservation_id, sum(amount) as charges from public.reservation_charges group by reservation_id
) ch on ch.reservation_id = r.id
where r.status in ('confirmed', 'in_progress', 'completed')
group by 1, 2, 3, 4;

-- Popularité des modèles et des durées (6 h / 12 h)
create view public.report_model_demand with (security_invoker = true) as
select
  date_trunc('month', r.start_at at time zone 'Africa/Brazzaville')::date as month,
  m.brand || ' ' || m.name as model_name,
  r.duration_hours,
  count(*)                                                       as requests,
  count(*) filter (where r.status in ('confirmed', 'in_progress', 'completed')) as confirmed,
  count(*) filter (where r.status in ('cancelled', 'rejected'))  as lost
from public.reservations r
join public.vehicle_models m on m.id = r.model_id
group by 1, 2, 3;

-- Statistiques clients : base pour la fidélité et la relation client
create view public.report_client_stats with (security_invoker = true) as
select
  c.id            as client_id,
  c.full_name,
  c.phone,
  c.created_at    as member_since,
  count(r.id)                                               as reservations,
  count(r.id) filter (where r.status = 'completed')         as completed_rentals,
  count(r.id) filter (where r.status in ('cancelled', 'no_show')) as cancellations,
  coalesce(sum(b.amount_paid - b.amount_refunded), 0)       as total_spent,
  max(r.start_at)                                           as last_rental_at
from public.profiles c
left join public.reservations r on r.client_id = c.id
left join public.reservation_balances b on b.reservation_id = r.id
where c.role = 'client'
group by c.id;

-- Activité des chauffeurs par mois
create view public.report_driver_activity with (security_invoker = true) as
select
  date_trunc('month', r.start_at at time zone 'Africa/Brazzaville')::date as month,
  d.profile_id   as driver_id,
  p.full_name    as driver_name,
  count(r.id)                     as rentals,
  coalesce(sum(r.duration_hours), 0) as driven_hours
from public.reservations r
join public.drivers d  on d.profile_id = r.driver_id
join public.profiles p on p.id = d.profile_id
where r.status in ('confirmed', 'in_progress', 'completed')
group by 1, 2, 3;

-- =====================================================================
-- Réservation avec ou sans chauffeur
--  - Le client choisit « avec chauffeur » (par défaut) ou « sans chauffeur ».
--  - Avec chauffeur : il peut choisir un chauffeur disponible, ou laisser
--    Zoko l'attribuer (driver_id vide). L'agent peut toujours le changer.
--  - Sans chauffeur : le client conduit, son n° de permis est obligatoire.
--  - Le prix est le même dans les deux cas.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Colonnes
-- ---------------------------------------------------------------------
alter table public.reservations
  add column with_driver boolean not null default true,
  add column client_license_number text;

comment on column public.reservations.with_driver is 'true = location avec chauffeur Zoko, false = le client conduit.';
comment on column public.reservations.client_license_number is 'N° de permis du client (obligatoire sans chauffeur).';

alter table public.reservations
  add constraint reservations_self_drive_no_driver check (with_driver or driver_id is null),
  add constraint reservations_self_drive_license check (
    with_driver or status in ('cancelled', 'rejected')
    or length(trim(coalesce(client_license_number, ''))) > 0
  );


-- ---------------------------------------------------------------------
-- 2. Règles de la réservation : le client peut maintenant envoyer son
--    choix de chauffeur (avant, driver_id était toujours effacé).
--    Même fonction qu'avant, sans les lignes qui effaçaient driver_id.
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
begin
  -- Règles propres aux clients (l'équipe peut saisir une réservation pour un client)
  if not v_staff and auth.uid() is not null then
    if tg_op = 'INSERT' then
      new.client_id := auth.uid();
      new.status := 'pending';
      new.vehicle_id := null;
      new.internal_notes := null;
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


-- ---------------------------------------------------------------------
-- 3. Contrôle du chauffeur choisi (s'exécute après reservations_before_write
--    et reservations_check_window : les triggers BEFORE suivent l'ordre alphabétique)
-- ---------------------------------------------------------------------
create or replace function public.reservations_driver_choice()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_client boolean := auth.uid() is not null and not public.is_staff();
  v_tz     text    := coalesce(public.setting('timezone') #>> '{}', 'Africa/Brazzaville');
begin
  if new.with_driver then
    new.client_license_number := null;
  else
    new.driver_id := null;
    new.client_license_number := nullif(trim(coalesce(new.client_license_number, '')), '');
    if new.client_license_number is null and new.status not in ('cancelled', 'rejected') then
      raise exception 'Indiquez votre numéro de permis de conduire pour louer sans chauffeur';
    end if;
  end if;

  -- Rien à vérifier : pas de chauffeur choisi, réservation terminée, ou rien n'a changé
  if new.driver_id is null or new.status not in ('pending', 'confirmed') then
    return new;
  end if;
  if tg_op = 'UPDATE'
     and (new.driver_id, new.start_at, new.end_at, new.status)
         is not distinct from (old.driver_id, old.start_at, old.end_at, old.status) then
    return new;
  end if;

  -- Chauffeur actif, disponible, permis valide à la date de la location
  if not exists (
    select 1
    from public.drivers d
    join public.profiles p on p.id = d.profile_id
    where d.profile_id = new.driver_id
      and d.is_available
      and p.is_active
      and p.role = 'driver'
      and (d.license_expires_on is null or d.license_expires_on >= (new.end_at at time zone v_tz)::date)
  ) then
    raise exception 'Ce chauffeur n''est pas disponible. Choisissez-en un autre ou laissez Zoko choisir.';
  end if;

  -- Client : le chauffeur ne doit pas être déjà demandé ou pris sur ce créneau.
  -- (Pour l'équipe, la contrainte reservations_driver_no_overlap protège les réservations confirmées.)
  if v_client and exists (
    select 1 from public.reservations r
    where r.driver_id = new.driver_id
      and r.id <> new.id
      and r.status in ('pending', 'confirmed', 'in_progress')
      and tstzrange(r.start_at, r.end_at) && tstzrange(new.start_at, new.end_at)
  ) then
    raise exception 'Ce chauffeur est déjà réservé à ce créneau. Choisissez-en un autre ou laissez Zoko choisir.';
  end if;

  return new;
end;
$$;

drop trigger if exists reservations_driver_choice on public.reservations;
create trigger reservations_driver_choice
  before insert or update on public.reservations
  for each row execute function public.reservations_driver_choice();


-- ---------------------------------------------------------------------
-- 4. Chauffeurs libres sur un créneau (pour l'écran de réservation).
--    Ne renvoie que le nom et la photo : le reste de la fiche chauffeur
--    reste réservé à l'équipe.
-- ---------------------------------------------------------------------
create or replace function public.available_drivers(
  p_start timestamptz,
  p_duration smallint,
  p_exclude_reservation uuid default null
)
returns table (driver_id uuid, full_name text, avatar_url text)
language sql stable security definer set search_path = ''
as $$
  select d.profile_id, p.full_name, p.avatar_url
  from public.drivers d
  join public.profiles p on p.id = d.profile_id
  where d.is_available
    and p.is_active
    and p.role = 'driver'
    and (d.license_expires_on is null
         or d.license_expires_on >= ((p_start + make_interval(hours => p_duration))
              at time zone coalesce(public.setting('timezone') #>> '{}', 'Africa/Brazzaville'))::date)
    and not exists (
      select 1 from public.reservations r
      where r.driver_id = d.profile_id
        and r.status in ('pending', 'confirmed', 'in_progress')
        and r.id is distinct from p_exclude_reservation
        and tstzrange(r.start_at, r.end_at) && tstzrange(p_start, p_start + make_interval(hours => p_duration))
    )
  order by p.full_name
$$;

revoke execute on function public.available_drivers(timestamptz, smallint, uuid) from public, anon;
grant execute on function public.available_drivers(timestamptz, smallint, uuid) to authenticated;


-- ---------------------------------------------------------------------
-- 5. Le client voit le nom, le téléphone et la photo du chauffeur de ses réservations
-- ---------------------------------------------------------------------
drop policy if exists "profiles: client voit son chauffeur" on public.profiles;
create policy "profiles: client voit son chauffeur" on public.profiles
  for select to authenticated
  using (role = 'driver' and exists (
    select 1 from public.reservations r
    where r.driver_id = profiles.id and r.client_id = auth.uid()));


-- ---------------------------------------------------------------------
-- 6. Vue détaillée : nouvelles colonnes (ajoutées à la fin)
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
  d.avatar_url  as driver_avatar_url
from public.reservations r
join public.profiles c        on c.id = r.client_id
join public.vehicle_models m  on m.id = r.model_id
left join public.vehicles v   on v.id = r.vehicle_id
left join public.profiles d   on d.id = r.driver_id
left join public.promotions pr on pr.id = r.promotion_id
left join public.reservation_balances b on b.reservation_id = r.id;


-- ---------------------------------------------------------------------
-- 7. Rappel « Chauffeur à attribuer » : seulement pour les locations avec chauffeur
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
  where r.status = 'confirmed'
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
  where r.status = 'confirmed'
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
  where r.status = 'pending'
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

  -- 4. Équipe : location confirmée dans moins de 24 h sans chauffeur attribué
  insert into public.notifications (user_id, type, title, body, reservation_id)
  select p.id, 'other', 'Chauffeur à attribuer · ' || r.reference,
         'Départ le ' || to_char(r.start_at at time zone v_tz, 'DD/MM à HH24:MI') || ' · ' || r.pickup_address,
         r.id
  from public.reservations r
  cross join public.profiles p
  where r.status = 'confirmed'
    and r.with_driver
    and r.driver_id is null
    and r.start_at between now() and now() + interval '24 hours'
    and p.role in ('manager', 'agent') and p.is_active
    and not exists (
      select 1 from public.notifications n
      where n.reservation_id = r.id and n.user_id = p.id and n.title = 'Chauffeur à attribuer · ' || r.reference);
  get diagnostics v_n = row_count;
  v_total := v_total + v_n;

  return v_total;
end;
$$;

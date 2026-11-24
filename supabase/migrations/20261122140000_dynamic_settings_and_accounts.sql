-- =====================================================================
-- Paramètres dynamiques, durées libres et comptes par numéro de téléphone
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Paramètres publics : lisibles par l'app avant connexion
--    (ville, horaires, textes, règles affichées au client)
-- ---------------------------------------------------------------------
alter table public.app_settings add column if not exists is_public boolean not null default false;

drop policy if exists "settings: lecture" on public.app_settings;
create policy "settings: lecture" on public.app_settings
  for select to anon, authenticated
  using (is_public or public.can_view_finance());


-- ---------------------------------------------------------------------
-- 2. Durées de location : plus figées à 6 h / 12 h.
--    Les durées proposées = celles qui ont un tarif en vigueur dans `rates`.
--    La gérante peut ajouter une durée (ex. 24 h) en ajoutant un tarif.
-- ---------------------------------------------------------------------
alter table public.rates drop constraint if exists rates_duration_hours_check;
alter table public.rates add constraint rates_duration_hours_check check (duration_hours between 1 and 72);

alter table public.reservations drop constraint if exists reservations_duration_hours_check;
alter table public.reservations add constraint reservations_duration_hours_check check (duration_hours between 1 and 72);


-- ---------------------------------------------------------------------
-- 3. Comptes
--    La connexion se fait avec le numéro de téléphone. L'adresse de
--    connexion Supabase est dérivée du numéro ; l'e-mail réel (facultatif)
--    est envoyé dans les metadata et gardé dans profiles.email.
-- ---------------------------------------------------------------------

-- Numéro normalisé : chiffres seulement (ex. "+242 06 123 45 67" -> "242061234567")
create or replace function public.phone_digits(p_phone text)
returns text
language sql immutable
as $$
  select nullif(regexp_replace(coalesce(p_phone, ''), '\D', '', 'g'), '')
$$;

-- Un numéro ne peut appartenir qu'à un seul compte, quel que soit son format
create unique index if not exists profiles_phone_digits_key
  on public.profiles (public.phone_digits(phone))
  where phone is not null;

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
    nullif(trim(new.raw_user_meta_data ->> 'email'), '')
  );
  return new;
end;
$$;

-- Vérifie si un compte existe pour ce numéro (inscription et connexion).
-- Ne renvoie qu'un oui / non : aucune donnée personnelle.
create or replace function public.phone_registered(p_phone text)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.profiles
    where public.phone_digits(phone) = public.phone_digits(p_phone)
  )
$$;

grant execute on function public.phone_registered(text) to anon, authenticated;


-- ---------------------------------------------------------------------
-- 4. Créneau de réservation : fenêtre de dates et horaires (paramètres)
-- ---------------------------------------------------------------------
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
  if public.is_staff() or auth.uid() is null or new.status = 'cancelled' then
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

drop trigger if exists reservations_check_window on public.reservations;
create trigger reservations_check_window
  before insert or update on public.reservations
  for each row execute function public.reservations_check_window();


-- ---------------------------------------------------------------------
-- 5. Code promo : vérification avant réservation (sans dévoiler la liste)
-- ---------------------------------------------------------------------
create or replace function public.check_promo_code(p_code text)
returns table (id uuid, code text, description text, discount_type public.discount_type, discount_value integer)
language sql stable security definer set search_path = ''
as $$
  select p.id, p.code, p.description, p.discount_type, p.discount_value
  from public.promotions p
  where p.code = upper(trim(p_code))
    and p.is_active
    and p.starts_at <= now()
    and (p.ends_at is null or p.ends_at > now())
    and (p.max_uses is null or p.max_uses > (
      select count(*) from public.reservations r
      where r.promotion_id = p.id and r.status not in ('cancelled', 'rejected')))
$$;

grant execute on function public.check_promo_code(text) to authenticated;

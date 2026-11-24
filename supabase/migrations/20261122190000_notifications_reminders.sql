-- =====================================================================
-- Notifications : rappels automatiques + mise à jour en direct
-- =====================================================================

-- Rappels (lancés toutes les 15 minutes par pg_cron, voir plus bas).
-- Chaque rappel n'est envoyé qu'une fois par réservation et par personne.
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

-- Réservé au planificateur (pas appelable depuis l'app)
revoke execute on function public.create_reminders() from public, anon, authenticated;

-- Planification toutes les 15 minutes (Supabase : extension pg_cron)
do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    create extension if not exists pg_cron;
    perform cron.schedule('zoko-reminders', '*/15 * * * *', 'select public.create_reminders()');
  end if;
end;
$$;

-- Mise à jour en direct dans l'app (badge, liste) : Supabase Realtime
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (
       select 1 from pg_publication_tables
       where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'notifications') then
    alter publication supabase_realtime add table public.notifications;
  end if;
end;
$$;

-- =====================================================================
-- Disponibilité : possibilité d'ignorer une réservation
-- Quand un client modifie sa réservation, sa propre réservation ne doit
-- pas rendre le véhicule « indisponible » pour le nouveau créneau.
-- =====================================================================

drop function if exists public.available_models(timestamptz, smallint);

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
        and not exists (
          select 1 from public.reservations r
          where r.vehicle_id = v.id
            and r.status in ('confirmed', 'in_progress')
            and r.id is distinct from p_exclude_reservation
            and tstzrange(r.start_at, r.end_at) && tstzrange(p_start, p_start + make_interval(hours => p_duration))
        )
    )::integer
    -- les demandes en attente sur ce modèle réduisent aussi la disponibilité affichée
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

grant execute on function public.available_models(timestamptz, smallint, uuid) to authenticated;

-- =====================================================================
-- Notifications à chaque étape
--  - Client : « Demande de réservation envoyée » et « Paiement déclaré »
--  - Équipe : « Paiement à vérifier » dès qu'un client déclare un paiement
--  - Rattrapage pour les réservations existantes sans notification
-- =====================================================================

create or replace function public.reservations_after_write()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_tz    text := coalesce(public.setting('timezone') #>> '{}', 'Africa/Brazzaville');
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

  v_when := to_char(new.start_at at time zone v_tz, 'DD/MM/YYYY à HH24:MI') || ' · ' || new.duration_hours || ' h';

  -- Nouvelle réservation : confirmer au client, prévenir l'équipe
  if tg_op = 'INSERT' then
    insert into public.notifications (user_id, type, title, body, reservation_id)
    values (new.client_id, 'reservation_created', 'Demande de réservation envoyée',
            new.reference || ' · ' || v_when || '. Un agent va la vérifier et la confirmer.', new.id);

    insert into public.notifications (user_id, type, title, body, reservation_id)
    select p.id, 'reservation_created', 'Nouvelle réservation ' || new.reference, 'Début le ' || v_when, new.id
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
      values (new.client_id, v_type, v_title, 'Réservation ' || new.reference || ' · ' || v_when, new.id);
    end if;

    -- Début / fin de location, annulations et modifications : prévenir aussi l'équipe
    if new.status in ('in_progress', 'completed', 'cancelled', 'pending') then
      insert into public.notifications (user_id, type, title, body, reservation_id)
      select p.id, v_type, v_title || ' · ' || new.reference, v_when, new.id
      from public.profiles p
      where p.is_active and p.id <> new.client_id
        and (p.role = 'manager' or (p.role = 'agent' and new.status in ('cancelled', 'pending')));
    end if;
  end if;

  return new;
end;
$$;

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
    where p.role in ('manager', 'agent', 'accountant') and p.is_active and p.id <> v_res.client_id;
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
    where p.role in ('manager', 'accountant') and p.is_active and p.id <> v_res.client_id;
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

-- Rattrapage : une notification pour chaque réservation existante qui n'en a aucune côté client
insert into public.notifications (user_id, type, title, body, reservation_id, created_at)
select r.client_id, 'reservation_created', 'Demande de réservation envoyée',
       r.reference || ' · ' || to_char(r.start_at at time zone 'Africa/Brazzaville', 'DD/MM/YYYY à HH24:MI')
         || ' · ' || r.duration_hours || ' h',
       r.id, r.created_at
from public.reservations r
where not exists (
  select 1 from public.notifications n where n.reservation_id = r.id and n.user_id = r.client_id);

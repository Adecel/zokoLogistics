-- =====================================================================
-- Suppression de compte par le client (exigée par l'App Store)
--
-- - Sans réservation : le compte est supprimé complètement.
-- - Avec des réservations passées : elles sont gardées pour la
--   comptabilité, mais le profil est anonymisé (nom, téléphone, e-mail
--   effacés) et la connexion est désactivée définitivement.
-- - Refusé s'il reste une réservation en attente, confirmée ou en cours.
-- =====================================================================

-- Le garde-fou des profils laisse passer la suppression de compte
create or replace function public.profiles_guard()
returns trigger
language plpgsql set search_path = ''
as $$
begin
  if coalesce(current_setting('zoko.account_deletion', true), '') = 'on' then
    return new;
  end if;
  if auth.uid() is not null and not public.is_manager()
     and (new.role is distinct from old.role or new.is_active is distinct from old.is_active) then
    raise exception 'Seule la gérante peut modifier le rôle ou le statut d''un compte';
  end if;
  return new;
end;
$$;

create or replace function public.delete_my_account()
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'Vous devez être connecté';
  end if;

  if exists (
    select 1 from public.reservations
    where client_id = v_uid and status in ('pending', 'confirmed', 'in_progress')
  ) then
    raise exception 'Vous avez une réservation en cours. Annulez-la ou attendez la fin de la location avant de supprimer votre compte.';
  end if;

  delete from public.notifications where user_id = v_uid;

  if not exists (select 1 from public.reservations where client_id = v_uid) then
    -- Aucun historique : suppression complète (le profil suit en cascade)
    delete from auth.users where id = v_uid;
    return;
  end if;

  -- Historique à conserver : anonymisation + connexion désactivée
  perform set_config('zoko.account_deletion', 'on', true);
  update public.profiles
     set full_name = 'Compte supprimé', phone = null, email = null, avatar_url = null, is_active = false
   where id = v_uid;

  update auth.users
     set email = 'supprime-' || v_uid || '@compte-supprime.invalid',
         phone = null,
         encrypted_password = '',
         raw_user_meta_data = '{}'::jsonb,
         banned_until = 'infinity'
   where id = v_uid;
  delete from auth.identities where user_id = v_uid;
  delete from auth.sessions where user_id = v_uid;
end;
$$;

revoke execute on function public.delete_my_account() from anon;
grant execute on function public.delete_my_account() to authenticated;

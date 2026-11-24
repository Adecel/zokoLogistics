-- =====================================================================
-- Comptes par e-mail
-- Connexion : e-mail réel + mot de passe. Le téléphone reste obligatoire
-- et unique (vérifié par phone_registered avant l'inscription).
-- =====================================================================

-- Le profil reprend l'e-mail du compte
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
    coalesce(nullif(lower(trim(new.raw_user_meta_data ->> 'email')), ''), new.email)
  );
  return new;
end;
$$;

-- Vérifie si un compte existe pour cet e-mail (inscription et connexion).
-- Ne renvoie qu'un oui / non.
create or replace function public.email_registered(p_email text)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from auth.users u
    where lower(u.email) = lower(trim(p_email))
  )
$$;

grant execute on function public.email_registered(text) to anon, authenticated;

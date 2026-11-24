-- =====================================================================
-- Paiement : espèces + photo de preuve (facultative)
-- =====================================================================

-- 1. Nouveau moyen : espèces au moment de la prise en charge du véhicule
alter type public.payment_method add value if not exists 'cash';

-- 2. Photo de preuve (chemin dans le stockage privé "payment-proofs")
alter table public.payments add column if not exists proof_path text;

-- 3. Stockage privé des preuves : <id client>/<id réservation>/<fichier>
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('payment-proofs', 'payment-proofs', false, 10485760,
        array['image/jpeg', 'image/png', 'image/heic', 'image/webp'])
on conflict (id) do nothing;

drop policy if exists "payment proofs: envoi client" on storage.objects;
create policy "payment proofs: envoi client" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'payment-proofs' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "payment proofs: lecture" on storage.objects;
create policy "payment proofs: lecture" on storage.objects
  for select to authenticated
  using (bucket_id = 'payment-proofs'
         and ((storage.foldername(name))[1] = auth.uid()::text or public.can_view_finance()));

-- 4. Règles des paiements déclarés par le client
create or replace function public.payments_before_write()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if not public.can_view_finance() and auth.uid() is not null then
    -- Le client déclare son paiement ; un agent le valide ensuite
    if tg_op = 'UPDATE' then
      raise exception 'Action non autorisée';
    end if;
    if not exists (select 1 from public.reservations r where r.id = new.reservation_id and r.client_id = auth.uid()) then
      raise exception 'Réservation introuvable';
    end if;
    -- La preuve doit être dans le dossier du client
    if new.proof_path is not null and split_part(new.proof_path, '/', 1) <> auth.uid()::text then
      raise exception 'Preuve de paiement invalide';
    end if;
    new.kind := 'payment';
    new.status := 'pending';
    new.paid_at := null;
    new.verified_by := null;
    new.verified_at := null;
    if new.method::text = 'cash' then
      new.transaction_reference := null;  -- encaissé par le chauffeur, validé ensuite par l'équipe
    end if;
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

-- 5. Ajoute « Espèces » aux moyens de paiement déjà configurés (s'il manque)
update public.app_settings
   set value = jsonb_build_array(jsonb_build_object(
         'method', 'cash', 'label', 'Espèces (cash)', 'enabled', true,
         'account_name', '', 'account_number', '',
         'instructions', 'Vous payez en espèces au chauffeur au moment de la prise en charge du véhicule.')) || value
 where key = 'payment_methods'
   and not value @> '[{"method": "cash"}]'::jsonb;

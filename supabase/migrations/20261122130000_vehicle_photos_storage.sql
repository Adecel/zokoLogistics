-- Espace de stockage des photos de véhicules (Supabase Storage)
-- Lecture publique ; seules la gérante et l'admin peuvent ajouter / supprimer.
-- Après envoi d'une photo, ajouter son URL publique dans public.vehicle_photos.

insert into storage.buckets (id, name, public)
values ('vehicle-photos', 'vehicle-photos', true)
on conflict (id) do nothing;

create policy "vehicle photos: lecture publique" on storage.objects
  for select to anon, authenticated
  using (bucket_id = 'vehicle-photos');

create policy "vehicle photos: gestion gérante" on storage.objects
  for all to authenticated
  using (bucket_id = 'vehicle-photos' and public.is_manager())
  with check (bucket_id = 'vehicle-photos' and public.is_manager());

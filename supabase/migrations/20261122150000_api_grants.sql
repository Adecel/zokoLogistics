-- =====================================================================
-- Droits d'accès de l'API (rôles anon / authenticated)
--
-- Les nouveaux projets Supabase n'accordent plus automatiquement ces droits.
-- Sans eux, l'app reçoit « permission denied » sur toutes les tables.
-- La sécurité reste assurée par les politiques RLS de chaque table :
-- ces GRANT ouvrent la porte, les politiques décident ligne par ligne.
-- =====================================================================

grant usage on schema public to anon, authenticated;

-- Utilisateurs connectés : accès aux tables et vues, filtré par RLS
grant select, insert, update, delete on all tables in schema public to authenticated;
grant usage, select on all sequences in schema public to authenticated;

-- Visiteurs non connectés : seulement le catalogue et les paramètres publics
grant select on public.vehicle_models, public.vehicle_photos, public.rates, public.app_settings to anon;

-- Fonctions utilisées par l'app et par les politiques RLS
grant execute on all functions in schema public to anon, authenticated;

-- Même chose pour les tables et fonctions créées plus tard
alter default privileges in schema public grant select, insert, update, delete on tables to authenticated;
alter default privileges in schema public grant usage, select on sequences to authenticated;
alter default privileges in schema public grant execute on functions to anon, authenticated;

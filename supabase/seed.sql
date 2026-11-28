-- =====================================================================
-- Données de départ Zoko (questionnaire de découverte)
-- À exécuter après les migrations. Peut être relancé sans risque :
-- les valeurs déjà modifiées par la gérante ne sont pas écrasées.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Paramètres (is_public = lisible par l'app avant connexion)
-- Pour modifier un paramètre : Table Editor > app_settings > value
-- ---------------------------------------------------------------------
insert into public.app_settings (key, value, is_public, description) values
  -- Entreprise
  ('city',                          '"Pointe-Noire"',        true,  'Ville de service'),
  ('timezone',                      '"Africa/Brazzaville"',  true,  'Fuseau horaire'),
  ('utc_offset',                    '"+01:00"',              true,  'Décalage horaire utilisé par l''app'),
  ('currency_label',                '"FCFA"',                true,  'Devise affichée'),
  ('support_phone',                 '""',                    true,  'Téléphone du service client (ex. +242 06 000 00 00)'),
  ('support_whatsapp',              '""',                    true,  'Numéro WhatsApp du service client'),

  -- Règles de réservation
  ('min_days_ahead',                '1',                     true,  'Réservation au moins N jour(s) à l''avance'),
  ('max_days_ahead',                '30',                    true,  'Réservation au plus N jours à l''avance'),
  ('booking_hours',                 '{"start": "06:00", "end": "20:00", "step_minutes": 30}', true,
                                                                    'Heures de début possibles et pas (minutes)'),
  ('included_fuel_liters',          '5',                     true,  'Carburant inclus ; au-delà, à la charge du client'),
  ('free_cancel_until_days_before', '1',                     true,  'Annulation remboursée intégralement jusqu''à N jour(s) avant'),
  ('same_day_cancel_refund_pct',    '50',                    true,  'Annulation le jour J : % remboursé'),

  -- Textes affichés dans l'app
  ('welcome_tagline',     '"Voyagez en toute sérénité\navec Zoko !"',          true, 'Accueil : slogan sous le logo'),
  ('home_subtitle',       '"Votre mobilité, notre priorité !"',                 true, 'Accueil connecté : sous le « Bonjour »'),
  ('home_banner',         '{"title": "Louez un véhicule en toute simplicité", "subtitle": "Avec chauffeur, à Pointe-Noire"}',
                                                                                true, 'Accueil connecté : bannière'),
  ('pricing_note',        '"Location avec chauffeur. Tout dépassement entame une nouvelle tranche horaire, facturée."',
                                                                                true, 'Fiche véhicule : note sous les tarifs'),
  ('booking_conditions',  '["Pièce d''identité obligatoire", "Signature du contrat au départ", "Chauffeur attribué par Zoko", "Paiement intégral, sans caution"]',
                                                                                true, 'Réservation : conditions affichées au client'),

  -- Paiement : coordonnées affichées au client (à compléter par la gérante).
  -- Un moyen sans numéro / compte (sauf espèces) est affiché « bientôt disponible ».
  ('payment_methods', $json$[
    {"method": "cash", "label": "Espèces (cash)", "enabled": true,
     "account_name": "", "account_number": "",
     "instructions": "Vous payez en espèces au chauffeur au moment de la prise en charge du véhicule."},
    {"method": "airtel_money", "label": "Airtel Money", "enabled": true,
     "account_name": "", "account_number": "",
     "instructions": "Depuis votre téléphone, envoyez le montant exact au numéro Airtel Money indiqué. Vous pouvez joindre une capture du SMS de confirmation."},
    {"method": "mtn_mobile_money", "label": "Mobile Money", "enabled": true,
     "account_name": "", "account_number": "",
     "instructions": "Depuis votre téléphone, envoyez le montant exact au numéro MTN Mobile Money indiqué. Vous pouvez joindre une capture du SMS de confirmation."},
    {"method": "bank_transfer", "label": "Virement bancaire", "enabled": true,
     "account_name": "", "account_number": "", "bank_name": "",
     "instructions": "Faites un virement du montant exact en indiquant la référence de réservation comme motif. Vous pouvez joindre une photo du reçu de virement."}
  ]$json$, true, 'Paiement : moyens proposés et coordonnées (numéro, titulaire, banque, consignes)'),
  ('payment_note', '"Votre paiement est vérifié par notre équipe, qui confirme ensuite la réservation."',
                                                                                true, 'Paiement : note sous le bouton')
on conflict (key) do update
  set is_public = excluded.is_public,
      description = excluded.description;

-- ---------------------------------------------------------------------
-- Modèles
-- ---------------------------------------------------------------------
insert into public.vehicle_models (brand, name, seats, transmission, fuel_type, features, description) values
  ('Suzuki', 'S-Presso', 4, 'manual', 'petrol',
   '{Climatisation,"Avec chauffeur"}',
   'Citadine compacte et économique, idéale pour vos déplacements en ville.'),
  ('Suzuki', 'Jimny', 4, 'manual', 'petrol',
   '{Climatisation,"Transmission 4x4","Avec chauffeur"}',
   'Petit 4x4 robuste, parfait pour les routes difficiles et les sorties hors de la ville.'),
  ('Suzuki', 'Fronx', 5, 'automatic', 'petrol',
   '{Climatisation,Bluetooth,"Avec chauffeur"}',
   'SUV moderne et confortable avec boîte automatique, pour vos trajets en famille ou professionnels.')
on conflict (brand, name) do nothing;

-- ---------------------------------------------------------------------
-- Tarifs en vigueur (FCFA)
-- Pour changer un prix : mettre valid_to = now() sur l'ancien, puis
-- ajouter une nouvelle ligne. Pour ajouter une durée (ex. 24 h) :
-- ajouter une ligne ; l'app la proposera automatiquement.
-- ---------------------------------------------------------------------
insert into public.rates (model_id, duration_hours, price)
select m.id, t.duration_hours, t.price
from (values
  ('S-Presso', 3, 10000), ('S-Presso', 6, 15000), ('S-Presso', 12, 20000),
  ('Jimny',    3, 15000), ('Jimny',    6, 20000), ('Jimny',    12, 30000),
  ('Fronx',    3, 20000), ('Fronx',    6, 25000), ('Fronx',    12, 40000)
) as t (name, duration_hours, price)
join public.vehicle_models m on m.brand = 'Suzuki' and m.name = t.name
where not exists (
  select 1 from public.rates r
  where r.model_id = m.id and r.duration_hours = t.duration_hours and r.valid_to is null
);

-- ---------------------------------------------------------------------
-- Véhicules (flotte : 4 véhicules)
-- TODO : remplacer les plaques par les vraies, et indiquer le modèle du
-- 4e véhicule (le questionnaire donne 4 véhicules pour 3 modèles).
-- ---------------------------------------------------------------------
insert into public.vehicles (model_id, plate_number)
select m.id, 'A-RENSEIGNER-' || upper(m.name)
from public.vehicle_models m
where m.brand = 'Suzuki'
on conflict (plate_number) do nothing;

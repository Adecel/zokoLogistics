import type { Settings } from './settings';

// Terms of use and privacy policy, shown at /legal/terms and /legal/privacy.
// Rules that the team can change (cancellation, fuel, contacts) are read
// from app_settings so the text always matches the app.

export type LegalDocKey = 'terms' | 'privacy';

export type LegalSection = { title: string; paragraphs?: string[]; items?: string[] };

export type LegalDoc = { title: string; updated: string; intro: string; sections: LegalSection[] };

const UPDATED = '28 novembre 2026';

function contactLine(settings?: Settings) {
  const ways = [
    settings?.support_whatsapp && `WhatsApp : ${settings.support_whatsapp}`,
    settings?.support_phone && `Téléphone : ${settings.support_phone}`,
  ].filter(Boolean);
  const where = 'la page Profil > Aide et support de l’application';
  return ways.length ? `${ways.join(' · ')}, ou depuis ${where}.` : `Depuis ${where}.`;
}

function terms(settings?: Settings): LegalDoc {
  const city = settings?.city || 'Pointe-Noire';
  const cancel = settings
    ? [
        `Jusqu’à ${settings.free_cancel_until_days_before} jour(s) avant le départ : remboursement intégral.`,
        `Le jour même : ${settings.same_day_cancel_refund_pct} % du montant payé est remboursé.`,
      ]
    : ['Les règles d’annulation et de remboursement sont affichées dans Profil > Aide et support.'];
  const fuel =
    settings && settings.included_fuel_liters > 0
      ? [`${settings.included_fuel_liters} litres de carburant sont inclus. Au-delà, le carburant est à votre charge.`]
      : [];

  return {
    title: 'Conditions d’utilisation',
    updated: UPDATED,
    intro:
      'Ces conditions expliquent comment utiliser l’application Zoko et réserver un véhicule. En créant un compte, vous les acceptez. Lisez-les avant de réserver.',
    sections: [
      {
        title: '1. Qui sommes-nous',
        paragraphs: [
          `Zoko est un service de location de véhicules, avec ou sans chauffeur, à ${city}. L’application vous permet de voir les véhicules, leurs prix, de réserver et de suivre vos réservations.`,
        ],
      },
      {
        title: '2. Votre compte',
        items: [
          'Vous devez avoir au moins 18 ans pour créer un compte.',
          'Les informations que vous donnez (nom, téléphone, e-mail) doivent être exactes et à jour.',
          'Votre mot de passe est personnel. Ne le partagez avec personne. Vous êtes responsable de ce qui est fait avec votre compte.',
          'Si vous pensez que quelqu’un utilise votre compte, changez votre mot de passe et prévenez-nous.',
        ],
      },
      {
        title: '3. Réserver un véhicule',
        items: [
          'Vous choisissez un véhicule, une date, une heure de départ et une durée. Le prix est affiché avant de valider.',
          'Une réservation est confirmée seulement après la vérification de votre paiement par notre équipe.',
          'Le prix affiché au moment de la réservation est celui que vous payez, même si nos tarifs changent ensuite.',
          'Tout dépassement de la durée réservée entame une nouvelle tranche horaire, qui est facturée.',
          'Les conditions affichées au moment de la réservation (pièce d’identité, contrat, etc.) font partie de ces conditions.',
          'Course immédiate : le prix est fixe selon la zone de départ et la zone d’arrivée choisies, et se paie au chauffeur à l’arrivée. Un trajet hors de ces zones peut être facturé en plus, après accord avec vous. L’annulation est gratuite tant que la course n’a pas commencé.',
        ],
      },
      {
        title: '4. Paiement',
        items: [
          'Les moyens de paiement acceptés sont affichés dans l’application (espèces, Mobile Money, virement…).',
          'Envoyez le montant exact. Si vous joignez une preuve (capture, reçu), elle doit être authentique.',
          'Une fausse preuve de paiement entraîne l’annulation de la réservation et peut entraîner la fermeture du compte.',
        ],
      },
      { title: '5. Annulation et remboursement', items: cancel },
      {
        title: '6. Le jour de la location',
        items: [
          'Présentez une pièce d’identité valide. Un contrat est signé au départ.',
          'Pour une location sans chauffeur, vous devez avoir un permis de conduire valide et nous en communiquer le numéro.',
          ...fuel,
          'Vérifiez l’état du véhicule avec notre équipe au départ et au retour.',
        ],
      },
      {
        title: '7. Vos engagements',
        items: [
          'Utiliser le véhicule normalement et en bon père de famille.',
          'Respecter le code de la route et la loi. Le véhicule ne doit pas servir à une activité illégale.',
          'Sans chauffeur : ne pas confier le véhicule à une autre personne, et rendre le véhicule à l’heure prévue.',
          'Sans chauffeur : les amendes et les dommages causés pendant la location sont à votre charge, selon le contrat signé.',
          'Respecter nos chauffeurs et notre équipe.',
        ],
      },
      {
        title: '8. Nos engagements',
        items: [
          'Fournir un véhicule entretenu et en bon état, à l’heure convenue.',
          'Avec chauffeur : vous fournir un chauffeur qualifié.',
          'Si nous devons annuler votre réservation (panne, véhicule indisponible), vous êtes remboursé intégralement.',
          'L’application peut être momentanément indisponible (maintenance, réseau). Nous faisons notre possible pour limiter ces coupures.',
        ],
      },
      {
        title: '9. Suspension du compte',
        paragraphs: [
          'Nous pouvons suspendre ou fermer un compte en cas de fraude, de fausses informations, de non-paiement ou de comportement dangereux ou irrespectueux.',
        ],
      },
      {
        title: '10. Supprimer votre compte',
        paragraphs: [
          'Vous pouvez supprimer votre compte à tout moment depuis Profil > Supprimer mon compte, sauf s’il vous reste une réservation en attente, confirmée ou en cours.',
        ],
      },
      {
        title: '11. Modifications',
        paragraphs: [
          'Nous pouvons modifier ces conditions. La date de mise à jour est indiquée en haut de cette page. Les changements importants vous seront signalés dans l’application. Les réservations déjà faites restent soumises aux conditions acceptées au moment de la réservation.',
        ],
      },
      {
        title: '12. Litiges',
        paragraphs: [
          `Ces conditions sont soumises au droit de la République du Congo. En cas de problème, contactez-nous d’abord : nous chercherons une solution à l’amiable. À défaut, les tribunaux de ${city} seront compétents.`,
        ],
      },
      { title: '13. Nous contacter', paragraphs: [contactLine(settings)] },
    ],
  };
}

function privacy(settings?: Settings): LegalDoc {
  return {
    title: 'Politique de confidentialité',
    updated: UPDATED,
    intro:
      'Cette page explique quelles informations Zoko collecte, pourquoi, qui peut les voir et comment vous gardez le contrôle. Nous collectons seulement ce qui est utile pour vos réservations.',
    sections: [
      {
        title: '1. Les informations que nous collectons',
        items: [
          'Votre compte : nom, numéro de téléphone, adresse e-mail et mot de passe (enregistré de façon chiffrée, personne ne peut le lire, même pas notre équipe).',
          'Vos réservations : dates, heures, durée, véhicule, adresses de prise en charge et de retour, téléphone de contact et vos remarques.',
          'Location sans chauffeur : le numéro de votre permis de conduire.',
          'Vos paiements : moyen choisi, montant, et la preuve que vous envoyez (capture de SMS, photo de reçu).',
          'Nous ne collectons pas votre position GPS, vos contacts ni vos numéros de carte bancaire.',
        ],
      },
      {
        title: '2. Pourquoi nous les utilisons',
        items: [
          'Créer et gérer votre compte.',
          'Traiter vos réservations et vous attribuer un véhicule et, si besoin, un chauffeur.',
          'Vérifier vos paiements et effectuer les remboursements.',
          'Vous envoyer des notifications utiles (confirmation, rappel, changement de statut).',
          'Vous contacter au sujet d’une réservation.',
          'Prévenir la fraude et respecter nos obligations comptables.',
        ],
        paragraphs: ['Nous n’utilisons pas vos informations pour de la publicité et nous ne les vendons jamais.'],
      },
      {
        title: '3. Qui peut les voir',
        items: [
          'L’équipe Zoko, uniquement ce qui est nécessaire à chaque rôle (gérance, agents, comptabilité).',
          'Le chauffeur de votre réservation : votre nom, votre téléphone et les adresses du trajet.',
          'Nos prestataires techniques qui hébergent l’application et les données. Ils peuvent être situés hors du Congo et sont tenus de protéger vos données.',
          'Les autorités, seulement si la loi nous y oblige.',
        ],
      },
      {
        title: '4. Combien de temps nous les gardons',
        items: [
          'Tant que votre compte est actif.',
          'Si vous supprimez votre compte : votre nom, votre téléphone et votre e-mail sont effacés et la connexion est désactivée.',
          'L’historique de vos réservations passées est conservé de façon anonyme, pour notre comptabilité.',
        ],
      },
      {
        title: '5. Sécurité',
        paragraphs: [
          'Les échanges entre l’application et nos serveurs sont chiffrés. L’accès aux données est limité selon le rôle de chaque membre de l’équipe. Aucun système n’est sûr à 100 % : protégez aussi votre compte avec un mot de passe solide que vous n’utilisez nulle part ailleurs.',
        ],
      },
      {
        title: '6. Vos droits',
        items: [
          'Voir et corriger vos informations : Profil > Mes informations.',
          'Supprimer votre compte : Profil > Supprimer mon compte.',
          'Obtenir une copie de vos données, poser une question ou vous opposer à un usage : contactez-nous (voir ci-dessous).',
        ],
        paragraphs: ['Nous répondons à votre demande dans les meilleurs délais, et au plus tard sous 30 jours.'],
      },
      {
        title: '7. Mineurs',
        paragraphs: ['L’application est réservée aux personnes de 18 ans et plus. Nous ne collectons pas sciemment de données sur des mineurs.'],
      },
      {
        title: '8. Modifications',
        paragraphs: [
          'Nous pouvons mettre à jour cette politique. La date de mise à jour est indiquée en haut de cette page, et les changements importants vous seront signalés dans l’application.',
        ],
      },
      { title: '9. Nous contacter', paragraphs: [contactLine(settings)] },
    ],
  };
}

export function legalDoc(key: LegalDocKey, settings?: Settings): LegalDoc {
  return key === 'terms' ? terms(settings) : privacy(settings);
}

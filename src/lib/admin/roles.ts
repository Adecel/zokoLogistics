import type { Profile } from '../auth';

export type Role = Profile['role'];

// Roles that can open the dashboard
export const STAFF_ROLES: Role[] = ['admin', 'manager', 'accountant', 'agent'];

// Roles a person can request when signing up on the dashboard
export const REQUESTABLE_ROLES: Role[] = ['manager', 'accountant', 'admin'];

export const ROLE_LABELS: Record<Role, string> = {
  admin: 'Admin',
  manager: 'Gérant',
  accountant: 'Finance',
  agent: 'Agent',
  driver: 'Chauffeur',
  client: 'Client',
};

export const ROLE_DESCRIPTIONS: Partial<Record<Role, string>> = {
  admin: 'Tous les droits, y compris la suppression',
  manager: 'Flotte, chauffeurs, partenaires, clients, paramètres',
  accountant: 'Réservations, paiements, remboursements, frais, promotions et rapports',
  agent: 'Confirme et suit les réservations et les courses, gère les zones et prix des courses',
};

export function isStaff(profile: Pick<Profile, 'role' | 'is_active'> | null | undefined) {
  return !!profile && profile.is_active !== false && STAFF_ROLES.includes(profile.role);
}

// What each part of the dashboard needs. Mirrors the database rules
// (RLS policies): hiding a button here is only for comfort, the server decides.
export type Permission =
  | 'dashboard'
  | 'reservations' // see reservations
  | 'reservations.operate' // confirm, assign vehicle/driver, start, finish, cancel
  | 'payments' // verify payments, refunds, charges
  | 'fleet' // vehicles, rates, photos
  | 'rides' // ride zones and prices
  | 'partners' // Zoko Partenaire: approve owners and their vehicles
  | 'drivers'
  | 'clients'
  | 'clients.manage' // deactivate a client
  | 'promotions'
  | 'reports'
  | 'settings'
  | 'team' // access requests and roles
  | 'delete'; // delete anything

const PERMISSIONS: Record<Permission, Role[]> = {
  dashboard: ['admin', 'manager', 'accountant', 'agent'],
  // Réservations : Finance (lecture), agents (opérations) et admin ; pas le gérant
  reservations: ['admin', 'accountant', 'agent'],
  'reservations.operate': ['admin', 'agent'],
  payments: ['admin', 'accountant'],
  fleet: ['admin', 'manager'],
  rides: ['admin', 'manager', 'agent'],
  partners: ['admin', 'manager'],
  drivers: ['admin', 'manager'],
  clients: ['admin', 'manager', 'accountant', 'agent'],
  'clients.manage': ['admin', 'manager'],
  promotions: ['admin', 'accountant'],
  reports: ['admin', 'accountant'],
  settings: ['admin', 'manager'],
  team: ['admin'],
  delete: ['admin'],
};

export function can(role: Role | undefined, permission: Permission) {
  return !!role && PERMISSIONS[permission].includes(role);
}

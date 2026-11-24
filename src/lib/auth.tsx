import type { Session } from '@supabase/supabase-js';
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { NOT_CONFIGURED } from './catalog';
import { formatPhone, phoneDigits } from './phone';
import { isSupabaseConfigured, supabase } from './supabase';

export type Profile = {
  id: string;
  full_name: string;
  phone: string | null;
  email: string | null;
  role: 'client' | 'manager' | 'agent' | 'driver' | 'accountant' | 'admin';
};

type AuthResult = { error?: string; field?: 'email' | 'phone' | 'password' | 'form' };

type AuthContextValue = {
  session: Session | null;
  profile: Profile | null;
  initializing: boolean;
  signIn: (email: string, password: string) => Promise<AuthResult>;
  signUp: (input: { fullName: string; phone: string; email: string; password: string }) => Promise<AuthResult>;
  signOut: () => Promise<void>;
  refreshProfile: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

const NETWORK_ERROR = 'Problème de connexion. Vérifiez votre accès internet et réessayez.';
const SERVER_ERROR = 'Service momentanément indisponible (configuration du serveur). Réessayez plus tard.';

// The server answered with an error code = it's reachable but misconfigured;
// no answer at all = network problem
function checkError(error: { code?: string } | null) {
  return error?.code ? SERVER_ERROR : NETWORK_ERROR;
}

export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

type Check = { exists: boolean; error?: undefined } | { exists?: undefined; error: string };

async function phoneRegistered(digits: string): Promise<Check> {
  const { data, error } = await supabase.rpc('phone_registered', { p_phone: digits });
  return error ? { error: checkError(error) } : { exists: data as boolean };
}

async function emailRegistered(email: string): Promise<Check> {
  const { data, error } = await supabase.rpc('email_registered', { p_email: email });
  return error ? { error: checkError(error) } : { exists: data as boolean };
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loadedProfile, setLoadedProfile] = useState<Profile | null>(null);
  const [initializing, setInitializing] = useState(isSupabaseConfigured);

  useEffect(() => {
    if (!isSupabaseConfigured) return;
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setInitializing(false);
    });
    const { data } = supabase.auth.onAuthStateChange((_event, s) => setSession(s));
    return () => data.subscription.unsubscribe();
  }, []);

  const userId = session?.user.id;
  // Only expose the profile of the user currently logged in
  const profile = loadedProfile && loadedProfile.id === userId ? loadedProfile : null;

  function fetchProfile(id: string) {
    return supabase
      .from('profiles')
      .select('id, full_name, phone, email, role')
      .eq('id', id)
      .single()
      .then(({ data }) => setLoadedProfile((data as Profile) ?? null));
  }

  useEffect(() => {
    if (userId) fetchProfile(userId);
  }, [userId]);

  async function signIn(rawEmail: string, password: string): Promise<AuthResult> {
    if (!isSupabaseConfigured) return { error: NOT_CONFIGURED, field: 'form' };
    const email = rawEmail.trim().toLowerCase();
    if (!EMAIL_RE.test(email)) return { error: 'Adresse e-mail invalide', field: 'email' };

    const check = await emailRegistered(email);
    if (check.error) return { error: check.error, field: 'form' };
    if (!check.exists) return { error: 'Aucun compte avec cet e-mail. Créez un compte.', field: 'email' };

    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (!error) return {};
    if (error.code === 'invalid_credentials') return { error: 'Mot de passe incorrect', field: 'password' };
    if (error.code === 'email_not_confirmed') {
      return { error: 'E-mail pas encore confirmé. Ouvrez le lien reçu par e-mail.', field: 'form' };
    }
    return { error: NETWORK_ERROR, field: 'form' };
  }

  async function signUp(input: { fullName: string; phone: string; email: string; password: string }): Promise<AuthResult> {
    if (!isSupabaseConfigured) return { error: NOT_CONFIGURED, field: 'form' };
    const email = input.email.trim().toLowerCase();
    if (!EMAIL_RE.test(email)) return { error: 'Adresse e-mail invalide', field: 'email' };
    const digits = phoneDigits(input.phone);
    if (!digits) return { error: 'Numéro de téléphone invalide', field: 'phone' };

    const [emailCheck, phoneCheck] = await Promise.all([emailRegistered(email), phoneRegistered(digits)]);
    const checkFailed = emailCheck.error ?? phoneCheck.error;
    if (checkFailed) return { error: checkFailed, field: 'form' };
    if (emailCheck.exists) return { error: 'Un compte existe déjà avec cet e-mail. Connectez-vous.', field: 'email' };
    if (phoneCheck.exists) return { error: 'Ce numéro est déjà utilisé par un autre compte.', field: 'phone' };

    const { data, error } = await supabase.auth.signUp({
      email,
      password: input.password,
      options: { data: { full_name: input.fullName.trim(), phone: formatPhone(digits), email } },
    });
    if (error) {
      if (error.code === 'user_already_exists') return { error: 'Un compte existe déjà avec cet e-mail.', field: 'email' };
      if (error.code === 'weak_password') return { error: 'Mot de passe trop faible', field: 'password' };
      if (error.code === 'email_address_invalid') {
        return { error: 'Cette adresse e-mail est refusée. Vérifiez-la ou utilisez-en une autre.', field: 'email' };
      }
      return { error: `Inscription impossible : ${error.message}`, field: 'form' };
    }
    if (!data.session) {
      // "Confirm email" is enabled in Supabase > Authentication > Sign In / Providers > Email
      return { error: 'Compte créé ! Confirmez votre e-mail avec le lien reçu, puis connectez-vous.', field: 'form' };
    }
    return {};
  }

  async function signOut() {
    await supabase.auth.signOut();
  }

  const value: AuthContextValue = {
    session,
    profile,
    initializing,
    signIn,
    signUp,
    signOut,
    refreshProfile: async () => {
      if (userId) await fetchProfile(userId);
    },
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}

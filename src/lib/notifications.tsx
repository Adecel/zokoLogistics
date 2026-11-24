import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { useAuth } from './auth';
import { supabase } from './supabase';

export type NotificationType =
  | 'reservation_created'
  | 'reservation_confirmed'
  | 'reservation_rejected'
  | 'reservation_cancelled'
  | 'reservation_updated'
  | 'payment_received'
  | 'payment_refunded'
  | 'rental_reminder'
  | 'rental_started'
  | 'rental_ended'
  | 'promotion'
  | 'other';

export type AppNotification = {
  id: string;
  type: NotificationType;
  title: string;
  body: string | null;
  reservation_id: string | null;
  read_at: string | null;
  created_at: string;
};

type Value = {
  items: AppNotification[] | null;
  unread: number;
  error: string | null;
  reload: () => Promise<void>;
  markRead: (id: string) => Promise<void>;
  markAllRead: () => Promise<void>;
};

const NotificationsContext = createContext<Value | null>(null);

// Notifications of the logged-in user, kept up to date live (Supabase Realtime)
export function NotificationsProvider({ children }: { children: ReactNode }) {
  const { session } = useAuth();
  const userId = session?.user.id;
  const [items, setItems] = useState<AppNotification[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Fetch, then apply the result (state only changes when the answer arrives)
  const fetchItems = useCallback(async () => {
    if (!userId) return;
    const { data, error: err } = await supabase
      .from('notifications')
      .select('id, type, title, body, reservation_id, read_at, created_at')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(100);
    if (err) {
      setError('Impossible de charger les notifications. Vérifiez votre connexion.');
    } else {
      setError(null);
      setItems(data as AppNotification[]);
    }
  }, [userId]);

  const reload = fetchItems;

  useEffect(() => {
    if (!userId) return;
    let active = true;
    const refetch = () => {
      if (active) fetchItems();
    };
    Promise.resolve().then(refetch);
    // Unique name: supabase.channel() returns an already-subscribed channel when the
    // name is reused (screen re-mounted), and listeners can't be added to it anymore
    const channel = supabase
      .channel(`notifications:${userId}:${Date.now()}:${Math.random().toString(36).slice(2)}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'notifications', filter: `user_id=eq.${userId}` }, refetch)
      .subscribe();
    return () => {
      active = false;
      supabase.removeChannel(channel);
    };
  }, [userId, fetchItems]);

  const markRead = useCallback(async (id: string) => {
    const now = new Date().toISOString();
    setItems((list) => list?.map((n) => (n.id === id && !n.read_at ? { ...n, read_at: now } : n)) ?? null);
    await supabase.from('notifications').update({ read_at: now }).eq('id', id).is('read_at', null);
  }, []);

  const markAllRead = useCallback(async () => {
    if (!userId) return;
    const now = new Date().toISOString();
    setItems((list) => list?.map((n) => (n.read_at ? n : { ...n, read_at: now })) ?? null);
    await supabase.from('notifications').update({ read_at: now }).eq('user_id', userId).is('read_at', null);
  }, [userId]);

  const unread = items?.filter((n) => !n.read_at).length ?? 0;

  return (
    <NotificationsContext.Provider value={{ items, unread, error, reload, markRead, markAllRead }}>
      {children}
    </NotificationsContext.Provider>
  );
}

export function useNotifications() {
  const ctx = useContext(NotificationsContext);
  if (!ctx) throw new Error('useNotifications must be used inside <NotificationsProvider>');
  return ctx;
}

import { createClient, type SupabaseClient } from '@supabase/supabase-js';

export const supabaseUrl = (import.meta.env.PUBLIC_SUPABASE_URL ?? '').replace(/\/$/, '');
export const supabaseKey = import.meta.env.PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? '';
const storageKey = 'sellio-auth-session';
let client: SupabaseClient | undefined;
let refreshing: Promise<string> | undefined;

// Vite replaces DEV with false in every production build, regardless of flags or host.
export function isLocalPreview() {
  return import.meta.env.DEV && import.meta.env.PUBLIC_LOCAL_PREVIEW !== 'false'
    && typeof window !== 'undefined'
    && ['localhost', '127.0.0.1', '[::1]'].includes(window.location.hostname);
}

export function authClient() {
  if (isLocalPreview()) throw new Error('Logowanie jest wyłączone w lokalnym podglądzie.');
  if (client) return client;
  if (!supabaseUrl || !supabaseKey) throw new Error('Brakuje konfiguracji Supabase.');
  // Keep sessions created by the previous REST login, including Google callbacks.
  // Missing expiry must trigger a refresh, never extend an expired access token.
  try {
    const saved = JSON.parse(localStorage.getItem(storageKey) || 'null');
    if (saved?.access_token && saved?.refresh_token && !saved.expires_at) {
      saved.expires_at = 1;
      localStorage.setItem(storageKey, JSON.stringify(saved));
    }
  } catch { localStorage.removeItem(storageKey); }
  client = createClient(supabaseUrl, supabaseKey, {
    auth: { storageKey, persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
  });
  return client;
}

export async function accessToken() {
  const { data, error } = await authClient().auth.getSession();
  if (error) throw error;
  if (!data.session) throw new Error('Sesja została zakończona. Zaloguj się ponownie.');
  return data.session.access_token;
}

async function renewedToken(rejectedToken: string) {
  const current = await accessToken();
  if (current !== rejectedToken) return current;
  if (!refreshing) {
    refreshing = (async () => {
      const { data, error } = await authClient().auth.refreshSession();
      if (error) throw error;
      if (!data.session) throw new Error('Sesja została zakończona. Zaloguj się ponownie.');
      return data.session.access_token;
    })().finally(() => { refreshing = undefined; });
  }
  return refreshing;
}

/** Refresh before requests and retry one rejected token, preserving body and headers. */
export async function authenticatedFetch(url: string, init: RequestInit = {}) {
  if (import.meta.env.DEV && isLocalPreview()) return (await import('./local-preview')).previewRequest(url, init);
  const send = (token: string) => {
    const headers = new Headers(init.headers);
    headers.set('Authorization', `Bearer ${token}`);
    return fetch(url, { ...init, headers });
  };
  const token = await accessToken();
  const response = await send(token);
  if (response.status !== 401) return response;
  return send(await renewedToken(token));
}

export function databaseFetch(path: string, init: RequestInit = {}) {
  if (import.meta.env.DEV && isLocalPreview()) return import('./local-preview').then(preview => preview.previewDatabase(path, init));
  const headers = new Headers(init.headers);
  headers.set('apikey', supabaseKey);
  headers.set('Content-Type', 'application/json');
  return authenticatedFetch(`${supabaseUrl}/rest/v1/${path}`, { ...init, headers });
}

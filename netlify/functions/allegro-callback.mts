import type { Config } from '@netlify/functions';
import { AllegroOAuth, oauthCookie } from '../lib/allegro-oauth.ts';

export default async (request: Request) => {
  if (request.method !== 'GET') return new Response('Method not allowed', { status: 405 });
  const service = new AllegroOAuth();
  let result = 'connected';
  try { await service.callback(request); } catch { result = 'failed'; }
  // Never send authorization codes or tokens to the page, logs or analytics.
  return new Response(null, { status: 303, headers: { Location: `${service.config.origin}/admin/integracje?allegro=${result}#allegro-connection`,
    'Set-Cookie': oauthCookie('', 0), 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' } });
};
export const config: Config = { path: '/api/allegro/callback' };

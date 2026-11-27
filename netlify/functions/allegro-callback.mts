import type { Config } from '@netlify/functions';
import { randomUUID } from 'node:crypto';
import { AllegroOAuth, AllegroError, oauthCookie } from '../lib/allegro-oauth.ts';
import { allegroErrorCode } from '../../src/lib/allegro-errors.ts';

export default async (request: Request) => {
  if (request.method !== 'GET') return new Response('Method not allowed', { status: 405 });
  const destination = new URL('https://allsellio.netlify.app/admin/integracje');
  destination.hash = 'allegro-connection';
  try {
    await new AllegroOAuth().callback(request);
    destination.searchParams.set('allegro', 'connected');
  } catch (error) {
    const reason = allegroErrorCode(error instanceof AllegroError ? error.code : null), reference = randomUUID();
    destination.searchParams.set('allegro', 'failed');
    destination.searchParams.set('allegro_error', reason);
    destination.searchParams.set('allegro_ref', reference);
    // Never log raw errors, request URLs, codes, cookies, account data or tokens.
    console.warn('Allegro callback failed', { reason, reference,
      status: error instanceof AllegroError ? error.status : 500,
      upstreamStatus: error instanceof AllegroError ? error.upstreamStatus : undefined });
  }
  return new Response(null, { status: 303, headers: { Location: destination.href,
    'Set-Cookie': oauthCookie('', 0), 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' } });
};
export const config: Config = { path: '/api/allegro/callback' };

import { getStore } from '@netlify/blobs';
import type { Config } from '@netlify/functions';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

type Connection = { secret_hash: string; metadata: Record<string, unknown>; created_at: string; updated_at: string };
const blobs = getStore('sellio-connector');
const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { 'cache-control': 'no-store' } });
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const same = (left: string, right: string) => { const a = Buffer.from(left), b = Buffer.from(right); return a.length === b.length && timingSafeEqual(a, b); };
const validUrl = (value: unknown) => { if (typeof value !== 'string') throw new Error('Adres sklepu jest wymagany.'); const url = new URL(value); if (url.protocol !== 'https:') throw new Error('Adres sklepu musi używać HTTPS.'); return url.href.replace(/\/$/, ''); };
const authorize = (request: Request) => { const key = process.env.BACKEND_ADMIN_KEY ?? ''; const supplied = request.headers.get('x-backend-admin-key') ?? ''; return key && supplied && same(hash(supplied), hash(key)); };
const find = async (id: string) => (await blobs.get(`store:${id}`, { type: 'json' })) as Connection | null;

export default async (request: Request) => {
  if (!authorize(request)) return json({ error: 'Unauthorized' }, 401);
  const url = new URL(request.url);
  if (request.method === 'POST' && url.pathname === '/v1/admin/wordpress/stores') {
    let input: Record<string, unknown>; try { input = await request.json(); } catch { return json({ error: 'Invalid JSON' }, 400); }
    try {
      if (typeof input.name !== 'string' || !input.name.trim()) throw new Error('Nazwa sklepu jest wymagana.');
      const id = `wp_${randomBytes(9).toString('hex')}`, token = randomBytes(32).toString('base64url'), now = new Date().toISOString();
      await blobs.setJSON(`store:${id}`, { secret_hash: hash(token), metadata: { name: input.name.trim().slice(0, 100), site_url: validUrl(input.site_url), catalog_status: 'not_checked' }, created_at: now, updated_at: now });
      return json({ store_id: id, api_token: token }, 201);
    } catch (error) { return json({ error: error instanceof Error ? error.message : 'Invalid request' }, 400); }
  }
  const match = url.pathname.match(/^\/v1\/admin\/wordpress\/stores\/([\w-]+)\/catalog\/check$/);
  if (request.method === 'POST' && match) {
    const current = await find(match[1]); if (!current) return json({ error: 'Store not found' }, 404);
    let input: Record<string, unknown>; try { input = await request.json(); } catch { return json({ error: 'Invalid JSON' }, 400); }
    try {
      const siteUrl = validUrl(input.catalog_url); if (typeof input.catalog_token !== 'string' || !input.catalog_token) throw new Error('Token katalogu jest wymagany.');
      const response = await fetch(`${siteUrl}/wp-json/sellio/v1/connection`, { headers: { 'X-Sellio-Catalog-Token': input.catalog_token }, signal: AbortSignal.timeout(15_000) });
      const catalog = await response.json().catch(() => null);
      if (!response.ok || !catalog || catalog.contract_version !== '1') throw new Error('Nieprawidłowa odpowiedź katalogu WordPress.');
      await blobs.setJSON(`store:${match[1]}`, { ...current, metadata: { ...current.metadata, catalog_status: 'connected', catalog_checked_at: new Date().toISOString(), catalog }, updated_at: new Date().toISOString() });
      return json({ connected: true, catalog });
    } catch (error) { return json({ error: error instanceof Error ? error.message : 'Catalog unavailable' }, 502); }
  }
  return json({ error: 'Not found' }, 404);
};

export const config: Config = { path: '/v1/admin/*' };

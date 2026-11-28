import { getStore } from '@netlify/blobs';
import type { Config } from '@netlify/functions';
import { createHash, randomBytes } from 'node:crypto';
import { normalizeDraft } from '../../src/lib/allegro-drafts.ts';
import { AllegroOAuth, AllegroError, oauthCookie } from '../lib/allegro-oauth.ts';

type Connection = { secret_hash: string; owner_id?: string; metadata: Record<string, unknown>; created_at: string; updated_at: string };
const blobs = getStore('sellio-connector');
const draftBlobs = getStore({ name: 'sellio-connector', consistency: 'strong' });
const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { 'cache-control': 'no-store' } });
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const validUrl = (value: unknown) => { if (typeof value !== 'string') throw new Error('Adres sklepu jest wymagany.'); const url = new URL(value); if (url.protocol !== 'https:') throw new Error('Adres sklepu musi używać HTTPS.'); return url.href.replace(/\/$/, ''); };
const find = async (id: string) => (await blobs.get(`store:${id}`, { type: 'json' })) as Connection | null;
async function currentUser(request: Request) {
  const accessToken = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '') ?? '';
  const supabaseUrl = process.env.PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL ?? '';
  const supabaseKey = process.env.PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? process.env.SUPABASE_ANON_KEY ?? '';
  if (!accessToken || !supabaseUrl || !supabaseKey) return null;
  try {
    const response = await fetch(`${supabaseUrl.replace(/\/$/, '')}/auth/v1/user`, { headers: { Authorization: `Bearer ${accessToken}`, apikey: supabaseKey }, signal: AbortSignal.timeout(10_000) });
    if (!response.ok) return null;
    const user = await response.json();
    return typeof user?.id === 'string' ? user as { id: string } : null;
  } catch { return null; }
}
async function findOwned(id: string, userId: string) {
  const connection = await find(id);
  return connection?.owner_id === userId ? connection : null;
}
const editableProductFields = ['name', 'sku', 'regular_price', 'sale_price', 'price', 'stock_quantity', 'status', 'description', 'short_description'] as const;

async function registerConnection(request: Request, userId: string, id: string, connection: Connection) {
  const base = (process.env.PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL ?? '').replace(/\/$/, '');
  const headers = {
    apikey: process.env.PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? process.env.SUPABASE_ANON_KEY ?? '',
    Authorization: request.headers.get('authorization') ?? '',
    'Content-Type': 'application/json',
  };
  const query = async (path: string, init: RequestInit = {}) => {
    const response = await fetch(`${base}/rest/v1/${path}`, { ...init, headers: { ...headers, ...init.headers }, signal: AbortSignal.timeout(10_000) });
    if (!response.ok) throw new Error('Nie udało się zapisać integracji w bazie danych. Spróbuj ponownie.');
    return response;
  };
  const existing = await (await query(`stores?provider=eq.woocommerce&external_id=eq.${encodeURIComponent(id)}&select=id&limit=1`)).json();
  if (existing.length) return;
  const memberships = await (await query(`organization_members?user_id=eq.${encodeURIComponent(userId)}&select=organization_id&order=created_at.asc&limit=1`)).json();
  if (!memberships[0]) throw new Error('Nie znaleziono firmy dla tego konta.');
  const organizationId = memberships[0].organization_id;
  const siteUrl = String(connection.metadata.site_url || '');
  const sameCatalog = await (await query(`stores?organization_id=eq.${encodeURIComponent(organizationId)}&provider=eq.woocommerce&site_url=eq.${encodeURIComponent(siteUrl)}&select=id,credentials&order=updated_at.desc&limit=1`)).json();
  if (sameCatalog[0]) {
    await query(`stores?id=eq.${encodeURIComponent(sameCatalog[0].id)}`, {
      method: 'PATCH', headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({ external_id: id, name: connection.metadata.name, site_url: siteUrl, credentials: { ...(sameCatalog[0].credentials || {}), backend_url: new URL(request.url).origin } }),
    });
    return;
  }
  await query('stores?on_conflict=organization_id,provider,external_id', {
    method: 'POST', headers: { Prefer: 'resolution=ignore-duplicates,return=minimal' },
    body: JSON.stringify({ organization_id: organizationId, provider: 'woocommerce', external_id: id, name: connection.metadata.name, site_url: siteUrl, credentials: { backend_url: new URL(request.url).origin } }),
  });
}

function productUpdate(input: Record<string, unknown>) {
  const update: Record<string, unknown> = {};
  for (const field of editableProductFields) {
    if (!(field in input)) continue;
    const value = input[field];
    if (field === 'stock_quantity') {
      if (value !== null && (!Number.isInteger(value) || Number(value) < 0)) throw new Error('Stan magazynowy musi być liczbą całkowitą nie mniejszą od zera.');
      update[field] = value;
    } else if (field === 'status') {
      if (!['publish', 'draft', 'private', 'pending'].includes(String(value))) throw new Error('Nieprawidłowy status produktu.');
      update[field] = value;
    } else {
      if (value !== null && typeof value !== 'string') throw new Error('Nieprawidłowy format produktu.');
      update[field] = value === '' ? null : value;
    }
  }
  return update;
}

async function importCatalog(id: string, input: Record<string, unknown>, userId: string) {
  const current = await findOwned(id, userId); if (!current) return json({ error: 'Store not found' }, 404);
  let siteUrl: string;
  try { siteUrl = validUrl(input.catalog_url || current.metadata.site_url); }
  catch (error) { return json({ error: error instanceof Error ? error.message : 'Nieprawidłowy adres sklepu.' }, 400); }
  const explicitToken = typeof input.catalog_token === 'string' && input.catalog_token ? input.catalog_token : '';
  if (!explicitToken && siteUrl !== current.metadata.site_url) return json({ error: 'Dla innego adresu sklepu podaj nowy token katalogu.' }, 400);
  const catalogToken = explicitToken || String(current.metadata.catalog_token ?? '');
  if (!catalogToken) return json({ error: 'Token katalogu jest wymagany.' }, 400);
  const incremental = input.mode === 'incremental' && typeof current.metadata.catalog_imported_at === 'string';
  const modifiedAfter = incremental ? String(current.metadata.catalog_imported_at) : '';
  let imported = 0, page = 1, pages = 1;
  try {
    while (page <= pages && page <= 100) {
      const catalogUrl = new URL(`${siteUrl}/wp-json/sellio/v1/products`); catalogUrl.searchParams.set('page', String(page)); catalogUrl.searchParams.set('per_page', '100'); if (modifiedAfter) catalogUrl.searchParams.set('modified_after', modifiedAfter);
      const response = await fetch(catalogUrl, { headers: { 'X-Sellio-Catalog-Token': catalogToken }, signal: AbortSignal.timeout(15_000) });
      const products = await response.json().catch(() => null);
      if (!response.ok) {
        const retryAfter = response.headers.get('retry-after');
        if (response.status === 429) throw new Error(`Serwer WordPress ograniczył liczbę zapytań. Odczekaj ${retryAfter ? `${retryAfter} sekund` : 'kilka minut'} i spróbuj ponownie.`);
        if (response.status === 401 || response.status === 403) throw new Error('Token katalogu jest nieprawidłowy lub wygasł. Wygeneruj nowy token we wtyczce WordPress.');
        throw new Error(`Katalog WordPress zwrócił HTTP ${response.status}.`);
      }
      if (!Array.isArray(products)) throw new Error('Katalog WordPress zwrócił nieprawidłowy format odpowiedzi.');
      pages = Math.max(1, Number(response.headers.get('x-wp-totalpages') ?? 1));
      await Promise.all(products.map(product => {
        if (!product || typeof product.id !== 'string') throw new Error('Nieprawidłowy produkt w katalogu.');
        return blobs.setJSON(`product:${id}:${product.id}`, { ...product, store_id: id, imported_at: new Date().toISOString() });
      }));
      imported += products.length; page++;
    }
    if (page <= pages) throw new Error('Katalog jest zbyt duży dla jednorazowego importu.');
    await blobs.setJSON(`store:${id}`, { ...current, metadata: { ...current.metadata, ...(siteUrl === current.metadata.site_url ? { catalog_token: catalogToken } : {}), catalog_status: 'imported', catalog_imported_at: new Date().toISOString(), product_count: imported }, updated_at: new Date().toISOString() });
    return json({ imported, pages: page - 1, mode: incremental ? 'incremental' : 'full' });
  } catch (error) { return json({ error: error instanceof Error ? error.message : 'Catalog unavailable' }, 502); }
}

export default async (request: Request) => {
  if (!(process.env.PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL) || !(process.env.PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? process.env.SUPABASE_ANON_KEY)) {
    return json({ error: 'Backend nie ma konfiguracji Supabase. Dodaj PUBLIC_SUPABASE_URL oraz PUBLIC_SUPABASE_PUBLISHABLE_KEY w Netlify dla Functions i wdroż stronę ponownie.' }, 503);
  }
  const user = await currentUser(request);
  if (!user) return json({ error: 'Zaloguj się ponownie, aby zarządzać integracjami.' }, 401);
  const url = new URL(request.url);
  if (['/v1/admin/allegro/status', '/v1/admin/allegro/connect', '/v1/admin/allegro/check', '/v1/admin/allegro/connection'].includes(url.pathname)) {
    try {
      const service = new AllegroOAuth();
      if (request.method === 'GET' && url.pathname.endsWith('/status')) return json(await service.status(user.id));
      if (request.method === 'POST' && url.pathname.endsWith('/connect')) {
        const result = await service.start(user.id);
        return Response.json({ url: result.url }, { headers: { 'Cache-Control': 'no-store', 'Set-Cookie': result.cookie } });
      }
      if (request.method === 'POST' && url.pathname.endsWith('/check')) return json(await service.check(user.id));
      if (request.method === 'DELETE' && url.pathname.endsWith('/connection')) {
        const result = await service.disconnect(user.id);
        return Response.json(result, { headers: { 'Cache-Control': 'no-store', 'Set-Cookie': oauthCookie('', 0) } });
      }
      return json({ error: 'Niedozwolona metoda.' }, 405);
    } catch (error) { return json({ error: error instanceof AllegroError ? error.message : 'Nie udało się obsłużyć połączenia Allegro. Spróbuj ponownie.' }, error instanceof AllegroError ? (error.status === 401 ? 409 : error.status) : 503); }
  }
  const draftMatch = url.pathname.match(/^\/v1\/admin\/allegro\/stores\/([\w-]+)\/drafts(?:\/([\w-]+))?$/);
  if (draftMatch) {
    if (!await findOwned(draftMatch[1], user.id)) return json({ error: 'Nie znaleziono magazynu.' }, 404);
    const prefix = `allegro-draft:${user.id}:${draftMatch[1]}:`;
    if (request.method === 'GET' && !draftMatch[2]) {
      try {
        const entries = await draftBlobs.list({ prefix });
        const drafts = (await Promise.all(entries.blobs.map(entry => draftBlobs.get(entry.key, { type: 'json' })))).filter(Boolean);
        return json({ drafts });
      } catch { return json({ error: 'Nie udało się odczytać szkiców. Spróbuj ponownie.' }, 503); }
    }
    if (request.method === 'DELETE' && draftMatch[2]) {
      try {
        await draftBlobs.delete(`${prefix}${draftMatch[2]}`);
        return json({ deleted: true });
      } catch { return json({ error: 'Nie udało się usunąć szkicu. Spróbuj ponownie.' }, 503); }
    }
    if (request.method === 'PUT' && draftMatch[2]) {
      let draft;
      try {
        const raw = await request.text();
        if (raw.length > 100000) return json({ error: 'Szkic jest zbyt duży.' }, 413);
        draft = normalizeDraft(JSON.parse(raw));
        if (draft.productId !== draftMatch[2]) throw new Error('Identyfikator produktu nie pasuje do szkicu.');
      } catch (error) { return json({ error: error instanceof Error ? error.message : 'Nieprawidłowy szkic.' }, 400); }
      if (!await blobs.get(`product:${draftMatch[1]}:${draft.productId}`, { type: 'json' })) return json({ error: 'Nie znaleziono produktu w magazynie.' }, 404);
      try {
        const saved = { ...draft, updatedAt: new Date().toISOString() };
        await draftBlobs.setJSON(`${prefix}${draft.productId}`, saved);
        return json({ draft: saved });
      } catch { return json({ error: 'Nie udało się zapisać szkicu. Spróbuj ponownie.' }, 503); }
    }
    return json({ error: 'Niedozwolona metoda.' }, 405);
  }
  if (request.method === 'GET' && url.pathname === '/v1/admin/wordpress/stores') {
    try {
      const entries = await blobs.list({ prefix: 'store:' });
      let restored = 0;
      for (const entry of entries.blobs) {
        const connection = await find(entry.key.slice('store:'.length));
        if (connection?.owner_id !== user.id) continue;
        await registerConnection(request, user.id, entry.key.slice('store:'.length), connection);
        restored++;
      }
      return json({ restored });
    } catch (error) { return json({ error: error instanceof Error ? error.message : 'Nie udało się przywrócić integracji.' }, 503); }
  }
  if (request.method === 'POST' && url.pathname === '/v1/admin/wordpress/stores') {
    let input: Record<string, unknown>; try { input = await request.json(); } catch { return json({ error: 'Invalid JSON' }, 400); }
    try {
      if (typeof input.name !== 'string' || !input.name.trim()) throw new Error('Nazwa sklepu jest wymagana.');
      const siteUrl = validUrl(input.site_url);
      if (typeof input.catalog_token !== 'string' || !input.catalog_token) throw new Error('Token katalogu jest wymagany.');
      const catalogResponse = await fetch(`${siteUrl}/wp-json/sellio/v1/connection`, { headers: { 'X-Sellio-Catalog-Token': input.catalog_token }, signal: AbortSignal.timeout(15_000) });
      const catalog = await catalogResponse.json().catch(() => null);
      if (!catalogResponse.ok) throw new Error(`Katalog WordPress zwrócił HTTP ${catalogResponse.status}. Sprawdź token katalogu.`);
      if (!catalog || catalog.contract_version !== '1') throw new Error('Katalog WordPress zwrócił nieprawidłowy format odpowiedzi.');
      const id = `wp_${randomBytes(9).toString('hex')}`, token = randomBytes(32).toString('base64url'), now = new Date().toISOString();
      const connection = { secret_hash: hash(token), owner_id: user.id, metadata: { name: input.name.trim().slice(0, 100), site_url: siteUrl, catalog_token: input.catalog_token, catalog_status: 'connected', catalog_checked_at: now, catalog }, created_at: now, updated_at: now };
      await blobs.setJSON(`store:${id}`, connection);
      try { await registerConnection(request, user.id, id, connection); }
      catch (error) { await blobs.delete(`store:${id}`); throw error; }
      return json({ store_id: id, api_token: token }, 201);
    } catch (error) { return json({ error: error instanceof Error ? error.message : 'Invalid request' }, 400); }
  }
  const match = url.pathname.match(/^\/v1\/admin\/wordpress\/stores\/([\w-]+)\/catalog\/check$/);
  if (request.method === 'POST' && match) {
    const current = await findOwned(match[1], user.id); if (!current) return json({ error: 'Store not found' }, 404);
    let input: Record<string, unknown>; try { input = await request.json(); } catch { return json({ error: 'Invalid JSON' }, 400); }
    try {
      const siteUrl = validUrl(input.catalog_url); if (typeof input.catalog_token !== 'string' || !input.catalog_token) throw new Error('Token katalogu jest wymagany.');
      const response = await fetch(`${siteUrl}/wp-json/sellio/v1/connection`, { headers: { 'X-Sellio-Catalog-Token': input.catalog_token }, signal: AbortSignal.timeout(15_000) });
      const catalog = await response.json().catch(() => null);
      if (!response.ok) throw new Error(`Katalog WordPress zwrócił HTTP ${response.status}. Sprawdź token katalogu.`);
      if (!catalog || catalog.contract_version !== '1') throw new Error('Katalog WordPress zwrócił nieprawidłowy format odpowiedzi.');
      await blobs.setJSON(`store:${match[1]}`, { ...current, metadata: { ...current.metadata, catalog_status: 'connected', catalog_checked_at: new Date().toISOString(), catalog }, updated_at: new Date().toISOString() });
      return json({ connected: true, catalog });
    } catch (error) { return json({ error: error instanceof Error ? error.message : 'Catalog unavailable' }, 502); }
  }
  const importMatch = url.pathname.match(/^\/v1\/admin\/wordpress\/stores\/([\w-]+)\/catalog\/import$/);
  if (request.method === 'POST' && importMatch) {
    let input: Record<string, unknown>; try { input = await request.json(); } catch { return json({ error: 'Invalid JSON' }, 400); }
    return importCatalog(importMatch[1], input, user.id);
  }
  const productsMatch = url.pathname.match(/^\/v1\/admin\/wordpress\/stores\/([\w-]+)\/products$/);
  if (request.method === 'GET' && productsMatch) {
    const current = await findOwned(productsMatch[1], user.id); if (!current) return json({ error: 'Store not found' }, 404);
    const limit = Math.min(100, Math.max(1, Number(url.searchParams.get('limit') ?? 50) || 50));
    const offset = Math.max(0, Math.floor(Number(url.searchParams.get('offset') ?? 0) || 0));
    const keys = (await blobs.list({ prefix: `product:${productsMatch[1]}:` })).blobs;
    keys.sort((left, right) => left.key.localeCompare(right.key));
    const products = (await Promise.all(keys.slice(offset, offset + limit).map(entry => blobs.get(entry.key, { type: 'json' })))).filter(Boolean);
    products.sort((left: Record<string, unknown>, right: Record<string, unknown>) => String(left?.name ?? '').localeCompare(String(right?.name ?? ''), 'pl'));
    return json({ products, total: keys.length, store: current.metadata.name });
  }
  const ordersMatch = url.pathname.match(/^\/v1\/admin\/wordpress\/stores\/([\w-]+)\/orders$/);
  if (request.method === 'GET' && ordersMatch) {
    const current = await findOwned(ordersMatch[1], user.id); if (!current) return json({ error: 'Store not found' }, 404);
    const eventKeys = (await blobs.list({ prefix: 'event:' })).blobs;
    const events = await Promise.all(eventKeys.map(entry => blobs.get(entry.key, { type: 'json' }) as Promise<Record<string, any> | null>));
    const latest = new Map<string, Record<string, any>>();
    for (const event of events) {
      if (!event) continue;
      const order = event?.store_id === ordersMatch[1] ? event.payload?.data : null;
      if (!order?.id) continue;
      const existing = latest.get(String(order.id));
      if (!existing || String(event.received_at ?? '') > String(existing.received_at ?? '')) latest.set(String(order.id), { ...order, received_at: event.received_at, event_type: event.event_type });
    }
    const orders = [...latest.values()].sort((left, right) => String(right.modified_at ?? right.created_at ?? '').localeCompare(String(left.modified_at ?? left.created_at ?? '')));
    return json({ orders, total: orders.length, store: current.metadata.name });
  }
  const orderStatusMatch = url.pathname.match(/^\/v1\/admin\/wordpress\/stores\/([\w-]+)\/orders\/(\d+)\/status$/);
  if (request.method === 'POST' && orderStatusMatch) {
    const current = await findOwned(orderStatusMatch[1], user.id); if (!current) return json({ error: 'Store not found' }, 404);
    let input: Record<string, unknown>; try { input = await request.json(); } catch { return json({ error: 'Invalid JSON' }, 400); }
    const status = String(input.status ?? '').replace(/^wc-/, '');
    if (!['pending', 'on-hold', 'processing', 'completed', 'cancelled', 'refunded', 'failed'].includes(status)) return json({ error: 'Nieprawidłowy status zamówienia.' }, 400);
    const siteUrl = String(current.metadata.site_url ?? ''); const catalogToken = String(current.metadata.catalog_token ?? '');
    if (!siteUrl || !catalogToken) return json({ error: 'Brakuje bezpiecznego dostępu do katalogu. Skonfiguruj połączenie WooCommerce ponownie.' }, 409);
    try {
      const response = await fetch(`${siteUrl}/wp-json/sellio/v1/orders/${orderStatusMatch[2]}/status`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Sellio-Catalog-Token': catalogToken }, body: JSON.stringify({ status }), signal: AbortSignal.timeout(15_000) });
      const data = await response.json().catch(() => null);
      if (!response.ok) throw new Error(data?.message || data?.error || `WooCommerce zwrócił HTTP ${response.status}.`);
      return json({ order: data });
    } catch (error) { return json({ error: error instanceof Error ? error.message : 'Nie udało się zmienić statusu zamówienia.' }, 502); }
  }
  const productMatch = url.pathname.match(/^\/v1\/admin\/wordpress\/stores\/([\w-]+)\/products\/([\w-]+)$/);
  if (request.method === 'PATCH' && productMatch) {
    const current = await findOwned(productMatch[1], user.id); if (!current) return json({ error: 'Store not found' }, 404);
    let input: Record<string, unknown>; try { input = await request.json(); } catch { return json({ error: 'Invalid JSON' }, 400); }
    const existing = await blobs.get(`product:${productMatch[1]}:${productMatch[2]}`, { type: 'json' }) as Record<string, unknown> | null;
    if (!existing) return json({ error: 'Product not found' }, 404);
    try {
      const product = { ...existing, ...productUpdate(input), modified_at: new Date().toISOString() };
      await blobs.setJSON(`product:${productMatch[1]}:${productMatch[2]}`, product);
      return json({ product });
    } catch (error) { return json({ error: error instanceof Error ? error.message : 'Invalid request' }, 400); }
  }
  return json({ error: 'Not found' }, 404);
};

export const config: Config = { path: '/v1/admin/*' };

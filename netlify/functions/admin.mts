import { getStore } from '@netlify/blobs';
import type { Config } from '@netlify/functions';
import { createHash, randomBytes } from 'node:crypto';

type Connection = { secret_hash: string; owner_id?: string; metadata: Record<string, unknown>; created_at: string; updated_at: string };
const blobs = getStore('sellio-connector');
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
  const siteUrl = validUrl(input.catalog_url);
  if (typeof input.catalog_token !== 'string' || !input.catalog_token) return json({ error: 'Token katalogu jest wymagany.' }, 400);
  const incremental = input.mode === 'incremental' && typeof current.metadata.catalog_imported_at === 'string';
  const modifiedAfter = incremental ? String(current.metadata.catalog_imported_at) : '';
  let imported = 0, page = 1, pages = 1;
  try {
    while (page <= pages && page <= 100) {
      const catalogUrl = new URL(`${siteUrl}/wp-json/sellio/v1/products`); catalogUrl.searchParams.set('page', String(page)); catalogUrl.searchParams.set('per_page', '100'); if (modifiedAfter) catalogUrl.searchParams.set('modified_after', modifiedAfter);
      const response = await fetch(catalogUrl, { headers: { 'X-Sellio-Catalog-Token': input.catalog_token }, signal: AbortSignal.timeout(15_000) });
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
    await blobs.setJSON(`store:${id}`, { ...current, metadata: { ...current.metadata, catalog_status: 'imported', catalog_imported_at: new Date().toISOString(), product_count: imported }, updated_at: new Date().toISOString() });
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
      await blobs.setJSON(`store:${id}`, { secret_hash: hash(token), owner_id: user.id, metadata: { name: input.name.trim().slice(0, 100), site_url: siteUrl, catalog_status: 'connected', catalog_checked_at: now, catalog }, created_at: now, updated_at: now });
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
    const keys = (await blobs.list({ prefix: `product:${productsMatch[1]}:` })).blobs;
    const products = await Promise.all(keys.slice(0, limit).map(entry => blobs.get(entry.key, { type: 'json' })));
    products.sort((left: Record<string, unknown>, right: Record<string, unknown>) => String(left?.name ?? '').localeCompare(String(right?.name ?? ''), 'pl'));
    return json({ products, total: keys.length, store: current.metadata.name });
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

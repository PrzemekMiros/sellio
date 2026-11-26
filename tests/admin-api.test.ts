import { test, beforeEach, mock } from 'node:test';
import assert from 'node:assert/strict';

const records = new Map<string, any>();
const stores: any[] = [];
let failDatabase = false;
let catalogRequests = 0;
let lastCatalogToken: string | null = null;
mock.module('@netlify/blobs', { namedExports: { getStore: () => ({
  get: async (key: string) => records.get(key) ?? null,
  setJSON: async (key: string, value: unknown) => { records.set(key, value); },
  delete: async (key: string) => { records.delete(key); },
  list: async ({ prefix }: { prefix: string }) => ({ blobs: [...records.keys()].filter(key => key.startsWith(prefix)).map(key => ({ key })) }),
}) } });
process.env.PUBLIC_SUPABASE_URL = 'https://database.example.com';
process.env.PUBLIC_SUPABASE_PUBLISHABLE_KEY = 'test-key';
const { default: handler } = await import('../netlify/functions/admin.mts');

beforeEach(() => {
  records.clear(); stores.length = 0; failDatabase = false; catalogRequests = 0; lastCatalogToken = null;
  mock.method(globalThis, 'fetch', async (input: string | URL, init: RequestInit = {}) => {
    const url = new URL(input);
    if (url.pathname === '/auth/v1/user') return Response.json({ id: 'owner-1' });
    if (url.pathname === '/rest/v1/organization_members') return Response.json([{ organization_id: 'organization-1' }]);
    if (url.pathname === '/rest/v1/stores') {
      if (failDatabase) return Response.json({}, { status: 503 });
      if (init.method === 'POST') { stores.push(JSON.parse(String(init.body))); return new Response(null, { status: 201 }); }
      return Response.json(stores.filter(store => `eq.${store.external_id}` === url.searchParams.get('external_id')));
    }
    if (url.pathname === '/wp-json/sellio/v1/connection') return Response.json({ contract_version: '1' });
    if (url.pathname === '/wp-json/sellio/v1/products') {
      catalogRequests++;
      lastCatalogToken = new Headers(init.headers).get('X-Sellio-Catalog-Token');
      return Response.json([{ id: 'product-1', name: 'Stored product' }]);
    }
    throw new Error(`Unexpected request ${url}`);
  });
});
const request = (path = '', method = 'GET', body?: unknown) => new Request(`https://panel.example.com/v1/admin/wordpress/stores${path}`, {
  method, headers: { Authorization: 'Bearer test-session', 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}),
});
const connection = (owner = 'owner-1') => ({ owner_id: owner, secret_hash: 'hash', metadata: { name: 'Shop', site_url: 'https://shop.example.com', catalog_token: 'stored-secret' }, created_at: '', updated_at: '' });

test('connection is saved to the account before returning success; secrets stay on the server', async () => {
  const response = await handler(request('', 'POST', { name: 'Shop', site_url: 'https://shop.example.com', catalog_token: 'catalog-secret' }));
  assert.equal(response.status, 201);
  const result = await response.json();
  assert.equal(stores[0].external_id, result.store_id);
  assert.equal(stores[0].organization_id, 'organization-1');
  assert.deepEqual(stores[0].credentials, { backend_url: 'https://panel.example.com' });
  assert.equal(records.get(`store:${result.store_id}`).metadata.catalog_token, 'catalog-secret');
});

test('failed database persistence does not report success or leave an inaccessible new connection', async () => {
  failDatabase = true;
  const response = await handler(request('', 'POST', { name: 'Shop', site_url: 'https://shop.example.com', catalog_token: 'catalog-secret' }));
  assert.notEqual(response.status, 201);
  assert.equal(records.size, 0);
});

test('recovery only registers connections owned by the current user and preserves preferences', async () => {
  records.set('store:wp_own', connection()); records.set('store:wp_other', connection('other-user'));
  assert.equal((await handler(request())).status, 200);
  assert.deepEqual(stores.map(store => store.external_id), ['wp_own']);
  stores[0].credentials.inventory_sync = { sync_prices: false };
  await handler(request());
  assert.equal(stores.length, 1);
  assert.equal(stores[0].credentials.inventory_sync.sync_prices, false);
});

test('import reuses the stored catalog token and persists products', async () => {
  records.set('store:wp_own', connection());
  const response = await handler(request('/wp_own/catalog/import', 'POST', { mode: 'full' }));
  assert.equal(response.status, 200);
  assert.equal(lastCatalogToken, 'stored-secret');
  assert.equal(records.get('product:wp_own:product-1').name, 'Stored product');
});

test('stored catalog secrets are never forwarded to a different URL or used by another owner', async () => {
  records.set('store:wp_own', connection()); records.set('store:wp_other', connection('other-user'));
  assert.equal((await handler(request('/wp_own/catalog/import', 'POST', { catalog_url: 'https://other.example.com' }))).status, 400);
  assert.equal((await handler(request('/wp_other/catalog/import', 'POST', { mode: 'full' }))).status, 404);
  assert.equal(catalogRequests, 0);
});

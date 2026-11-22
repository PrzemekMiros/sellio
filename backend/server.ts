import { randomBytes } from 'node:crypto';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { config } from './config.ts';
import { Store } from './store.ts';
import { Allegro, ApiError, equal } from './allegro.ts';

const appConfig = config();
const store = new Store(appConfig.dbPath, appConfig.key);
const allegro = new Allegro(appConfig, store);

function reply(res: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'access-control-allow-origin': appConfig.adminOrigin, 'access-control-allow-headers': 'content-type, x-backend-admin-key', 'access-control-allow-methods': 'GET, POST, OPTIONS', ...headers });
  res.end(JSON.stringify(body));
}
async function body(req: IncomingMessage) {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) { size += chunk.length; if (size > 1_000_000) throw new ApiError(413, 'Payload too large'); chunks.push(chunk); }
  if (!size) return {};
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw new ApiError(400, 'Invalid JSON'); }
}
function bearer(req: IncomingMessage) { const value = req.headers.authorization; return typeof value === 'string' && value.startsWith('Bearer ') ? value.slice(7) : ''; }
function admin(req: IncomingMessage) {
  const value = req.headers['x-backend-admin-key'];
  if (typeof value !== 'string' || !equal(value, appConfig.adminKey)) throw new ApiError(401, 'Unauthorized');
}
function publicStore(row: Record<string, unknown>) { const { secret_hash: _secret, ...safe } = row; return safe; }
function validUrl(value: unknown, required = true) {
  if (!value && !required) return '';
  if (typeof value !== 'string') throw new ApiError(400, 'Invalid URL');
  const parsed = new URL(value);
  if (parsed.protocol !== 'https:' && !(parsed.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(parsed.hostname))) throw new ApiError(400, 'URL must use HTTPS');
  return parsed.href.replace(/\/$/, '');
}
async function handler(req: IncomingMessage, res: ServerResponse) {
  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
  if (req.method === 'OPTIONS') return reply(res, 204, {});
  if (req.method === 'GET' && url.pathname === '/health') return reply(res, 200, { ok: true });
  if (req.method === 'GET' && url.pathname === '/v1/connector/connection') {
    const id = req.headers['x-sellio-store-id']; const storeId = typeof id === 'string' ? id : ''; const row = storeId ? store.wordpressStore(storeId) : undefined;
    if (!row || !bearer(req) || !equal(bearer(req), String(row.secret_hash))) throw new ApiError(401, 'Unauthorized');
    return reply(res, 200, { service: 'sellio', api_version: '1', store_id: storeId, status: 'connected' });
  }
  if (req.method === 'POST' && url.pathname === '/v1/connector/events') {
    const id = req.headers['x-sellio-store-id']; const storeId = typeof id === 'string' ? id : ''; const row = storeId ? store.wordpressStore(storeId) : undefined;
    if (!row || !bearer(req) || !equal(bearer(req), String(row.secret_hash))) throw new ApiError(401, 'Unauthorized');
    const event = await body(req);
    const eventId = req.headers['idempotency-key'];
    if (typeof eventId !== 'string' || typeof event !== 'object' || !event || event.event_id !== eventId || event.store_id !== storeId || !['order.created', 'order.updated', 'order.snapshot'].includes(event.event_type) || typeof event.data?.id !== 'string') throw new ApiError(422, 'Invalid connector event');
    if (!store.wordpressEvent(eventId)) store.saveWordpressEvent(storeId, event as { event_id: string; event_type: string });
    return reply(res, 202, { accepted: true, event_id: eventId });
  }
  if (!url.pathname.startsWith('/v1/admin/')) throw new ApiError(404, 'Not found');
  admin(req);
  if (req.method === 'GET' && url.pathname === '/v1/admin/status') return reply(res, 200, { wordpress: store.wordpressStores().map(publicStore), allegro: allegro.status() });
  if (req.method === 'GET' && url.pathname === '/v1/admin/wordpress/stores') return reply(res, 200, { stores: store.wordpressStores().map(publicStore) });
  if (req.method === 'POST' && url.pathname === '/v1/admin/wordpress/stores') {
    const input = await body(req); const siteUrl = validUrl(input.site_url); const catalogUrl = validUrl(input.catalog_url, false);
    if (typeof input.name !== 'string' || !input.name.trim()) throw new ApiError(400, 'Store name is required');
    const id = `wp_${randomBytes(9).toString('hex')}`; const secret = randomBytes(32).toString('base64url');
    store.saveWordpressStore(id, secret, { name: input.name.trim().slice(0, 100), site_url: siteUrl, catalog_url: catalogUrl, catalog_token: typeof input.catalog_token === 'string' ? input.catalog_token : '', catalog_status: 'not_checked' });
    return reply(res, 201, { store_id: id, api_token: secret });
  }
  const match = url.pathname.match(/^\/v1\/admin\/wordpress\/stores\/([\w-]+)(?:\/(events|catalog\/check))?$/);
  if (match) {
    const row = store.wordpressStore(match[1]); if (!row) throw new ApiError(404, 'Store not found');
    if (req.method === 'GET' && match[2] === 'events') return reply(res, 200, { events: store.wordpressEvents(match[1]) });
    if (req.method === 'POST' && match[2] === 'catalog/check') {
      const input = await body(req); const meta = row.metadata as Record<string, unknown>;
      const catalogUrl = validUrl(input.catalog_url ?? meta.catalog_url); const catalogToken = typeof (input.catalog_token ?? meta.catalog_token) === 'string' ? (input.catalog_token ?? meta.catalog_token) : '';
      if (!catalogToken) throw new ApiError(400, 'Catalog token is required');
      let response: Response; try { response = await fetch(`${catalogUrl}/wp-json/sellio/v1/connection`, { headers: { 'X-Sellio-Catalog-Token': catalogToken }, signal: AbortSignal.timeout(15_000) }); } catch { throw new ApiError(502, 'WordPress catalog is unavailable'); }
      const result = await response.json().catch(() => null);
      if (!response.ok || !result || result.contract_version !== '1') throw new ApiError(502, 'Invalid WordPress catalog response');
      store.saveWordpressStore(match[1], String(row.secret_hash), { ...meta, catalog_url: catalogUrl, catalog_token: catalogToken, catalog_status: 'connected', catalog_checked_at: new Date().toISOString(), catalog: result });
      return reply(res, 200, { connected: true, catalog: result });
    }
  }
  throw new ApiError(404, 'Not found');
}
createServer((req, res) => handler(req, res).catch(error => reply(res, error instanceof ApiError ? error.status : 500, { error: error instanceof Error ? error.message : 'Internal server error' }))).listen(appConfig.port, () => console.log(`Sellio backend listening on ${appConfig.port}`));

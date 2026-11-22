import { getStore } from '@netlify/blobs';
import type { Config } from '@netlify/functions';
import { createHash, timingSafeEqual } from 'node:crypto';

type Connection = { secret_hash: string; metadata: Record<string, unknown>; created_at: string; updated_at: string };
const blobs = getStore('sellio-connector');
const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { 'cache-control': 'no-store' } });
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const same = (left: string, right: string) => {
  const a = Buffer.from(left), b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
};
const bearer = (request: Request) => request.headers.get('authorization')?.replace(/^Bearer /, '') ?? '';
const find = async (id: string) => (await blobs.get(`store:${id}`, { type: 'json' })) as Connection | null;

export default async (request: Request) => {
  const url = new URL(request.url);
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: { allow: 'GET, POST, OPTIONS' } });
  const id = request.headers.get('x-sellio-store-id') ?? '';
  const connection = id ? await find(id) : null;
  if (!connection || !bearer(request) || !same(hash(bearer(request)), connection.secret_hash)) return json({ error: 'Unauthorized' }, 401);
  if (request.method === 'GET' && url.pathname === '/v1/connector/connection') return json({ service: 'sellio', api_version: '1', store_id: id, status: 'connected' });
  if (request.method === 'POST' && url.pathname === '/v1/connector/events') {
    let event: Record<string, unknown>;
    try { event = await request.json(); } catch { return json({ error: 'Invalid JSON' }, 400); }
    const eventId = request.headers.get('idempotency-key') ?? '';
    const data = event.data as Record<string, unknown> | undefined;
    if (!eventId || event.event_id !== eventId || event.store_id !== id || !['order.created', 'order.updated', 'order.snapshot'].includes(String(event.event_type)) || typeof data?.id !== 'string') return json({ error: 'Invalid connector event' }, 422);
    const eventKey = `event:${eventId}`;
    if (!await blobs.get(eventKey)) await blobs.setJSON(eventKey, { store_id: id, event_type: event.event_type, payload: event, received_at: new Date().toISOString() });
    return json({ accepted: true, event_id: eventId }, 202);
  }
  return json({ error: 'Not found' }, 404);
};

export const config: Config = { path: '/v1/connector/*' };

import { test, beforeEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

const records = new Map<string, { data: any; etag: string }>();
let revision = 0;
mock.module('@netlify/blobs', { namedExports: { getStore: () => ({
  get: async (key: string) => structuredClone(records.get(key)?.data ?? null),
  getWithMetadata: async (key: string) => structuredClone(records.get(key) ?? null),
  setJSON: async (key: string, data: any, options: { onlyIfNew?: boolean; onlyIfMatch?: string } = {}) => {
    const current = records.get(key);
    if ((options.onlyIfNew && current) || (options.onlyIfMatch && current?.etag !== options.onlyIfMatch)) return { modified: false };
    const etag = String(++revision); records.set(key, { data: structuredClone(data), etag }); return { modified: true, etag };
  },
  delete: async (key: string) => { records.delete(key); },
  list: async ({ prefix }: { prefix: string }) => ({ blobs: [...records.keys()].filter(key => key.startsWith(prefix)).map(key => ({ key })) }),
}) } });
const { AllegroOAuth } = await import('../netlify/lib/allegro-oauth.ts');
const { default: callbackHandler } = await import('../netlify/functions/allegro-callback.mts');
let requests: { url: string; init?: RequestInit }[];
let response: (url: string, init?: RequestInit) => Promise<Response>;
beforeEach(() => {
  records.clear(); revision = 0; requests = [];
  process.env.ALLEGRO_CLIENT_ID = 'test-application'; process.env.ALLEGRO_CLIENT_SECRET = 'test-client-secret';
  process.env.ALLEGRO_TOKEN_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString('base64');
  process.env.ALLEGRO_USER_AGENT = 'Sellio/0.1.0 (+https://allsellio.netlify.app/integracja-allegro/)';
  response = async (url: string) => url.endsWith('/token') ? Response.json({ access_token: 'access-secret', refresh_token: 'refresh-secret', expires_in: 43200 }) : Response.json({ id: 'allegro-user', login: 'Sklep-testowy' });
});
const service = () => new AllegroOAuth((async (url: string, init?: RequestInit) => { requests.push({ url, init }); return response(url, init); }) as typeof fetch);
async function begin(client: InstanceType<typeof AllegroOAuth>, owner = 'owner-1') {
  const start = await client.start(owner), url = new URL(start.url);
  return { start, url, request: new Request(`https://allsellio.netlify.app/api/allegro/callback?state=${url.searchParams.get('state')}&code=one-time-code`, { headers: { cookie: start.cookie.split(';')[0] } }) };
}
test('missing application configuration disables connect without leaking credentials', async () => {
  delete process.env.ALLEGRO_CLIENT_SECRET;
  const client = service();
  assert.equal((await client.status('owner-1')).configured, false);
  await assert.rejects(client.start('owner-1'), /skonfigurować aplikację/);
  assert.equal(records.size, 0);
});

test('missing or unsafe User-Agent blocks OAuth before any network or storage writes', async () => {
  for (const value of ['', '   ', 'Sellio/0.1.0\r\nInjected: value', '********masked']) {
    process.env.ALLEGRO_USER_AGENT = value;
    const client = service();
    assert.equal((await client.status('owner-1')).configured, false);
    await assert.rejects(client.start('owner-1'), /skonfigurować aplikację/);
  }
  assert.equal(requests.length, 0); assert.equal(records.size, 0);
});

test('generated User-Agent is sent unchanged on connection and later profile checks', async () => {
  const client = service();
  await client.callback((await begin(client)).request);
  await service().check('owner-1');
  const profiles = requests.filter(item => item.url === 'https://api.allegro.pl/me');
  assert.equal(profiles.length, 2);
  for (const request of profiles) {
    assert.equal(new Headers(request.init?.headers).get('User-Agent'), process.env.ALLEGRO_USER_AGENT);
    assert.equal(new Headers(request.init?.headers).get('Accept-Language'), 'pl-PL');
  }
});
test('OAuth uses secure browser binding and PKCE; success persists encrypted tokens per owner', async () => {
  const client = service(), flow = await begin(client);
  assert.match(flow.start.cookie, /HttpOnly; Secure; SameSite=Lax/);
  assert.equal(flow.url.searchParams.get('code_challenge_method'), 'S256');
  assert.equal(flow.url.searchParams.get('redirect_uri'), 'https://allsellio.netlify.app/api/allegro/callback');
  await client.callback(flow.request);
  const params = new URLSearchParams(String(requests[0].init?.body));
  assert.equal(params.get('client_id'), 'test-application');
  assert.equal(new Headers(requests[0].init?.headers).has('Authorization'), false);
  assert.ok(!String(requests[0].init?.body).includes('test-client-secret'));
  assert.equal(createHash('sha256').update(params.get('code_verifier')!).digest('base64url'), flow.url.searchParams.get('code_challenge'));
  assert.equal((await service().status('owner-1')).account?.login, 'Sklep-testowy');
  assert.equal((await client.status('owner-2')).connected, false);
  const serialized = JSON.stringify([...records.values()]);
  assert.ok(!serialized.includes('access-secret') && !serialized.includes('refresh-secret'));
  assert.ok(!JSON.stringify(await client.status('owner-1')).includes('secret'));
});
test('wrong cookie, expired state, replay and a replaced flow cannot exchange tokens', async () => {
  const client = service(), first = await begin(client);
  await assert.rejects(client.callback(new Request(first.request.url)), /Sesja łączenia/);
  const second = await begin(client);
  await assert.rejects(client.callback(first.request), /anulowana/);
  assert.equal(requests.length, 0);
  await client.callback(second.request);
  await assert.rejects(client.callback(second.request), /już użyta/);
  const third = await begin(client);
  const mapping = records.get(`state:${createHash('sha256').update(third.url.searchParams.get('state')!).digest('hex')}`)!;
  mapping.data.expires = 1;
  await assert.rejects(client.callback(third.request), /Sesja łączenia/);
  assert.equal(requests.filter(item => item.url.endsWith('/token')).length, 1);
});
test('denied consent preserves the existing connection', async () => {
  const client = service(); await client.callback((await begin(client)).request);
  const flow = await begin(client), denied = new URL(flow.request.url); denied.searchParams.set('error', 'access_denied');
  await assert.rejects(client.callback(new Request(denied, { headers: flow.request.headers })), /Nie udzielono zgody/);
  assert.equal((await client.status('owner-1')).connected, true);
});
test('expired token is refreshed and the new pair survives a fresh service instance', async () => {
  response = async url => url.endsWith('/token') ? Response.json({ access_token: 'old-access', refresh_token: 'old-refresh', expires_in: 1 }) : Response.json({ id: 'allegro-user', login: 'Shop' });
  const client = service(); await client.callback((await begin(client)).request);
  response = async (url, init) => {
    if (url.endsWith('/token')) {
      assert.match(String(init?.body), /refresh_token=old-refresh/);
      assert.equal(new Headers(init?.headers).get('Authorization'), `Basic ${Buffer.from('test-application:test-client-secret').toString('base64')}`);
      assert.equal(new URLSearchParams(String(init?.body)).has('code_verifier'), false);
      return Response.json({ access_token: 'new-access', refresh_token: 'new-refresh', expires_in: 43200 });
    }
    assert.equal(new Headers(init?.headers).get('Authorization'), 'Bearer new-access'); return Response.json({ id: 'allegro-user', login: 'Shop' });
  };
  await client.check('owner-1'); await service().check('owner-1');
  assert.equal(requests.filter(item => String(item.init?.body).includes('grant_type=refresh_token')).length, 1);
});
test('API 401 retries once, while revoked refresh tokens require reconnect', async () => {
  const client = service(); await client.callback((await begin(client)).request);
  response = async url => url.endsWith('/me') ? Response.json({}, { status: 401 }) : Response.json({ error: 'invalid_grant', error_description: 'sensitive-remote-detail' }, { status: 400 });
  await assert.rejects(client.check('owner-1'), /Zgoda Allegro wygasła/);
  assert.equal((await client.status('owner-1')).reconnect, true);
  const count = requests.length; await assert.rejects(client.check('owner-1'), /Połącz konto/); assert.equal(requests.length, count);
});
test('disconnect invalidates pending callbacks and removes tokens', async () => {
  const client = service(); await client.callback((await begin(client)).request);
  const flow = await begin(client); await client.disconnect('owner-1');
  await assert.rejects(client.callback(flow.request), /anulowana/);
  assert.equal((await service().status('owner-1')).connected, false);
});
test('disconnect during token exchange cannot resurrect a connection', async () => {
  const client = service(), flow = await begin(client);
  response = async url => { if (url.endsWith('/token')) { await client.disconnect('owner-1'); return Response.json({ access_token: 'a', refresh_token: 'r', expires_in: 43200 }); } return Response.json({ id: 'id', login: 'shop' }); };
  await assert.rejects(client.callback(flow.request), /zmieniło się/);
  assert.equal((await client.status('owner-1')).connected, false);
});
test('concurrent workers cannot refresh the same token simultaneously', async () => {
  response = async url => url.endsWith('/token') ? Response.json({ access_token: 'a', refresh_token: 'r', expires_in: 1 }) : Response.json({ id: 'id', login: 'shop' });
  const client = service(); await client.callback((await begin(client)).request);
  let concurrentBlocked = false;
  response = async url => {
    if (url.endsWith('/token')) { await assert.rejects(service().check('owner-1'), /Trwa odświeżanie/); concurrentBlocked = true; return Response.json({ access_token: 'new-a', refresh_token: 'new-r', expires_in: 43200 }); }
    return Response.json({ id: 'id', login: 'shop' });
  };
  await client.check('owner-1'); assert.equal(concurrentBlocked, true);
});
test('public callback strips codes and returns a safe error on invalid state', async () => {
  const result = await callbackHandler(new Request('https://allsellio.netlify.app/api/allegro/callback?code=secret-code&state=bad'));
  assert.equal(result.status, 303); assert.match(result.headers.get('location')!, /allegro=failed/);
  assert.ok(![...result.headers].flat().join('').includes('secret-code'));
  assert.equal(result.headers.get('referrer-policy'), 'no-referrer');
  assert.equal(new URL(result.headers.get('location')!).searchParams.get('allegro_error'), 'browser_session');
});

test('callback diagnoses token rejection without exposing provider details in logs or redirects', async t => {
  const client = service(), flow = await begin(client);
  const logs: unknown[] = [];
  t.mock.method(console, 'warn', (...args: unknown[]) => logs.push(args));
  t.mock.method(globalThis, 'fetch', async () => Response.json({ error: 'invalid_client', error_description: 'sensitive-provider-detail' }, { status: 401 }));
  const result = await callbackHandler(flow.request), location = result.headers.get('location')!;
  assert.equal(new URL(location).searchParams.get('allegro_error'), 'invalid_client');
  assert.equal(result.headers.get('cache-control'), 'no-store');
  assert.match(result.headers.get('set-cookie')!, /Max-Age=0/);
  const output = JSON.stringify({ location, logs });
  for (const secret of ['sensitive-provider-detail', 'one-time-code', 'test-client-secret', flow.url.searchParams.get('state')!]) assert.ok(!output.includes(secret));
  assert.ok(output.includes('upstreamStatus'));
  assert.equal((await client.status('owner-1')).connected, false);
});

test('callback diagnoses forbidden profile reads without saving partial tokens', async t => {
  const client = service(), flow = await begin(client);
  t.mock.method(console, 'warn', () => {});
  t.mock.method(globalThis, 'fetch', async (url: string) => url.endsWith('/token')
    ? Response.json({ access_token: 'access-secret', refresh_token: 'refresh-secret', expires_in: 43200 })
    : Response.json({ errors: [{ message: 'untrusted private detail' }] }, { status: 403 }));
  const result = await callbackHandler(flow.request);
  assert.equal(new URL(result.headers.get('location')!).searchParams.get('allegro_error'), 'profile_forbidden');
  assert.equal((await client.status('owner-1')).connected, false);
  assert.ok(!JSON.stringify([...records.values()]).includes('access-secret'));
});

test('callback allowlists provider authorization errors and never exchanges a denied code', async () => {
  for (const [error, expected] of [['access_denied', 'consent_denied'], ['invalid_scope', 'invalid_scope'], ['private-error-with-secrets', 'authorization_rejected']]) {
    const client = service(), flow = await begin(client), url = new URL(flow.request.url);
    url.searchParams.set('error', error);
    const result = await callbackHandler(new Request(url, { headers: flow.request.headers }));
    assert.equal(new URL(result.headers.get('location')!).searchParams.get('allegro_error'), expected);
    assert.ok(!result.headers.get('location')!.includes('private-error-with-secrets'));
  }
  assert.equal(requests.length, 0);
});

test('unexpected storage failure returns a safe diagnostic instead of exposing an exception', async t => {
  const client = service(), flow = await begin(client);
  t.mock.method(AllegroOAuth.prototype, 'callback', async () => { throw new Error('private-storage-url-and-token'); });
  const logs: unknown[] = [];
  t.mock.method(console, 'warn', (...args: unknown[]) => logs.push(args));
  const result = await callbackHandler(flow.request), location = result.headers.get('location')!;
  assert.equal(new URL(location).searchParams.get('allegro_error'), 'internal');
  assert.ok(!JSON.stringify({ location, logs }).includes('private-storage-url-and-token'));
});

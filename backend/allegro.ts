import { randomBytes, timingSafeEqual } from 'node:crypto';
import type { Config } from './config.ts';
import { Store } from './store.ts';

type Tokens = { access_token: string; refresh_token: string; expires_in: number; expiresAt: number };
type Connection = { id: string; login: string };
type Order = { id: string };
export class ApiError extends Error { status: number; constructor(status: number, message: string) { super(message); this.status = status; } }
export function equal(a: string, b: string) { const x = Buffer.from(a), y = Buffer.from(b); return x.length === y.length && timingSafeEqual(x, y); }
export class Allegro {
  config: Config; store: Store; fetcher: typeof fetch;
  private tail: Promise<unknown> = Promise.resolve();
  constructor(config: Config, store: Store, fetcher = fetch) {
    this.config = config; this.store = store; this.fetcher = fetcher;
    const identity = `${config.environment}:${config.clientId}`;
    const existing = store.get<string>('identity');
    if (existing && existing !== identity) throw new Error('Use a separate database for each Allegro environment/application');
    store.set('identity', identity);
  }
  // Serialize refresh, callback, sync and disconnect in this single-process service.
  exclusive<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.tail.then(fn, fn); this.tail = next.catch(() => {}); return next;
  }
  start() {
    const state = randomBytes(32).toString('hex');
    this.store.set('oauth', { state, expires: Date.now() + 600_000 });
    const url = new URL('/auth/oauth/authorize', this.config.authUrl);
    url.search = new URLSearchParams({ response_type: 'code', client_id: this.config.clientId, redirect_uri: this.config.redirectUri, state, scope: 'allegro:api:orders:read allegro:api:profile:read' }).toString();
    return { state, url: url.href };
  }
  async request(url: string, init: RequestInit, retry = false): Promise<any> {
    for (let attempt = 0; ; attempt++) {
      let response: Response;
      try { response = await this.fetcher(url, { ...init, redirect: 'error', signal: AbortSignal.timeout(15_000) }); }
      catch { if (retry && attempt < 2) { await new Promise(r => setTimeout(r, 500 * 2 ** attempt)); continue; } throw new ApiError(502, 'Allegro network error'); }
      if (!response.ok) {
        if (retry && attempt < 2 && (response.status === 429 || response.status >= 500)) {
          const header = response.headers.get('retry-after');
          const delay = header ? (/^\d+$/.test(header) ? Number(header) * 1000 : Date.parse(header) - Date.now()) : 1000 * 2 ** attempt;
          if (delay > 30_000) throw new ApiError(503, 'Allegro rate limit; retry later');
          await new Promise(r => setTimeout(r, Math.max(500, Number.isFinite(delay) ? delay : 1000))); continue;
        }
        throw new ApiError(response.status === 401 || response.status === 400 ? 409 : 502, `Allegro HTTP ${response.status}`);
      }
      try { return await response.json(); } catch { throw new ApiError(502, 'Invalid Allegro response'); }
    }
  }
  async token(params: Record<string, string>): Promise<Tokens> {
    const data = await this.request(`${this.config.authUrl}/auth/oauth/token`, { method: 'POST', headers: { Authorization: `Basic ${Buffer.from(`${this.config.clientId}:${this.config.clientSecret}`).toString('base64')}`, 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(params).toString() });
    if (typeof data.access_token !== 'string' || typeof data.refresh_token !== 'string' || !Number.isFinite(data.expires_in) || data.expires_in <= 0) throw new ApiError(502, 'Invalid token response');
    return { ...data, expiresAt: Date.now() + data.expires_in * 1000 };
  }
  async callback(code: string, state: string, cookie: string) {
    const pending = this.store.get<{ state: string; expires: number }>('oauth');
    if (!pending || pending.expires < Date.now() || !state || !equal(state, pending.state) || !equal(state, cookie)) throw new ApiError(400, 'Invalid or expired OAuth state');
    this.store.delete('oauth');
    if (!code) throw new ApiError(400, 'Authorization denied');
    const tokens = await this.token({ grant_type: 'authorization_code', code, redirect_uri: this.config.redirectUri });
    const profile = await this.request(`${this.config.apiUrl}/me`, { headers: this.headers(tokens.access_token) }, true);
    if (typeof profile.id !== 'string' || typeof profile.login !== 'string') throw new ApiError(502, 'Invalid Allegro profile');
    this.store.transaction(() => { this.store.set('tokens', tokens); this.store.set('connection', { id: profile.id, login: profile.login }); this.store.delete('syncError'); });
    return { connected: true, account: profile.login };
  }
  headers(token: string) { return { Authorization: `Bearer ${token}`, Accept: 'application/vnd.allegro.public.v1+json' }; }
  async get(path: string) {
    let tokens = this.store.get<Tokens>('tokens');
    if (!tokens) throw new ApiError(409, 'Connect Allegro first');
    if (tokens.expiresAt < Date.now() + 60_000) {
      tokens = await this.token({ grant_type: 'refresh_token', refresh_token: tokens.refresh_token });
      this.store.set('tokens', tokens);
    }
    return this.request(`${this.config.apiUrl}${path}`, { headers: this.headers(tokens.access_token) }, true);
  }
  status() { return { environment: this.config.environment, connection: this.store.get<Connection>('connection') ?? null, lastSync: this.store.get('lastSync') ?? null, error: this.store.get('syncError') ?? null }; }
  disconnect() { this.store.transaction(() => { for (const key of ['tokens', 'connection', 'oauth']) this.store.delete(key); }); }
  async sync() {
    const account = this.store.get<Connection>('connection');
    if (!account) throw new ApiError(409, 'Connect Allegro first');
    const key = `cursor:${account.id}`;
    try {
      // Bounded batches resume from the committed event ID on the next run.
      let processed = 0;
      for (let page = 0; page < 10; page++) {
        const cursor = this.store.get<string>(key);
        const result = await this.get(`/order/events?limit=100${cursor ? `&from=${encodeURIComponent(cursor)}` : ''}`);
        if (!Array.isArray(result.events)) throw new ApiError(502, 'Invalid events response');
        for (const event of result.events) {
          if (typeof event.id !== 'string' || typeof event.order?.checkoutForm?.id !== 'string') throw new ApiError(502, 'Invalid order event');
          const order = await this.get(`/order/checkout-forms/${encodeURIComponent(event.order.checkoutForm.id)}`);
          this.store.transaction(() => { this.store.order(account.id, order); this.store.set(key, event.id); });
          processed++;
        }
        if (result.events.length < 100) break;
      }
      this.store.set('lastSync', new Date().toISOString()); this.store.delete('syncError'); return { processed };
    } catch (error) { this.store.set('syncError', error instanceof ApiError ? error.message : 'Synchronization failed'); throw error; }
  }
  async importPage(offset: number) {
    const account = this.store.get<Connection>('connection');
    if (!account) throw new ApiError(409, 'Connect Allegro first');
    const result = await this.get(`/order/checkout-forms?limit=100&offset=${offset}`);
    if (!Array.isArray(result.checkoutForms)) throw new ApiError(502, 'Invalid orders response');
    this.store.transaction(() => result.checkoutForms.forEach((order: Order) => this.store.order(account.id, order)));
    return { imported: result.checkoutForms.length, nextOffset: result.checkoutForms.length === 100 ? offset + 100 : null };
  }
}

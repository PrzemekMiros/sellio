import { getStore } from '@netlify/blobs';
import { createCipheriv, createDecipheriv, createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import type { AllegroErrorCode } from '../../src/lib/allegro-errors.ts';

// Request only permissions used by implemented API calls (currently GET /me).
// Add sales/order scopes when those features are implemented and consent is renewed.
const scopes = ['allegro:api:profile:read'];
const cookieName = '__Host-sellio-allegro-oauth';
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
type Tokens = { access_token: string; refresh_token: string; expiresAt: number };
type Account = { id: string; login: string };
type RecordData = { clientId: string; account?: Account; tokens?: Tokens; connectedAt?: string; checkedAt?: string; reconnect?: boolean; pending?: { state: string; verifier: string; expires: number }; lease?: number };
export class AllegroError extends Error {
  status: number;
  code: AllegroErrorCode;
  upstreamStatus?: number;
  constructor(message: string, status = 502, code: AllegroErrorCode = 'internal', upstreamStatus?: number) { super(message); this.status = status; this.code = code; this.upstreamStatus = upstreamStatus; }
}
export function allegroConfiguration() {
  const clientId = process.env.ALLEGRO_CLIENT_ID?.trim() || '';
  const clientSecret = process.env.ALLEGRO_CLIENT_SECRET?.trim() || '';
  const userAgent = process.env.ALLEGRO_USER_AGENT?.trim() || '';
  // Keep the generated identifier verbatim; reject values unsafe for HTTP headers.
  const validUserAgent = Boolean(userAgent && userAgent.length <= 1024 && /^[\x20-\x7e]+$/.test(userAgent) && !userAgent.includes('*'));
  const key = Buffer.from(process.env.ALLEGRO_TOKEN_ENCRYPTION_KEY || '', 'base64');
  const origin = 'https://allsellio.netlify.app';
  const ready = Boolean(clientId && clientSecret && !clientId.includes('*') && !clientSecret.includes('*') && key.length === 32 && validUserAgent);
  return { clientId, clientSecret, userAgent, key, ready, origin, redirectUri: `${origin}/api/allegro/callback` };
}
export function oauthCookie(value: string, age = 600) { return `${cookieName}=${value}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${age}`; }
export class AllegroOAuth {
  storage = getStore({ name: 'sellio-allegro', consistency: 'strong' });
  config = allegroConfiguration();
  fetcher: typeof fetch;
  constructor(fetcher: typeof fetch = fetch) { this.fetcher = fetcher; }
  private requireConfig() { if (!this.config.ready) throw new AllegroError('Administrator musi najpierw skonfigurować aplikację API Sellio w Netlify.', 503, 'configuration'); }
  private seal(userId: string, value: RecordData) {
    const iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', this.config.key, iv);
    cipher.setAAD(Buffer.from(userId));
    const body = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]);
    return { sealed: Buffer.concat([iv, cipher.getAuthTag(), body]).toString('base64') };
  }
  private async read(userId: string) {
    const row = await this.storage.getWithMetadata(`account:${userId}`, { type: 'json' });
    if (!row) return null;
    try {
      const data = Buffer.from(row.data.sealed, 'base64'), decipher = createDecipheriv('aes-256-gcm', this.config.key, data.subarray(0, 12));
      decipher.setAAD(Buffer.from(userId)); decipher.setAuthTag(data.subarray(12, 28));
      const record = JSON.parse(Buffer.concat([decipher.update(data.subarray(28)), decipher.final()]).toString('utf8')) as RecordData;
      if (record.clientId !== this.config.clientId) throw new Error('Application changed');
      return { record, etag: row.etag! };
    } catch { throw new AllegroError('Nie można odczytać połączenia. Sprawdź konfigurację aplikacji i klucz szyfrowania na serwerze.', 503, 'storage_read'); }
  }
  private async write(userId: string, record: RecordData, etag?: string) {
    const result = await this.storage.setJSON(`account:${userId}`, this.seal(userId, record), etag ? { onlyIfMatch: etag } : { onlyIfNew: true });
    if (!result.modified || !result.etag) throw new AllegroError('Połączenie zmieniło się w innym oknie. Odśwież status i spróbuj ponownie.', 409, 'storage_conflict');
    return result.etag;
  }
  async status(userId: string) {
    if (!this.config.ready) return { configured: false, connected: false, account: null, redirectUri: this.config.redirectUri };
    const row = await this.read(userId), record = row?.record;
    return { configured: true, connected: Boolean(record?.tokens && record.account), account: record?.account ?? null,
      reconnect: record?.reconnect ?? false, connectedAt: record?.connectedAt ?? null, checkedAt: record?.checkedAt ?? null, redirectUri: this.config.redirectUri };
  }
  async start(userId: string) {
    this.requireConfig();
    const state = randomBytes(32).toString('base64url'), verifier = randomBytes(48).toString('base64url');
    const row = await this.read(userId);
    if (row?.record.lease && row.record.lease > Date.now()) throw new AllegroError('Trwa odświeżanie połączenia. Spróbuj ponownie za chwilę.', 409);
    await this.write(userId, { ...(row?.record || { clientId: this.config.clientId }), pending: { state: hash(state), verifier, expires: Date.now() + 600000 } }, row?.etag);
    await this.storage.setJSON(`state:${hash(state)}`, { userId, expires: Date.now() + 600000 });
    const url = new URL('https://allegro.pl/auth/oauth/authorize');
    url.search = new URLSearchParams({ response_type: 'code', client_id: this.config.clientId, redirect_uri: this.config.redirectUri, state,
      scope: scopes.join(' '), code_challenge_method: 'S256', code_challenge: createHash('sha256').update(verifier).digest('base64url'), prompt: 'confirm' }).toString();
    return { url: url.href, cookie: oauthCookie(state) };
  }
  private async token(params: Record<string, string>): Promise<Tokens> {
    let response: Response;
    const headers: Record<string, string> = { 'Content-Type': 'application/x-www-form-urlencoded' };
    // Allegro's PKCE exchange uses client_id in the form instead of Basic auth.
    // Refresh remains authenticated with the application's client secret.
    const body = new URLSearchParams(params);
    if (params.grant_type === 'authorization_code' && params.code_verifier) body.set('client_id', this.config.clientId);
    else headers.Authorization = `Basic ${Buffer.from(`${this.config.clientId}:${this.config.clientSecret}`).toString('base64')}`;
    try { response = await this.fetcher('https://allegro.pl/auth/oauth/token', { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(15000),
      headers, body: body.toString() }); }
    catch { throw new AllegroError('Allegro nie odpowiedziało. Spróbuj ponownie.', 502, 'token_network'); }
    const data = await response.json().catch(() => null);
    if (!response.ok) {
      if (data?.error === 'invalid_grant') throw new AllegroError('Zgoda Allegro wygasła lub została cofnięta. Połącz konto ponownie.', 401, 'invalid_grant', response.status);
      if (data?.error === 'invalid_client') throw new AllegroError('Allegro odrzuciło dane aplikacji Sellio. Sprawdź konfigurację w Netlify.', 503, 'invalid_client', response.status);
      throw new AllegroError(`Autoryzacja Allegro jest niedostępna (HTTP ${response.status}).`, 502, 'token_rejected', response.status);
    }
    if (typeof data?.access_token !== 'string' || typeof data.refresh_token !== 'string' || !Number.isFinite(data.expires_in) || data.expires_in <= 0) throw new AllegroError('Nieprawidłowa odpowiedź autoryzacji Allegro.', 502, 'token_response');
    return { access_token: data.access_token, refresh_token: data.refresh_token, expiresAt: Date.now() + data.expires_in * 1000 };
  }
  private async profile(token: string): Promise<Account> {
    let response: Response;
    try { response = await this.fetcher('https://api.allegro.pl/me', { headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.allegro.public.v1+json', 'User-Agent': this.config.userAgent, 'Accept-Language': 'pl-PL' }, redirect: 'error', signal: AbortSignal.timeout(15000) }); }
    catch { throw new AllegroError('Nie udało się połączyć z API Allegro.', 502, 'profile_network'); }
    if (!response.ok) throw new AllegroError(`Nie udało się odczytać konta Allegro (HTTP ${response.status}).`, response.status === 401 ? 401 : 502,
      response.status === 401 ? 'profile_unauthorized' : response.status === 403 ? 'profile_forbidden' : 'profile_rejected', response.status);
    const data = await response.json().catch(() => null);
    if (typeof data?.id !== 'string' || typeof data.login !== 'string') throw new AllegroError('Allegro zwróciło nieprawidłowe dane konta.', 502, 'profile_response');
    return { id: data.id, login: data.login };
  }
  async callback(request: Request) {
    this.requireConfig();
    const url = new URL(request.url), state = url.searchParams.get('state') || '';
    const cookie = (request.headers.get('cookie') || '').split(';').map(part => part.trim()).find(part => part.startsWith(`${cookieName}=`))?.slice(cookieName.length + 1) || '';
    if (!/^[\w-]{43}$/.test(state) || !/^[\w-]{43}$/.test(cookie) || !timingSafeEqual(Buffer.from(state), Buffer.from(cookie))) throw new AllegroError('Sesja łączenia wygasła. Rozpocznij połączenie ponownie w Sellio.', 400, 'browser_session');
    const key = `state:${hash(state)}`, pending = await this.storage.get(key, { type: 'json' }) as { userId: string; expires: number } | null;
    if (!pending || pending.expires < Date.now()) throw new AllegroError('Sesja łączenia wygasła lub została już użyta.', 400, 'session_expired');
    const row = await this.read(pending.userId);
    if (!row?.record.pending || row.record.pending.expires < Date.now() || row.record.pending.state !== hash(state)) throw new AllegroError('Ta próba połączenia została anulowana lub zastąpiona nowszą.', 400, 'flow_replaced');
    const { pending: flow, ...record } = row.record;
    const claimedEtag = await this.write(pending.userId, record, row.etag);
    await this.storage.delete(key);
    if (url.searchParams.has('error')) {
      const error = url.searchParams.get('error');
      throw new AllegroError('Nie udzielono zgody na połączenie z Allegro.', 400,
        error === 'access_denied' ? 'consent_denied' : error === 'invalid_scope' ? 'invalid_scope' : 'authorization_rejected');
    }
    const code = url.searchParams.get('code');
    if (!code || code.length > 4096) throw new AllegroError('Brak poprawnego kodu autoryzacji.', 400, 'missing_code');
    const tokens = await this.token({ grant_type: 'authorization_code', code, redirect_uri: this.config.redirectUri, code_verifier: flow.verifier });
    const account = await this.profile(tokens.access_token), now = new Date().toISOString();
    await this.write(pending.userId, { clientId: this.config.clientId, account, tokens, connectedAt: now, checkedAt: now }, claimedEtag);
    return account;
  }
  private async activeToken(userId: string, rejectedToken?: string) {
    this.requireConfig();
    const row = await this.read(userId), record = row?.record;
    if (!row || !record?.tokens || !record.account) throw new AllegroError('Połącz najpierw konto Allegro.', 409);
    if (record.reconnect) throw new AllegroError('Połącz konto Allegro ponownie, aby odnowić zgodę.', 409);
    if (record.tokens.expiresAt > Date.now() + 60000 && (!rejectedToken || rejectedToken !== record.tokens.access_token)) return record.tokens.access_token;
    if (record.lease && record.lease > Date.now()) throw new AllegroError('Trwa odświeżanie połączenia. Spróbuj ponownie za chwilę.', 409);
    const lock = await this.write(userId, { ...record, lease: Date.now() + 30000 }, row.etag);
    try {
      const tokens = await this.token({ grant_type: 'refresh_token', refresh_token: record.tokens.refresh_token });
      const { lease: _lease, ...clean } = record;
      await this.write(userId, { ...clean, tokens }, lock);
      return tokens.access_token;
    } catch (error) {
      const { lease: _lease, ...clean } = record;
      await this.write(userId, { ...clean, reconnect: error instanceof AllegroError && error.status === 401 }, lock).catch(() => {});
      throw error;
    }
  }
  async check(userId: string) {
    let token = await this.activeToken(userId), account: Account;
    try { account = await this.profile(token); }
    catch (error) {
      if (!(error instanceof AllegroError) || error.status !== 401) throw error;
      token = await this.activeToken(userId, token); account = await this.profile(token);
    }
    const row = await this.read(userId);
    if (!row?.record.tokens || row.record.tokens.access_token !== token) throw new AllegroError('Połączenie zmieniło się podczas sprawdzania. Odśwież status.', 409);
    await this.write(userId, { ...row.record, account, checkedAt: new Date().toISOString() }, row.etag);
    return this.status(userId);
  }
  async disconnect(userId: string) {
    this.requireConfig();
    const row = await this.read(userId);
    // A tombstone invalidates in-flight callbacks and token refreshes through ETag checks.
    if (row) await this.write(userId, { clientId: this.config.clientId }, row.etag);
    return { disconnected: true };
  }
  async maintain() {
    if (!this.config.ready) return { checked: 0, failed: 0 };
    const entries = await this.storage.list({ prefix: 'account:' });
    let checked = 0, failed = 0;
    for (const entry of entries.blobs) {
      const userId = entry.key.slice('account:'.length);
      try {
        const row = await this.read(userId);
        if (!row?.record.tokens || row.record.reconnect) continue;
        await this.activeToken(userId); checked++;
      } catch { failed++; }
    }
    return { checked, failed };
  }
}

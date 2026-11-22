export function config(env = process.env) {
  const required = (key: string) => { const value = env[key]; if (!value) throw new Error(`Missing ${key}`); return value; };
  const environment = env.ALLEGRO_ENV ?? 'sandbox';
  if (!['sandbox', 'production'].includes(environment)) throw new Error('Invalid ALLEGRO_ENV');
  const key = Buffer.from(required('TOKEN_ENCRYPTION_KEY'), 'base64');
  if (key.length !== 32) throw new Error('TOKEN_ENCRYPTION_KEY must contain 32 random bytes (base64)');
  const adminKey = required('BACKEND_ADMIN_KEY');
  if (adminKey.length < 32) throw new Error('BACKEND_ADMIN_KEY must have at least 32 characters');
  const port = Number(env.BACKEND_PORT ?? env.PORT ?? 4322);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid port');
  const redirectUri = env.ALLEGRO_REDIRECT_URI ?? `http://localhost:${port}/api/allegro/callback`;
  const adminOrigin = env.ADMIN_ORIGIN ?? 'http://localhost:4321';
  const admin = new URL(adminOrigin);
  if (admin.protocol !== 'https:' && !(admin.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(admin.hostname))) throw new Error('ADMIN_ORIGIN must use HTTPS');
  const redirect = new URL(redirectUri);
  if (redirect.pathname !== '/api/allegro/callback' || redirect.search || redirect.hash || redirect.username || redirect.password || (redirect.protocol !== 'https:' && !(environment === 'sandbox' && redirect.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(redirect.hostname)))) throw new Error('Invalid callback URL');
  const suffix = environment === 'sandbox' ? '.allegrosandbox.pl' : '';
  // Allegro credentials are only needed when its OAuth flow is enabled. Keeping
  // them optional lets the WordPress connector run as a standalone service.
  return { environment, key, adminKey, port, adminOrigin: admin.origin, redirectUri, clientId: env.ALLEGRO_CLIENT_ID ?? '', clientSecret: env.ALLEGRO_CLIENT_SECRET ?? '', authUrl: `https://allegro.pl${suffix}`, apiUrl: `https://api.allegro.pl${suffix}`, dbPath: env.BACKEND_DB ?? `data/allegro-${environment}.sqlite` };
}
export type Config = ReturnType<typeof config>;

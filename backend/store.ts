import { DatabaseSync } from 'node:sqlite';
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

export class Store {
  db: DatabaseSync;
  key: Buffer;
  constructor(path: string, key: Buffer) {
    this.key = key;
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS orders (account TEXT NOT NULL, id TEXT NOT NULL, payload TEXT NOT NULL, updated TEXT NOT NULL, PRIMARY KEY(account,id));
      CREATE TABLE IF NOT EXISTS wordpress_stores (id TEXT PRIMARY KEY, secret_hash TEXT NOT NULL, metadata TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS wordpress_events (event_id TEXT PRIMARY KEY, store_id TEXT NOT NULL, event_type TEXT NOT NULL, payload TEXT NOT NULL, received_at TEXT NOT NULL);`);
  }
  seal(value: unknown) {
    const iv = randomBytes(12); const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    const body = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]);
    return Buffer.concat([iv, cipher.getAuthTag(), body]).toString('base64');
  }
  unseal<T>(value: string): T {
    const data = Buffer.from(value, 'base64'); const decipher = createDecipheriv('aes-256-gcm', this.key, data.subarray(0, 12));
    decipher.setAuthTag(data.subarray(12, 28));
    return JSON.parse(Buffer.concat([decipher.update(data.subarray(28)), decipher.final()]).toString());
  }
  get<T>(key: string): T | undefined { const row = this.db.prepare('SELECT value FROM settings WHERE key=?').get(key); return row ? this.unseal<T>(String(row.value)) : undefined; }
  set(key: string, value: unknown) { this.db.prepare('INSERT OR REPLACE INTO settings VALUES (?,?)').run(key, this.seal(value)); }
  delete(key: string) { this.db.prepare('DELETE FROM settings WHERE key=?').run(key); }
  transaction(fn: () => void) { this.db.exec('BEGIN IMMEDIATE'); try { fn(); this.db.exec('COMMIT'); } catch (e) { this.db.exec('ROLLBACK'); throw e; } }
  order(account: string, order: { id: string }) {
    if (!order || typeof order.id !== 'string') throw new Error('Invalid order response');
    this.db.prepare('INSERT OR REPLACE INTO orders VALUES (?,?,?,?)').run(account, order.id, this.seal(order), new Date().toISOString());
  }
  orders(account: string, offset: number, limit: number) {
    return this.db.prepare('SELECT payload FROM orders WHERE account=? ORDER BY updated DESC,id LIMIT ? OFFSET ?').all(account, limit, offset).map(row => this.unseal(String(row.payload)));
  }
  wordpressStore(id: string): ({ id: string; secret_hash: string; created_at: string; updated_at: string; metadata: Record<string, unknown> }) | undefined {
    const row = this.db.prepare('SELECT id, secret_hash, metadata, created_at, updated_at FROM wordpress_stores WHERE id=?').get(id) as Record<string, unknown> | undefined;
    return row ? { id: String(row.id), secret_hash: String(row.secret_hash), created_at: String(row.created_at), updated_at: String(row.updated_at), metadata: this.unseal<Record<string, unknown>>(String(row.metadata)) } : undefined;
  }
  wordpressStores() {
    return this.db.prepare('SELECT id, metadata, created_at, updated_at FROM wordpress_stores ORDER BY created_at DESC').all().map((row: Record<string, unknown>) => ({ ...row, metadata: this.unseal<Record<string, unknown>>(String(row.metadata)) }));
  }
  saveWordpressStore(id: string, secretHash: string, metadata: unknown) {
    const now = new Date().toISOString();
    this.db.prepare(`INSERT INTO wordpress_stores (id, secret_hash, metadata, created_at, updated_at) VALUES (?,?,?,?,?)
      ON CONFLICT(id) DO UPDATE SET secret_hash=excluded.secret_hash, metadata=excluded.metadata, updated_at=excluded.updated_at`).run(id, secretHash, this.seal(metadata), now, now);
  }
  wordpressEvent(eventId: string) { return this.db.prepare('SELECT event_id FROM wordpress_events WHERE event_id=?').get(eventId); }
  saveWordpressEvent(storeId: string, event: { event_id: string; event_type: string }) {
    this.db.prepare('INSERT INTO wordpress_events VALUES (?,?,?,?,?)').run(event.event_id, storeId, event.event_type, this.seal(event), new Date().toISOString());
  }
  wordpressEvents(storeId: string, limit = 20) {
    return this.db.prepare('SELECT event_id, event_type, payload, received_at FROM wordpress_events WHERE store_id=? ORDER BY received_at DESC LIMIT ?').all(storeId, limit).map((row: Record<string, unknown>) => ({ ...row, payload: this.unseal<Record<string, unknown>>(String(row.payload)) }));
  }
}

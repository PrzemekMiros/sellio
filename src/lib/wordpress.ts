import { authenticatedFetch, databaseFetch } from './auth';

export type WordpressStore = {
  id: string;
  external_id: string;
  name: string;
  site_url: string;
  credentials: { backend_url: string; inventory_sync?: Record<string, unknown> };
};

export async function loadWordpressStore(): Promise<WordpressStore | null> {
  const read = async () => {
    const response = await databaseFetch('stores?provider=eq.woocommerce&select=id,external_id,name,site_url,credentials&order=updated_at.desc&limit=1');
    if (!response.ok) throw new Error('Nie udało się odczytać integracji z bazy. Spróbuj ponownie.');
    const stores = await response.json();
    return (stores[0] as WordpressStore | undefined) ?? null;
  };
  let store = await read();
  if (!store) {
    // Recover existing server connections if the old browser-side save was interrupted.
    const response = await authenticatedFetch('/v1/admin/wordpress/stores');
    if (!response.ok) throw new Error('Nie udało się przywrócić zapisanej integracji. Spróbuj ponownie.');
    store = await read();
  }
  return store;
}

export async function saveInventorySettings(store: WordpressStore, settings: Record<string, unknown>) {
  const response = await databaseFetch(`stores?id=eq.${encodeURIComponent(store.id)}&select=id`, {
    method: 'PATCH', headers: { Prefer: 'return=representation' },
    body: JSON.stringify({ credentials: { ...store.credentials, inventory_sync: settings } }),
  });
  if (!response.ok || !(await response.json()).length) throw new Error('Nie udało się zapisać zasad w bazie. Spróbuj ponownie.');
}

/** This module is dynamically imported only by the development build on loopback. */
const key = 'sellio-local-preview-v1';
const initial = () => ({
  store: { id: 'local-store', external_id: 'wp_local', name: 'Sklep testowy', site_url: 'https://example.invalid', credentials: { backend_url: location.origin } },
  products: [{
    id: 'local-product', name: 'Produkt testowy — lampa LED', sku: 'DEMO-LED', type: 'simple',
    status: 'draft', regular_price: '249.00', sale_price: null, price: '249.00', currency: 'PLN',
    stock_quantity: 10, stock_status: 'instock', manage_stock: true,
    short_description: 'Przykładowy produkt do lokalnego podglądu panelu.',
    description: 'Dane testowe. Zmiany zapisują się tylko w tej przeglądarce i nie trafiają do sklepu.',
    images: [], categories: [{ id: 'local-category', name: 'Produkty testowe' }], attributes: [], parent_id: null,
  }] as Record<string, any>[],
  allegroDrafts: [] as Record<string, any>[],
  orders: [101, 102].map(id => ({
    id: String(id), number: `TEST-${id}`, status: id === 101 ? 'processing' : 'pending',
    created_at: '2026-11-26T10:00:00Z', modified_at: '2026-11-26T10:00:00Z',
    currency: 'PLN', total: '264.00', total_tax: '49.37', discount_total: '0.00', shipping_total: '12.20',
    payment_method: 'Przelew bankowy', shipping_method: 'Kurier', date_paid: null,
    email: 'klient@example.invalid', phone: null,
    billing: { first_name: 'Klient', last_name: 'Testowy', address_1: 'Testowa 1', city: 'Warszawa', postcode: '00-001', country: 'PL' },
    shipping: { first_name: 'Klient', last_name: 'Testowy', address_1: 'Testowa 1', city: 'Warszawa', postcode: '00-001', country: 'PL' },
    items: [{ id: '1', name: 'Produkt testowy — lampa LED', sku: 'DEMO-LED', quantity: 1, total: '202.43', total_tax: '46.57', variation_attributes: {} }],
  })) as Record<string, any>[],
});
function read(): ReturnType<typeof initial> {
  try { const saved = JSON.parse(localStorage.getItem(key) || 'null'); if (saved?.store?.external_id === 'wp_local' && Array.isArray(saved.products)) return { ...saved, orders: Array.isArray(saved.orders) ? saved.orders : initial().orders }; } catch {}
  return initial();
}
function save(data: ReturnType<typeof initial>) { localStorage.setItem(key, JSON.stringify(data)); }
const blocked = () => Response.json({ error: 'To podgląd lokalny. Połączenia z prawdziwym sklepem są tutaj wyłączone.' }, { status: 403 });

export async function previewDatabase(path: string, init: RequestInit = {}) {
  const url = new URL(path, 'https://preview.invalid/');
  const data = read(); const method = init.method?.toUpperCase() || 'GET';
  if (url.pathname !== '/stores') return blocked();
  if (method === 'GET') return Response.json([data.store]);
  if (method === 'PATCH' && url.searchParams.get('id') === 'eq.local-store') {
    const input = JSON.parse(String(init.body || '{}'));
    data.store.credentials = { ...data.store.credentials, inventory_sync: input.credentials?.inventory_sync } as typeof data.store.credentials;
    save(data); return Response.json([data.store]);
  }
  return blocked();
}

export async function previewRequest(input: string, init: RequestInit = {}) {
  const url = new URL(input, location.origin);
  // Never forward a preview request to an actual backend, even if a form contains its URL.
  if (url.origin !== location.origin) return blocked();
  const data = read(); const method = init.method?.toUpperCase() || 'GET';
  const base = '/v1/admin/wordpress/stores/wp_local';
  if (method === 'GET' && url.pathname === '/v1/admin/allegro/status') return Response.json({ configured: false, connected: false, account: null });
  if (method === 'GET' && url.pathname === `${base}/products`) {
    const offset = Number(url.searchParams.get('offset') || 0), limit = Number(url.searchParams.get('limit') || 100);
    return Response.json({ products: data.products.slice(offset, offset + limit), total: data.products.length });
  }
  const draftBase = '/v1/admin/allegro/stores/wp_local/drafts';
  if (method === 'GET' && url.pathname === draftBase) return Response.json({ drafts: data.allegroDrafts || [] });
  if (method === 'PUT' && url.pathname.startsWith(`${draftBase}/`)) {
    const { normalizeDraft } = await import('./allegro-drafts');
    try {
      const draft = { ...normalizeDraft(JSON.parse(String(init.body))), updatedAt: new Date().toISOString() };
      if (!data.products.some(product => String(product.id) === draft.productId)) return blocked();
      data.allegroDrafts = [...(data.allegroDrafts || []).filter(item => item.productId !== draft.productId), draft];
      save(data); return Response.json({ draft });
    } catch (error) { return Response.json({ error: (error as Error).message }, { status: 400 }); }
  }
  if (method === 'GET' && url.pathname === `${base}/orders`) return Response.json({ orders: data.orders, total: data.orders.length });
  const orderStatus = url.pathname.match(/^\/v1\/admin\/wordpress\/stores\/wp_local\/orders\/(\d+)\/status$/);
  if (method === 'POST' && orderStatus) {
    const order = data.orders.find(order => order.id === orderStatus[1]);
    if (!order) return Response.json({ error: 'Nie znaleziono zamówienia testowego.' }, { status: 404 });
    const { status } = JSON.parse(String(init.body || '{}'));
    if (!['pending', 'on-hold', 'processing', 'completed', 'cancelled', 'refunded', 'failed'].includes(status)) return Response.json({ error: 'Nieprawidłowy status.' }, { status: 400 });
    order.status = status; order.modified_at = new Date().toISOString(); save(data);
    return Response.json({ order });
  }
  if (method === 'PATCH' && url.pathname.startsWith(`${base}/products/`)) {
    const id = decodeURIComponent(url.pathname.slice(`${base}/products/`.length));
    const product = data.products.find(product => product.id === id);
    if (!product) return Response.json({ error: 'Nie znaleziono produktu testowego.' }, { status: 404 });
    const values = JSON.parse(String(init.body || '{}'));
    for (const field of ['name', 'sku', 'regular_price', 'sale_price', 'price', 'stock_quantity', 'status', 'short_description', 'description']) {
      if (field in values) product[field] = values[field];
    }
    save(data); return Response.json({ product });
  }
  return blocked();
}

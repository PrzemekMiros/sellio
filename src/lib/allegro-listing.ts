import { authenticatedFetch, databaseFetch, isLocalPreview } from './auth';
import { loadWordpressStore, type WordpressStore } from './wordpress';
import { normalizeDraft, draftIssues, type AllegroDraft } from './allegro-drafts';

type Product = Record<string, any>;
export function initAllegroListing() {
  const root = document.querySelector<HTMLElement>('[data-allegro-listing]');
  if (!root) return;
  if (!isLocalPreview()) root.querySelector<HTMLDetailsElement>('.al-filter-panel')?.removeAttribute('open');
  const get = <T extends HTMLElement = HTMLElement>(name: string) => root.querySelector<T>(`[data-${name}]`)!;
  const field = (name: string) => get<HTMLInputElement | HTMLSelectElement>(name);
  let stores: WordpressStore[] = [], store: WordpressStore | undefined;
  let products: Product[] = [], drafts = new Map<string, AllegroDraft>();
  let selected = new Set<string>(), editing: AllegroDraft[] = [];
  let pendingEditorIds: string[] = [];
  let page = 1, view = 'all', busy = false, dirty = false, loadFailed = false;
  let retryBatch: { action: string; ids: string[] } | null = null;
  const feedback = (message: string, error = false) => { get('feedback').textContent = message; get('feedback').dataset.error = String(error); };
  const text = (tag: string, value: string, className = '') => { const element = document.createElement(tag); element.textContent = value; element.className = className; return element; };
  const button = (label: string, action: () => void, className = 'al-button') => { const element = document.createElement('button'); element.type = 'button'; element.className = className; element.textContent = label; element.addEventListener('click', action); return element; };
  const base = () => `/v1/admin/allegro/stores/${encodeURIComponent(store!.external_id)}/drafts`;
  const endpoint = (path: string) => `${store!.credentials.backend_url.replace(/\/$/, '')}${path}`;
  async function api(path: string, init?: RequestInit) {
    const response = await authenticatedFetch(endpoint(path), init);
    const result = await response.json().catch(() => null);
    if (!response.ok || !result) throw new Error(result?.error || `Nie udało się pobrać danych (HTTP ${response.status}).`);
    return result;
  }
  function markDirty() { dirty = true; get('save-state').textContent = 'Niezapisane zmiany'; }
  function thumbnail(product: Product) {
    const url = product.images?.[0]?.url;
    if (typeof url === 'string' && /^https:\/\//i.test(url)) { const image = document.createElement('img'); image.className = 'al-thumb'; image.src = url; image.alt = ''; image.loading = 'lazy'; return image; }
    return text('span', '◇', 'al-thumb');
  }
  function identity(product: Product) {
    const wrapper = text('div', '', 'al-product'); const details = document.createElement('div');
    details.append(text('strong', product.name || 'Bez nazwy'), text('small', `SKU: ${product.sku || '—'} · ID: ${product.id}`));
    wrapper.append(thumbnail(product), details); return wrapper;
  }
  function isAllegroListed(product: Product) {
    if (product.allegro_offer_id || product.allegroOfferId || product.allegro_listed === true || product.is_allegro_listed === true) return true;
    const offers = Array.isArray(product.allegro_offers) ? product.allegro_offers : Array.isArray(product.allegroOffers) ? product.allegroOffers : [];
    return offers.some((offer: Product) => offer?.id && !['draft', 'ended', 'inactive'].includes(String(offer.status || '').toLowerCase()));
  }
  function catalogIdentity(product: Product, isListed: boolean) {
    const wrapper = text('div', '', 'al-catalog-product');
    const title = text('strong', product.name || 'Bez nazwy');
    if (isListed) title.prepend(text('span', '1', 'al-draft-mark'));
    const identifiers = [product.ean || product.global_unique_id ? `EAN ${product.ean || product.global_unique_id}` : '', product.sku ? `SKU ${product.sku}` : ''].filter(Boolean);
    wrapper.append(title);
    if (identifiers.length) wrapper.append(text('small', identifiers.map(value => `[${value}]`).join(' ')));
    return wrapper;
  }
  const stockKind = (product: Product) => product.stock_status === 'outofstock' || product.stock_quantity === 0 ? 'empty' : Number(product.stock_quantity) > 0 || product.stock_status === 'instock' ? 'available' : 'unknown';
  function filtered() {
    const query = field('search').value.trim().toLocaleLowerCase('pl');
    const category = field('category').value, stock = field('stock').value;
    return products.filter(product => (!query || [product.name, product.sku, product.ean, product.global_unique_id, product.id].join(' ').toLocaleLowerCase('pl').includes(query))
      && (!category || (product.categories || []).some((item: Product) => String(item.id) === category))
      && (!stock || stockKind(product) === stock) && (view !== 'drafts' || drafts.has(String(product.id))))
      .sort((a, b) => field('sort').value === 'price-asc' ? Number(a.price || 0) - Number(b.price || 0) : field('sort').value === 'price-desc' ? Number(b.price || 0) - Number(a.price || 0) : field('sort').value === 'stock' ? Number(b.stock_quantity || 0) - Number(a.stock_quantity || 0) : String(a.name).localeCompare(String(b.name), 'pl'));
  }
  function visibleProducts() { const size = Number(field('page-size').value); return filtered().slice((page - 1) * size, page * size); }
  function updateSelection() {
    get('selected').textContent = `Zaznaczono: ${selected.size}`;
    get<HTMLButtonElement>('open-selected').disabled = !selected.size || busy;
    get<HTMLButtonElement>('run-batch').disabled = !selected.size || busy;
    get<HTMLButtonElement>('clear-selection').disabled = !selected.size || busy;
    get<HTMLButtonElement>('select-filtered').disabled = !filtered().length || busy;
    get('select-filtered').textContent = `Zaznacz wszystkie wyniki (${filtered().length})`;
    const matching = filtered().filter(product => selected.has(String(product.id))).length;
    const saved = [...selected].filter(id => drafts.has(id)).length;
    get('selection-note').textContent = selected.size ? `Zapisane szkice: ${saved}. Poza bieżącymi filtrami: ${selected.size - matching}. Akcja obejmie wszystkie zaznaczone produkty.` : 'Zaznacz produkty na stronie lub wszystkie wyniki wyszukiwania.';
    const visible = visibleProducts(); const checked = visible.filter(item => selected.has(String(item.id))).length;
    const all = get<HTMLInputElement>('select-page'); all.checked = visible.length > 0 && checked === visible.length; all.indeterminate = checked > 0 && checked < visible.length; all.disabled = !visible.length || busy;
  }
  function render() {
    const items = filtered(), size = Number(field('page-size').value), pages = Math.max(1, Math.ceil(items.length / size));
    page = Math.min(page, pages);
    get('products').replaceChildren();
    for (const product of visibleProducts()) {
      const id = String(product.id), row = document.createElement('tr'), checkCell = document.createElement('td'), check = document.createElement('input');
      check.type = 'checkbox'; check.disabled = busy; check.checked = selected.has(id); check.setAttribute('aria-label', `Zaznacz ${product.name}`); row.classList.toggle('is-selected', check.checked);
      check.addEventListener('change', () => { if (check.checked) selected.add(id); else selected.delete(id); row.classList.toggle('is-selected', check.checked); updateSelection(); }); checkCell.append(check);
      const nameCell = document.createElement('td'); nameCell.append(catalogIdentity(product, isAllegroListed(product)));
      const price = product.price != null && product.price !== '' && Number.isFinite(Number(product.price)) ? `${Number(product.price).toLocaleString('pl-PL', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${product.currency || 'PLN'}` : '—';
      const actionCell = document.createElement('td'), action = button('Formularz wystawiania »', () => openEditor([id]), 'al-button al-row-action');
      action.setAttribute('aria-label', 'Formularz wystawiania'); actionCell.append(action);
      row.append(checkCell, text('td', id), nameCell, text('td', product.stock_quantity == null ? (stockKind(product) === 'available' ? 'Dostępny' : '—') : `${product.stock_quantity} szt.`), text('td', price), actionCell);
      get('products').append(row);
    }
    get('total').textContent = String(products.length); get('draft-count').textContent = String(products.filter(p => drafts.has(String(p.id))).length);
    get('results').textContent = busy ? 'Ładowanie produktów…' : `${Math.min(items.length, page * size)} z ${items.length} pozycji`;
    get('page-label').textContent = `${page} z ${pages}`;
    get<HTMLButtonElement>('prev').disabled = busy || page <= 1; get<HTMLButtonElement>('next').disabled = busy || page >= pages;
    get('empty').hidden = busy || items.length > 0;
    get('empty-title').textContent = loadFailed ? 'Nie udało się wczytać magazynu' : !store ? 'Wybierz magazyn produktów' : !products.length ? 'Ten magazyn jest pusty' : view === 'drafts' ? 'Brak szkiców dla tych filtrów' : 'Nie znaleziono produktów';
    get('empty-description').textContent = loadFailed ? 'Sprawdź komunikat powyżej i kliknij „Odśwież”. Błąd odczytu nie oznacza braku zaimportowanych produktów.' : !store ? 'Dodaj połączenie WooCommerce w Integracjach, aby przygotowywać oferty.' : !products.length ? (stores.length > 1 ? 'Wybierz inne połączenie w polu „Magazyn”. Produkty mogą być zapisane pod innym połączeniem tego samego sklepu.' : 'Zaimportuj produkty ze sklepu, a następnie wróć do wystawiania.') : 'Zmień filtry lub przygotuj nowy szkic z listy produktów.';
    get<HTMLAnchorElement>('empty-import').hidden = loadFailed || products.length > 0;
    updateSelection();
  }
  async function loadCatalog() {
    if (busy) return;
    busy = true; get<HTMLButtonElement>('refresh').disabled = true; get<HTMLSelectElement>('store').disabled = true;
    products = []; drafts.clear(); selected.clear(); page = 1; loadFailed = false; render(); feedback('Ładowanie produktów i zapisanych szkiców…');
    retryBatch = null; get('batch-report').hidden = true;
    try {
      if (!store) { feedback('Dodaj magazyn w zakładce Integracje.'); return; }
      const collected: Product[] = []; let offset = 0, total = 0;
      do {
        const result = await api(`/v1/admin/wordpress/stores/${encodeURIComponent(store.external_id)}/products?limit=100&offset=${offset}`);
        if (!Array.isArray(result.products)) throw new Error('Magazyn zwrócił nieprawidłową listę produktów.');
        total = Number(result.total) || 0;
        if (!result.products.length && offset < total) throw new Error('Nie udało się wczytać całego katalogu. Odśwież listę.');
        collected.push(...result.products); offset += result.products.length;
      } while (offset < total);
      const saved = await api(base());
      if (!Array.isArray(saved.drafts)) throw new Error('Nie udało się odczytać zapisanych szkiców.');
      products = collected; drafts = new Map(saved.drafts.map((draft: AllegroDraft) => [draft.productId, draft]));
      const categories = new Map<string, string>();
      for (const product of products) for (const category of product.categories || []) categories.set(String(category.id), String(category.name));
      const select = get<HTMLSelectElement>('category'); select.replaceChildren(new Option('Pokaż wszystkie produkty', ''));
      for (const [id, name] of [...categories].sort((a, b) => a[1].localeCompare(b[1], 'pl'))) select.add(new Option(name, id));
      feedback('');
    } catch (error) { loadFailed = true; root!.querySelector<HTMLDetailsElement>('.al-filter-panel')!.open = true; feedback(error instanceof Error ? error.message : 'Nie udało się wczytać danych.', true); }
    finally { busy = false; get<HTMLButtonElement>('refresh').disabled = false; get<HTMLSelectElement>('store').disabled = !stores.length; render(); }
  }
  function fromProduct(product: Product): AllegroDraft {
    return { productId: String(product.id), title: String(product.name || ''), price: String(product.price ?? ''), quantity: product.stock_quantity == null ? null : Number(product.stock_quantity),
      categoryId: '', ean: String(product.ean || product.global_unique_id || ''), description: String(product.description || product.short_description || ''),
      images: (product.images || []).map((image: Product) => image.url).filter((url: unknown) => typeof url === 'string' && /^https:\/\//i.test(url)).slice(0, 16),
      condition: '', shippingRatesId: '', returnPolicyId: '', warrantyId: '', handlingTime: '' };
  }
  async function runBatch(action: string, ids: string[]) {
    if (busy || !ids.length) return;
    if (action === 'edit') { openEditor(ids); return; }
    if (!['save', 'delete', 'check'].includes(action)) return;
    const existing = ids.filter(id => drafts.has(id)).length;
    if (action === 'delete' && existing && !window.confirm(`Usunąć zapisane szkice (${existing}) z Sellio? Produkty w magazynie pozostaną bez zmian.`)) return;
    busy = true; retryBatch = null; feedback('');
    const controls = Array.from(get('catalog').querySelectorAll<HTMLInputElement | HTMLButtonElement | HTMLSelectElement>('input,button,select')).filter(control => !control.disabled);
    controls.forEach(control => control.disabled = true);
    get('catalog').setAttribute('aria-busy', 'true');
    get('batch-report').hidden = false; get('retry-batch').hidden = true; get('batch-errors').replaceChildren();
    get('batch-report').querySelector<HTMLElement>('h3')!.focus();
    const progress = get<HTMLProgressElement>('batch-progress'); progress.max = ids.length; progress.value = 0;
    let success = 0, skipped = 0;
    const failed: string[] = [];
    const verb = action === 'save' ? 'Zapisano' : action === 'delete' ? 'Usunięto' : 'Poprawne podstawowe dane';
    const summary = () => `${verb}: ${success}. Pominięto: ${skipped}. ${action === 'check' ? 'Do poprawy' : 'Błędy'}: ${failed.length}. Przetworzono ${progress.value} z ${ids.length}.`;
    get('batch-summary').textContent = summary();
    try {
      for (const id of ids) {
        const product = products.find(item => String(item.id) === id);
        try {
          if (!product) throw new Error('Nie znaleziono produktu w magazynie.');
          if ((action === 'save' && drafts.has(id)) || (action === 'delete' && !drafts.has(id))) { skipped++; }
          else if (action === 'delete') {
            await api(`${base()}/${encodeURIComponent(id)}`, { method: 'DELETE' }); drafts.delete(id); success++;
          } else {
            const draft = normalizeDraft(drafts.get(id) || fromProduct(product));
            if (action === 'check') {
              const issues = draftIssues(draft);
              if (issues.length) throw new Error(`Do uzupełnienia: ${issues.join(', ')}.`);
            } else {
              const result = await api(`${base()}/${encodeURIComponent(id)}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(draft) });
              drafts.set(id, result.draft);
            }
            success++;
          }
        } catch (error) {
          failed.push(id);
          get('batch-errors').append(text('li', `${product?.name || id} (ID: ${id}): ${(error as Error).message}`));
        }
        progress.value++; get('batch-summary').textContent = summary();
      }
      const note = action === 'save' ? 'Istniejące szkice zachowano. Nowe szkice są dostępne w zakładce „Zapisane szkice”.' : action === 'delete' ? 'Usunięto wyłącznie szkice w Sellio.' : 'To kontrola podstawowych danych. Nie oznacza akceptacji oferty przez Allegro.';
      get('batch-summary').textContent = `${summary()} ${note}`;
      if (failed.length && action !== 'check') { retryBatch = { action, ids: failed }; get('retry-batch').hidden = false; }
    } finally {
      busy = false; controls.forEach(control => control.disabled = false); get('catalog').removeAttribute('aria-busy'); render();
    }
  }
  function openEditor(ids: string[]) {
    if (busy || !ids.length) return;
    editing = ids.map(id => structuredClone(drafts.get(id) || fromProduct(products.find(item => String(item.id) === id)!)));
    dirty = editing.some(draft => !drafts.has(draft.productId));
    get('save-state').textContent = dirty ? 'Niezapisane zmiany' : 'Wczytano zapisane szkice';
    get('catalog').hidden = true; get('editor').hidden = false;
    root!.querySelector('[data-step="catalog"]')!.removeAttribute('aria-current'); root!.querySelector('[data-step="editor"]')!.setAttribute('aria-current', 'step');
    get<HTMLFormElement>('bulk').reset(); root!.querySelectorAll<HTMLInputElement>('[data-common]').forEach(input => input.value = '');
    feedback(''); renderEditor(); document.getElementById('al-editor-title')!.focus();
  }
  function closeListingSettings() {
    get<HTMLDialogElement>('listing-settings').close();
    pendingEditorIds = [];
  }
  function openListingSettings(ids: string[]) {
    if (busy || !ids.length) return;
    pendingEditorIds = ids;
    get<HTMLDialogElement>('listing-settings').showModal();
  }
  function editorField(draft: AllegroDraft, key: keyof AllegroDraft, label: string, type = 'text', className = '') {
    const wrapper = text('label', label, className);
    const input = document.createElement(type === 'textarea' ? 'textarea' : 'input');
    if (input instanceof HTMLInputElement) { input.type = type; if (type === 'number') { input.min = '0'; input.step = '1'; } }
    else input.rows = key === 'description' ? 6 : 3;
    input.dataset.field = key; input.value = key === 'images' ? draft.images.join('\n') : String(draft[key] ?? '');
    input.addEventListener('input', () => {
      if (key === 'images') draft.images = input.value.split('\n').map(value => value.trim()).filter(Boolean);
      else if (key === 'quantity') draft.quantity = input.value === '' ? null : Number(input.value);
      else (draft as any)[key] = input.value;
      markDirty();
    }); wrapper.append(input); return wrapper;
  }
  function renderEditor() {
    const cards = get('offer-cards'); cards.replaceChildren(); get('editing-count').textContent = `Szkice: ${editing.length}`;
    for (const draft of editing) {
      const product = products.find(item => String(item.id) === draft.productId)!;
      const card = text('article', '', 'al-card al-offer'); card.dataset.productId = draft.productId;
      const heading = text('div', '', 'al-offer-heading');
      heading.append(identity(product), button('Usuń z formularza', () => {
        if (dirty && !window.confirm('Usunąć ten produkt z formularza? Niezapisane zmiany tego szkicu zostaną utracone.')) return;
        editing = editing.filter(item => item !== draft); renderEditor(); if (!editing.length) backToCatalog(true);
      }, 'al-link'));
      const grid = text('div', '', 'al-form-grid'); grid.append(editorField(draft, 'title', 'Tytuł oferty', 'text', 'al-wide'), editorField(draft, 'price', `Cena (${product.currency || 'PLN'})`), editorField(draft, 'quantity', 'Ilość do wystawienia', 'number'), editorField(draft, 'categoryId', 'ID kategorii Allegro'), editorField(draft, 'ean', 'EAN / GTIN'));
      const condition = text('label', 'Stan produktu'), select = document.createElement('select'); select.dataset.field = 'condition';
      for (const [value, label] of [['', 'Wybierz stan'], ['new', 'Nowy'], ['used', 'Używany'], ['refurbished', 'Odnowiony']]) select.add(new Option(label, value));
      select.value = draft.condition; select.addEventListener('change', () => { draft.condition = select.value; markDirty(); }); condition.append(select); grid.append(condition);
      const details = document.createElement('details'); details.append(text('summary', 'Opis, zdjęcia i ustawienia oferty'));
      const extra = text('div', '', 'al-form-grid');
      extra.append(editorField(draft, 'description', 'Opis produktu (tekst / HTML źródłowy)', 'textarea', 'al-full'), editorField(draft, 'images', 'Adresy zdjęć HTTPS — jeden w wierszu', 'textarea', 'al-full'));
      for (const [key, label] of [['shippingRatesId', 'Cennik wysyłki — ID'], ['returnPolicyId', 'Warunki zwrotów — ID'], ['warrantyId', 'Warunki reklamacji — ID'], ['handlingTime', 'Czas wysyłki (np. PT24H)']] as const) extra.append(editorField(draft, key, label));
      details.append(extra);
      const status = text('p', '', 'al-offer-feedback'); status.dataset.offerFeedback = ''; status.setAttribute('role', 'status');
      card.append(heading, grid, details, status); cards.append(card);
    }
  }
  function backToCatalog(force = false) {
    if (!force && dirty && !window.confirm('Wrócić do listy bez zapisania zmian? Zapisane wcześniej szkice pozostaną dostępne.')) return;
    dirty = false; get('catalog').hidden = false; get('editor').hidden = true; root!.querySelector('[data-step="editor"]')!.removeAttribute('aria-current'); root!.querySelector('[data-step="catalog"]')!.setAttribute('aria-current', 'step'); render(); get<HTMLButtonElement>('refresh').focus();
  }
  const cardFeedback = (index: number, message: string) => { get('offer-cards').children[index].querySelector<HTMLElement>('[data-offer-feedback]')!.textContent = message; };
  get('check').addEventListener('click', () => {
    editing.forEach((draft, index) => {
      try { const checked = normalizeDraft(draft), issues = draftIssues(checked); cardFeedback(index, issues.length ? `Do uzupełnienia: ${issues.join(', ')}.` : 'Podstawowe dane uzupełnione. Kategoria, parametry i zgodność oferty wymagają jeszcze weryfikacji w Allegro.'); }
      catch (error) { cardFeedback(index, (error as Error).message); }
    });
  });
  get('save').addEventListener('click', async () => {
    if (busy) return;
    let payloads: AllegroDraft[];
    try { payloads = editing.map(draft => normalizeDraft(draft)); }
    catch (error) { feedback((error as Error).message, true); get<HTMLButtonElement>('check').click(); return; }
    busy = true;
    // Freeze the form while saving so a completed response cannot mark newer edits as saved.
    const controls = Array.from(get('editor').querySelectorAll<HTMLInputElement | HTMLButtonElement | HTMLSelectElement | HTMLTextAreaElement>('input,button,select,textarea')).filter(control => !control.disabled);
    controls.forEach(control => control.disabled = true); get('save-state').textContent = 'Zapisywanie szkiców…';
    let saved = 0;
    try {
      for (const [index, draft] of payloads.entries()) {
        try { const result = await api(`${base()}/${encodeURIComponent(draft.productId)}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(draft) }); drafts.set(draft.productId, result.draft); Object.assign(editing[index], result.draft); saved++; cardFeedback(index, 'Szkic zapisany.'); }
        catch (error) { cardFeedback(index, `Nie zapisano: ${(error as Error).message}`); }
      }
      dirty = saved !== payloads.length;
      get('save-state').textContent = dirty ? `Zapisano ${saved} z ${payloads.length} szkiców. Ponów zapis pozostałych zmian.` : isLocalPreview() ? 'Zapisano w lokalnym podglądzie' : 'Wszystkie szkice zapisane na koncie';
      feedback(dirty ? 'Nie wszystkie szkice zostały zapisane. Szczegóły znajdują się przy produktach.' : 'Zapisano szkice. Możesz wrócić do nich po odświeżeniu strony.', dirty);
    } finally { busy = false; controls.forEach(control => control.disabled = false); }
  });
  get<HTMLFormElement>('bulk').addEventListener('submit', event => {
    event.preventDefault(); const data = new FormData(get<HTMLFormElement>('bulk'));
    const category = String(data.get('category') || ''), quantity = String(data.get('quantity') || ''), percent = String(data.get('percent') || ''), price = String(data.get('price') || ''), condition = String(data.get('condition') || '');
    if (!category && !quantity && !percent && !price && !condition) return;
    if (price && percent) { feedback('Wpisz cenę stałą albo zmianę procentową — wybierz jedno pole.', true); return; }
    try {
      const updated = editing.map(draft => {
        const next = structuredClone(draft);
        if (category) next.categoryId = category;
        if (quantity) next.quantity = Number(quantity);
        if (condition) next.condition = condition;
        if (price) next.price = Number(price).toFixed(2);
        if (percent) {
          if (!next.price || !Number.isFinite(Number(next.price.replace(',', '.')))) throw new Error('Uzupełnij ceny wszystkich szkiców przed zmianą procentową.');
          next.price = (Number(next.price.replace(',', '.')) * (1 + Number(percent) / 100)).toFixed(2);
        }
        return normalizeDraft(next);
      });
      editing = updated;
    } catch (error) { feedback((error as Error).message, true); return; }
    markDirty(); renderEditor(); feedback('Zastosowano zmiany w formularzu. Zapisz szkice, aby je zachować.');
  });
  get('apply-common').addEventListener('click', () => {
    root!.querySelectorAll<HTMLInputElement | HTMLSelectElement>('[data-common]').forEach(input => { if (input.value.trim()) for (const draft of editing) (draft as any)[input.dataset.common!] = input.value.trim(); });
    markDirty(); renderEditor(); feedback('Wspólne ustawienia zastosowane. Zapisz szkice, aby je zachować.');
  });
  get('back').addEventListener('click', () => backToCatalog());
  get('open-selected').addEventListener('click', () => openListingSettings([...selected]));
  get<HTMLFormElement>('listing-settings-form').addEventListener('submit', event => {
    event.preventDefault();
    const settings = Object.fromEntries(new FormData(event.currentTarget as HTMLFormElement).entries());
    localStorage.setItem('sellio-allegro-listing-settings-v1', JSON.stringify(settings));
    const ids = [...pendingEditorIds];
    get<HTMLDialogElement>('listing-settings').close(); pendingEditorIds = [];
    openEditor(ids);
  });
  for (const name of ['listing-settings-close', 'listing-settings-cancel']) get(name).addEventListener('click', closeListingSettings);
  get<HTMLDialogElement>('listing-settings').addEventListener('cancel', () => { pendingEditorIds = []; });
  try {
    const settings = JSON.parse(localStorage.getItem('sellio-allegro-listing-settings-v1') || '{}');
    for (const [name, value] of Object.entries(settings)) {
      const controls = root.querySelectorAll<HTMLInputElement | HTMLSelectElement>(`[data-listing-settings-form] [name="${CSS.escape(name)}"]`);
      for (const control of controls) {
        if (control instanceof HTMLInputElement) control.checked = control.value === value;
        else if (typeof value === 'string') control.value = value;
      }
    }
  } catch {}
  get('run-batch').addEventListener('click', () => void runBatch(field('batch-action').value, [...selected]));
  get('retry-batch').addEventListener('click', () => { if (retryBatch) void runBatch(retryBatch.action, [...retryBatch.ids]); });
  get('select-filtered').addEventListener('click', () => { for (const product of filtered()) selected.add(String(product.id)); render(); });
  get('clear-selection').addEventListener('click', () => { selected.clear(); render(); });
  get<HTMLInputElement>('select-page').addEventListener('change', event => { for (const product of visibleProducts()) { if ((event.target as HTMLInputElement).checked) selected.add(String(product.id)); else selected.delete(String(product.id)); } render(); });
  for (const name of ['search', 'category', 'stock', 'sort', 'page-size']) field(name).addEventListener(name === 'search' ? 'input' : 'change', () => { page = 1; render(); });
  get('reset').addEventListener('click', () => { for (const name of ['search', 'category', 'stock']) field(name).value = ''; page = 1; render(); });
  root.querySelectorAll<HTMLButtonElement>('[data-view]').forEach(tab => tab.addEventListener('click', () => { view = tab.dataset.view!; page = 1; root.querySelectorAll('[data-view]').forEach(item => item.setAttribute('aria-pressed', String(item === tab))); render(); }));
  get('prev').addEventListener('click', () => { page--; render(); }); get('next').addEventListener('click', () => { page++; render(); });
  get('refresh').addEventListener('click', () => { if (!stores.length) void initialize(); else void loadCatalog(); });
  field('store').addEventListener('change', () => { store = stores.find(item => item.id === field('store').value); void loadCatalog(); });
  window.addEventListener('beforeunload', event => { if (dirty || busy) { event.preventDefault(); event.returnValue = ''; } });
  async function initialize() {
    try {
      // Use the same connection as Products and Import/Export, not the first name match.
      const productStore = await loadWordpressStore();
      const response = await databaseFetch('stores?provider=eq.woocommerce&select=id,external_id,name,site_url,credentials,created_at&order=updated_at.desc');
      if (!response.ok) throw new Error('Nie udało się odczytać magazynów. Odśwież, aby spróbować ponownie.');
      const savedStores = await response.json() as WordpressStore[];
      const catalogs = new Map<string, WordpressStore>();
      for (const entry of savedStores) {
        const key = String(entry.site_url || entry.external_id).trim().replace(/\/$/, '').toLocaleLowerCase('pl');
        const current = catalogs.get(key);
        if (!current || entry.id === productStore?.id) catalogs.set(key, entry);
      }
      stores = [...catalogs.values()]; store = stores.find(entry => entry.id === productStore?.id) || stores[0];
      const select = get<HTMLSelectElement>('store'); select.replaceChildren();
      if (!stores.length) select.add(new Option('Brak połączonych magazynów', ''));
      for (const entry of stores) {
        const duplicateName = stores.filter(other => other.name === entry.name).length > 1;
        const date = entry.created_at ? new Date(entry.created_at) : null;
        const details = duplicateName ? ` · ${entry.site_url}${date && !Number.isNaN(date.getTime()) ? ` · ${date.toLocaleString('pl-PL')}` : ''}` : '';
        const source = entry.id === productStore?.id && stores.length > 1 ? ' · katalog z zakładki Produkty' : '';
        select.add(new Option(`WooCommerce · ${entry.name}${details}${source}`, entry.id));
      }
      select.value = store?.id || '';
      await loadCatalog();
    } catch (error) { loadFailed = true; feedback((error as Error).message, true); get<HTMLSelectElement>('store').replaceChildren(new Option('Nie udało się pobrać magazynów', '')); render(); }
  }
  void initialize();
  void authenticatedFetch('/v1/admin/allegro/status').then(async response => {
    if (!response.ok) throw new Error('Status unavailable');
    const status = await response.json();
    const label = status.connected && status.account ? `${status.account.login}${status.reconnect ? ' — odnów połączenie' : ' · Allegro.pl'}` : 'Połącz konto w Integracjach';
    get<HTMLSelectElement>('allegro-account-select').replaceChildren(new Option(label, status.account?.id || ''));
  }).catch(() => get<HTMLSelectElement>('allegro-account-select').replaceChildren(new Option('Sprawdź połączenie w Integracjach', '')));
}

import { createHash } from 'node:crypto';
import { draftIssues, type AllegroDraft } from '../../src/lib/allegro-drafts.ts';
import { AllegroError, AllegroOAuth } from './allegro-oauth.ts';

type AllegroApiError = { code?: string; message?: string; userMessage?: string; path?: string };

function plainText(value: string) {
  return value.replace(/<br\s*\/?>/gi, '\n').replace(/<\/p>/gi, '\n').replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ').replace(/&amp;/gi, '&').replace(/&lt;/gi, '<').replace(/&gt;/gi, '>')
    .replace(/[ \t]+/g, ' ').replace(/\n\s+/g, '\n').trim();
}
function html(value: string) {
  const escaped = plainText(value).slice(0, 36000).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  return escaped.split(/\n+/).map(line => line.trim()).filter(Boolean).map(line => `<p>${line}</p>`).join('');
}
function condition(value: string) { return value === 'used' ? 'Używany' : value === 'refurbished' ? 'Odnowiony' : 'Nowy'; }

export function offerPayload(draft: AllegroDraft, ownerId: string, storeId: string) {
  const missing = draftIssues(draft);
  if (missing.length) throw new AllegroError(`Uzupełnij przed publikacją: ${missing.join(', ')}.`, 400);
  if (!draft.shippingRatesId || !draft.returnPolicyId || !draft.warrantyId || !draft.handlingTime) {
    throw new AllegroError('Uzupełnij cennik dostawy, warunki zwrotów, reklamacji i czas wysyłki.', 400);
  }
  const product: Record<string, unknown> = draft.ean
    ? { id: draft.ean, idType: 'GTIN', category: { id: draft.categoryId }, parameters: [{ name: 'Stan', values: [condition(draft.condition)] }] }
    : { name: draft.title.slice(0, 75), category: { id: draft.categoryId }, images: draft.images, parameters: [{ name: 'Stan', values: [condition(draft.condition)] }] };
  return {
    name: draft.title.slice(0, 75),
    productSet: [{ product, quantity: { value: 1 } }],
    images: draft.images,
    description: { sections: [{ items: [{ type: 'TEXT', content: html(draft.description) }] }] },
    sellingMode: { format: 'BUY_NOW', price: { amount: Number(draft.price).toFixed(2), currency: 'PLN' } },
    stock: { available: draft.quantity, unit: 'UNIT' },
    delivery: { handlingTime: draft.handlingTime, shippingRates: { id: draft.shippingRatesId } },
    afterSalesServices: { returnPolicy: { id: draft.returnPolicyId }, impliedWarranty: { id: draft.warrantyId } },
    publication: { status: 'ACTIVE' },
    external: { id: createHash('sha256').update(`${ownerId}:${storeId}:${draft.productId}`).digest('hex').slice(0, 32) }
  };
}

export async function publishOffer(service: AllegroOAuth, userId: string, storeId: string, draft: AllegroDraft) {
  const response = await service.api(userId, '/sale/product-offers', { method: 'POST', body: JSON.stringify(offerPayload(draft, userId, storeId)) });
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    const errors: AllegroApiError[] = Array.isArray(data?.errors) ? data.errors : [];
    const details = errors.slice(0, 5).map(item => item.userMessage || item.message || item.code).filter(Boolean).join(' ');
    throw new AllegroError(details || `Allegro odrzuciło ofertę (HTTP ${response.status}).`, response.status === 400 || response.status === 422 ? 400 : response.status === 403 ? 403 : 502, 'profile_rejected', response.status);
  }
  if (!data || typeof data.id !== 'string') throw new AllegroError('Allegro utworzyło ofertę, ale zwróciło nieprawidłową odpowiedź. Sprawdź konto przed ponowieniem.', 502);
  return { offerId: data.id, status: typeof data.publication?.status === 'string' ? data.publication.status : 'PROCESSING', createdAt: new Date().toISOString() };
}

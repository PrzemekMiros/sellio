/** Preparation data, never a claim that Allegro has accepted an offer. */
export type AllegroDraft = {
  productId: string; title: string; price: string; quantity: number | null;
  categoryId: string; ean: string; description: string; images: string[];
  condition: string; shippingRatesId: string; returnPolicyId: string;
  warrantyId: string; handlingTime: string; updatedAt?: string;
};
export function normalizeDraft(value: unknown): AllegroDraft {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Nieprawidłowy szkic.');
  const input = value as Record<string, unknown>;
  const text = (key: string, max: number) => {
    if (typeof input[key] !== 'string' || (input[key] as string).length > max) throw new Error(`Nieprawidłowe pole: ${key}.`);
    return (input[key] as string).trim();
  };
  const productId = text('productId', 100);
  if (!/^[\w-]+$/.test(productId)) throw new Error('Nieprawidłowy identyfikator produktu.');
  const price = text('price', 30).replace(',', '.');
  if (price && (!/^\d+(\.\d{1,2})?$/.test(price) || Number(price) > 999999999)) throw new Error('Cena musi być liczbą nieujemną z maksymalnie dwoma miejscami po przecinku.');
  const quantity = input.quantity;
  if (quantity !== null && (typeof quantity !== 'number' || !Number.isSafeInteger(quantity) || quantity < 0)) throw new Error('Ilość musi być liczbą całkowitą nie mniejszą od zera.');
  if (!Array.isArray(input.images) || input.images.length > 16 || input.images.some(item => typeof item !== 'string' || item.length > 2000 || !/^https:\/\//i.test(item))) throw new Error('Podaj maksymalnie 16 adresów zdjęć HTTPS.');
  const categoryId = text('categoryId', 30);
  if (categoryId && !/^\d+$/.test(categoryId)) throw new Error('ID kategorii powinno zawierać tylko cyfry.');
  const condition = text('condition', 30);
  if (!['', 'new', 'used', 'refurbished'].includes(condition)) throw new Error('Nieprawidłowy stan produktu.');
  return { productId, title: text('title', 200), price, quantity: quantity as number | null, categoryId,
    ean: text('ean', 50), description: text('description', 50000), images: input.images as string[], condition,
    shippingRatesId: text('shippingRatesId', 100), returnPolicyId: text('returnPolicyId', 100), warrantyId: text('warrantyId', 100), handlingTime: text('handlingTime', 30) };
}
export function draftIssues(draft: AllegroDraft): string[] {
  const issues: string[] = [];
  if (!draft.title.trim()) issues.push('tytuł');
  if (!(Number(draft.price) > 0)) issues.push('cena');
  if (!(draft.quantity !== null && draft.quantity > 0)) issues.push('ilość');
  if (!draft.categoryId) issues.push('kategoria');
  if (!draft.images.length) issues.push('zdjęcia');
  if (!draft.description.trim()) issues.push('opis');
  return issues;
}

import assert from 'node:assert/strict';
import test from 'node:test';
import { offerPayload } from '../netlify/lib/allegro-offers.ts';

const draft = {
  productId: 'wc-42', title: 'Lampa robocza LED 12V', price: '149.9', quantity: 3,
  categoryId: '12345', ean: '5901234567890', description: '<p>Mocna & trwała</p>\nDruga linia',
  images: ['https://example.com/lampa.jpg'], condition: 'new', shippingRatesId: 'shipping-1',
  returnPolicyId: 'return-1', warrantyId: 'warranty-1', handlingTime: 'PT24H'
};

test('builds an active Allegro product offer without leaking local identifiers', () => {
  const payload: any = offerPayload(draft, 'owner-secret', 'store-secret');
  assert.equal(payload.publication.status, 'ACTIVE');
  assert.equal(payload.sellingMode.price.amount, '149.90');
  assert.equal(payload.productSet[0].product.idType, 'GTIN');
  assert.equal(payload.productSet[0].product.id, draft.ean);
  assert.match(payload.description.sections[0].items[0].content, /^<p>.*<\/p><p>.*<\/p>$/);
  assert.doesNotMatch(JSON.stringify(payload), /owner-secret|store-secret/);
});

test('requires delivery and after-sales settings before publication', () => {
  assert.throws(() => offerPayload({ ...draft, shippingRatesId: '' }, 'owner', 'store'), /cennik dostawy/);
});

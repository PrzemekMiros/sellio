# Sellio Connector

Wtyczka MVP dla WooCommerce 8+ / WordPress 6.4+ / PHP 7.4+. Testowana statycznie z PHP 8.2; WP-CLI i PHPUnit nie są dostępne w dostarczonym środowisku. Kompatybilność HPOS jest deklarowana: zamówienia są zawsze pobierane przez CRUD WooCommerce.

## Konfiguracja

W WooCommerce → Sellio Connector podaj HTTPS API, ID sklepu oraz token. Token jest maskowany; w bazie jest zaszyfrowany AES-256-GCM przy użyciu klucza bazującego na WordPress salts. Zalecane jest ustawienie tokenu poza bazą: `define('SELLIO_CONNECTOR_API_TOKEN', '...');`. Dla niezależnej rotacji szyfrowania dodaj tajny `SELLIO_CONNECTOR_ENCRYPTION_KEY` do `wp-config.php`; po zmianie klucza zapisz token ponownie. HTTP dla `localhost` działa wyłącznie z `define('SELLIO_CONNECTOR_ALLOW_INSECURE_LOCALHOST', true);` w środowisku deweloperskim.

Token katalogu jest oddzielny, pokazywany tylko bezpośrednio po wygenerowaniu i przechowywany wyłącznie jako SHA-256. Przekazuj go nagłówkiem `X-Sellio-Catalog-Token`.

Przetwarzanie wymaga działającego WP-Cron/Action Scheduler. Kolejka ma maksymalnie 8 prób z exponential backoff, jitterem i `Retry-After`; 401/403 oraz błędny payload zatrzymują automatyczne próby. Dezaktywacja zatrzymuje akcje i zostawia dane. Rozłączenie unieważnia dostęp katalogu i anuluje otwarte zdarzenia. Wtyczka nie usuwa danych WooCommerce. Outbox należy okresowo retencjonować po akceptacji polityki biznesowej (nieudane zdarzenia zachowuj do ręcznej decyzji).

Pełna synchronizacja katalogu: pobierz wszystkie strony rosnąco po ID, następnie porównaj kompletny zbiór ID (to wykrywa usunięcia). Przyrostowa: `modified_after` + deterministyczna paginacja; podczas długiej paginacji ustal watermark i powtórz końcowe okno, bo zmiany równoległe mogą przeskoczyć między stronami. Odbiorca zdarzeń powinien używać `event_id` i wersji snapshotu/`modified_at`, nie samego czasu z dokładnością sekundy.

Nie obsługujemy refundacji ani usuniętych zamówień jako zdarzeń; nie wysyłamy metadanych, kluczy zamówień, kart ani sekretów.

## Test ręczny

`node mock/sellio-mock.js`, ustaw localhostową stałą, skonfiguruj adres `http://localhost:8787` i token `test-token`. Sprawdź połączenie, utwórz testowe zamówienie w instalacji deweloperskiej oraz wywołaj katalog:

```sh
curl -H "X-Sellio-Catalog-Token: <TOKEN_KATALOGU>" "https://shop.example/wp-json/sellio/v1/products?per_page=50"
curl -H "Authorization: Bearer <TOKEN_SELLIO>" -H "X-Sellio-Store-Id: <ID_SKLEPU>" https://api.sellio.example/v1/connector/connection
```

Backend Sellio musi jeszcze zapewnić trwałą deduplikację `event_id`, walidację kontraktu, chronioną rejestrację sklepu poza wtyczką, kolejkę konsumenta, obserwowalność oraz polityki retencji/RODO.

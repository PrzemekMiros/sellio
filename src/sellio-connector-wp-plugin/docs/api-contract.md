# Kontrakt Sellio Connector v1

## Wtyczka → Sellio

`GET /v1/connector/connection`: nagłówki `Authorization: Bearer <sekret>`, `X-Sellio-Store-Id`. Prawidłowa odpowiedź: `{"service":"sellio","api_version":"1","store_id":"store_123","status":"connected"}`. Inna odpowiedź, także HTTP 200, jest błędem.

`POST /v1/connector/events`: te same nagłówki plus `Idempotency-Key`. Tylko 200/202 oraz `{"accepted":true,"event_id":"<identyczny UUID>"}` oznaczają sukces. Sellio musi oddawać identyczną odpowiedź dla ponownego dostarczenia tego samego eventu.

Przykład: `{"schema_version":"1","event_id":"uuid","event_type":"order.created","occurred_at":"2026-01-01T00:00:00+00:00","store_id":"store_123","data":{"id":"123","currency":"PLN","total":"10.00","items":[]}}`.

## Sellio → wtyczka

Wymagany jest `X-Sellio-Catalog-Token`: `GET /wp-json/sellio/v1/connection`, `/products?page=1&per_page=50&modified_after=<ISO8601>`, `/products/{id}`, `/products/{id}/variations`. Maksymalny `per_page` to 100. Brak tokenu oznacza 401/403 i nie daje dostępu do żadnego standardowego REST API WordPressa.

Kwoty są stringami; `null` różni się od `"0"`. Katalog nie kopiuje obrazów, tylko przekazuje URL. Typy inne niż simple/variable/variation mają `supported:false`.

# Sellio — panel sprzedaży

Panel Astro oraz backend integracyjny dla WooCommerce/Sellio. Wtyczka WordPress znajduje się w `src/sellio-connector-wp-plugin`.

## Uruchomienie integracji WooCommerce

1. Wygeneruj dwa sekrety: 32 losowe bajty zapisane w Base64 dla `TOKEN_ENCRYPTION_KEY` oraz długi losowy ciąg dla `BACKEND_ADMIN_KEY`.
2. Ustaw zmienne środowiskowe i uruchom backend:

```powershell
$bytes = New-Object byte[] 32; [Security.Cryptography.RandomNumberGenerator]::Fill($bytes)
$env:TOKEN_ENCRYPTION_KEY = [Convert]::ToBase64String($bytes)
$env:BACKEND_ADMIN_KEY = 'wstaw-tu-dlugi-losowy-sekret-minimum-32-znaki'
$env:BACKEND_PORT = '4322'
$env:ADMIN_ORIGIN = 'http://localhost:4321'
npm run backend
```

`BACKEND_DB` jest opcjonalne (domyślnie `data/allegro-sandbox.sqlite`). W środowisku produkcyjnym ustaw HTTPS dla backendu oraz dokładny adres panelu w `ADMIN_ORIGIN`. Backend obsługuje także standardową zmienną `PORT` przekazywaną przez hosting.

3. Uruchom panel (`npm run dev`) i wejdź w **Integracje**. Podaj adres backendu, klucz administratora oraz adres sklepu. Formularz wygeneruje `API Sellio`, `ID sklepu` i `Token API`.
4. Skopiuj katalog `src/sellio-connector-wp-plugin` do `wp-content/plugins/`, aktywuj wtyczkę, a następnie w **WooCommerce → Sellio Connector** wklej trzy wartości. Zapisz i wybierz **Sprawdź połączenie**.
5. Jeżeli Sellio ma pobierać katalog produktów, w panelu wtyczki wygeneruj token katalogu i zapisz go w sekcji opcjonalnej formularza integracji.

Backend udostępnia dokładnie kontrakt wymagany przez wtyczkę: `GET /v1/connector/connection` oraz idempotentne `POST /v1/connector/events`. Zdarzenia WooCommerce są trwałe w lokalnej bazie SQLite.

> Formularz administracyjny jest narzędziem konfiguracji dla zaufanego panelu. Przed publikacją nie wystawiaj `BACKEND_ADMIN_KEY` w otwartym internecie: umieść panel i backend za logowaniem albo zastąp nagłówek sesją użytkownika po stronie serwera.

## Render

Repozytorium zawiera `render.yaml`. W Render wybierz **New → Blueprint**, wskaż to repozytorium i utwórz usługę `sellio-backend`. Render odczyta polecenia budowania, endpoint kontroli zdrowia i trwały dysk SQLite z pliku. W formularzu wdrożenia podaj tylko wartości oznaczone jako sekretne: `BACKEND_ADMIN_KEY` i `TOKEN_ENCRYPTION_KEY`. Po wdrożeniu skopiuj publiczny adres usługi `https://…onrender.com` do pola „Adres backendu” w panelu Sellio.

## Uruchomienie

Wymagania Astro: Node.js ≥ 22.23.4 i npm ≥ 9.6.5. Lokalnie użyto Node.js 26.13.0; npm 9.5.1 zgłasza ostrzeżenie o wersji, ale instalacja i kompilacja działają.

```sh
npm install
npm run dev
```

Panel: http://localhost:4321/admin

Landing page: http://localhost:4321/ — strona prezentująca aplikację i prowadząca do panelu.

## Kontrole

```sh
npm run check
npm run build
npx playwright test
```

Testy przeglądarkowe wymagają Chromium (`npx playwright install chromium`). Sprawdzają wszystkie pozycje nowego menu i zachowane starsze adresy, odświeżanie, aktywne menu, pusty pulpit, brak aktywnych funkcji modułów, rozwijanie podmenu klawiaturą, mobilną nawigację oraz brak poziomego przepełnienia w pięciu szerokościach. Projekt nie ma osobnej konfiguracji lint.

## Struktura

- `src/config/modules.ts` — wspólna konfiguracja nazw, adresów, ikon i opisów.
- `src/config/site.ts` — nazwa produktu i nawigacja landingu.
- `src/components/landing/` — sekcje strony głównej i statyczne wizualizacje interfejsu, oznaczone jako demo.
- `src/styles/landing.css` — niezależny motyw landingu: ciemne sekcje, pomarańczowy akcent i jasna siatka modułów.
- `src/layouts/AdminLayout.astro` — wspólny układ i dostępne menu mobilne.
- `src/components/SidebarNav.astro` — menu z rozwijanymi grupami i automatycznym otwarciem aktywnej gałęzi.
- `src/pages/admin/[...slug].astro` — statycznie generowane adresy i pulpit.
- `src/components/ModulePage.astro` — wspólny ekran modułów w przygotowaniu.
- `src/styles/global.css` — responsywne style, lokalne fonty systemowe.

`npm run build` generuje statyczny katalog `dist`. Hosting powinien obsługiwać pliki `index.html` w podkatalogach. Lokalny podgląd kompilacji: `npm run preview`.

# Sellio — panel sprzedaży

Panel Astro oraz backend integracyjny dla WooCommerce/Sellio. Wtyczka WordPress znajduje się w `src/sellio-connector-wp-plugin`.

## AlSellio — integracja Allegro API

Nazwa aplikacji zarejestrowanej w Allegro: **AlSellio**, wersja identyfikatora aplikacji: **1.0**. Panel działa pod adresem https://allsellio.netlify.app/. Kontakt dotyczący działania i weryfikacji aplikacji: **kontakt@przemekmiros.pl**.

Sellio służy do obsługi sprzedaży internetowej, łącząc katalog sklepu z przygotowaniem ofert marketplace. Integracja Allegro jest w fazie testów. Jest przeznaczona dla sprzedawców korzystających z Sellio; każdy użytkownik autoryzuje własne konto. Obecnie jeden użytkownik Sellio może zapisać jedno połączenie Allegro.

### Dostępne funkcje i ograniczenia

- Autoryzacja konta Allegro przez OAuth Authorization Code z PKCE S256.
- Weryfikacja identyfikatora i loginu sprzedawcy przez `GET https://api.allegro.pl/me`.
- Trwały zapis połączenia, automatyczne odnawianie tokenów i odłączenie konta.
- Przygotowywanie szkiców ofert w Sellio na podstawie katalogu produktów.
- Import ofert i zamówień, publikacja szkiców oraz synchronizacja cen i stanów z Allegro są **planowane** i nie są jeszcze dostępne do testowania. Połączenie konta nie publikuje ofert.

### Uprawnienia API

Obecna autoryzacja prosi wyłącznie o `allegro:api:profile:read` (odczyt danych konta). Pozostałe zakresy poniżej są planowane i nie są teraz żądane. Wdrożenie tych funkcji będzie wymagało rozszerzenia uprawnień aplikacji oraz ponownej zgody użytkownika.

| Scope | Funkcja i wykorzystanie |
| --- | --- |
| `allegro:api:profile:read` | Weryfikacja połączenia: odczyt identyfikatora i loginu konta przez `GET /me`. |
| `allegro:api:sale:offers:read` | Planowany import danych ofert sprzedawcy; obecnie nie jest wykonywany. |
| `allegro:api:sale:offers:write` | Planowane publikowanie i edycja ofert, cen i stanów; obecnie nie są wykonywane. |
| `allegro:api:sale:settings:read` | Planowany odczyt cenników dostaw i warunków sprzedaży do formularza ofert; obecnie nie jest wykonywany. |
| `allegro:api:orders:read` | Planowany import zamówień do obsługi sprzedaży; obecnie nie jest wykonywany. |

### Dostęp, połączenie i scenariusz weryfikacji

Do testu wymagane są konto Sellio, konto Allegro i skonfigurowana aplikacja API na serwerze Sellio. Dostęp testowy uzgodnij przez **kontakt@przemekmiros.pl**. Aktywne oferty ani zamówienia nie są potrzebne do testu połączenia.

1. Zaloguj się na https://allsellio.netlify.app/logowanie/.
2. Otwórz https://allsellio.netlify.app/admin/integracje/#allegro-connection i wybierz **Połącz konto Allegro**.
3. Zaloguj się na stronie Allegro i zaakceptuj uprawnienia. Hasło do Allegro podajesz wyłącznie w Allegro. Powrót prowadzi do `https://allsellio.netlify.app/api/allegro/callback`.
4. Po powrocie do Sellio sprawdź login konta. Kliknij **Sprawdź połączenie**, aby wykonać `GET /me` i zobaczyć wynik.
5. Odśwież stronę i potwierdź, że połączenie pozostało zapisane.
6. Kliknij **Odłącz od Sellio**, potwierdź i sprawdź, że panel pokazuje brak połączenia. Nie usuwa to ofert na Allegro.

### Bezpieczeństwo i dane

Panel wymaga sesji użytkownika Supabase. Dane i autoryzacje różnych użytkowników są rozdzielone. Tokeny Allegro oraz dane przepływu OAuth są przechowywane po stronie serwera w Netlify Blobs z szyfrowaniem AES-256-GCM i identyfikatorem użytkownika jako AAD. Tokeny Allegro nie trafiają do przeglądarki ani do localStorage. OAuth wykorzystuje jednorazowy state, PKCE i cookie Secure/HttpOnly/SameSite=Lax. Odnowienie tokenów odbywa się podczas weryfikacji połączenia i przez zadanie okresowe. Cofnięcie zgody wymaga ponownego połączenia.

Odłączenie usuwa zapisane dane dostępowe z Sellio. Użytkownik może także cofnąć zgodę w ustawieniach powiązanych aplikacji Allegro.

Publiczna dokumentacja: https://allsellio.netlify.app/integracja-allegro/. Konfigurację serwera opisuje [docs/allegro-setup.md](docs/allegro-setup.md).

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

## Netlify

Panel i endpointy integracji mogą działać na tej samej stronie Netlify. Katalog `netlify/functions` zawiera funkcje dla `/v1/connector/*` oraz `/v1/admin/*`, a trwałe dane połączeń i zdarzeń są przechowywane w site-wide Netlify Blobs.

W Netlify ustaw `PUBLIC_SUPABASE_URL` oraz `PUBLIC_SUPABASE_PUBLISHABLE_KEY` dla **Builds i Functions**, a następnie uruchom ponowne wdrożenie. Panel i funkcje administracyjne używają sesji użytkownika Supabase; `BACKEND_ADMIN_KEY` dotyczy osobnego backendu lokalnego. W panelu wpisz `https://allsellio.netlify.app` jako adres backendu.

Sesja jest trwale zapisywana w przeglądarce i automatycznie odnawiana przez klienta Supabase. Istniejące sesje poprzedniego formularza logowania są zachowane, jeśli ich refresh token nadal jest ważny. Po HTTP 401 panel odnawia sesję i ponawia żądanie jeden raz. Cofnięta sesja wymaga logowania; awaria sieci nie usuwa danych integracji.

Połączenia i zasady synchronizacji są zapisywane w tabeli `stores` w Supabase z ograniczeniem dostępu do organizacji. Nowe połączenie jest potwierdzane dopiero po zapisie w bazie. Jeśli wcześniejszy zapis z przeglądarki nie doszedł do skutku, panel przywraca rejestr połączeń należących do zalogowanego użytkownika z trwałego magazynu Netlify. Tokeny katalogu, produkty i zdarzenia pozostają w trwałym Netlify Blobs. Import może korzystać z zapisanego tokenu bez ponownego wklejania. Nowa migracja schematu nie jest wymagana; muszą być zastosowane obie istniejące migracje z `supabase/migrations`.

## Supabase

Schemat dla użytkowników, firm, produktów WooCommerce, ofert Allegro i historii synchronizacji znajduje się w `supabase/migrations/20261124192000_initial_schema.sql`. Wklej go w **Supabase → SQL Editor → New query** i uruchom.

W Netlify dodaj zmienne środowiskowe dostępne podczas budowania strony: `PUBLIC_SUPABASE_URL` oraz `PUBLIC_SUPABASE_PUBLISHABLE_KEY`. Ich wzór jest w `.env.example`. Klucz `sb_secret_…` nigdy nie może trafić do kodu klienckiego ani do repozytorium.

W Supabase ustaw w **Authentication → URL Configuration** adres strony jako `Site URL` oraz dodaj `https://allsellio.netlify.app/logowanie` do listy `Redirect URLs`. Aby włączyć logowanie Google, w **Authentication → Providers → Google** dodaj dane OAuth utworzone w Google Cloud Console.

## Uruchomienie

Wymagania Astro: Node.js ≥ 22.23.4 i npm ≥ 9.6.5. Lokalnie użyto Node.js 26.13.0; npm 9.5.1 zgłasza ostrzeżenie o wersji, ale instalacja i kompilacja działają.

```sh
npm install
npm run dev
```

Panel: http://localhost:4321/admin

Przy `npm run dev` panel na `localhost`, `127.0.0.1` lub `[::1]` otwiera się bez logowania jako **Podgląd lokalny**. Udostępnia osobny produkt testowy do sprawdzania edytora. Zmiany produktu i ustawień są zapisywane wyłącznie w przeglądarce pod kluczem `sellio-local-preview-v1`; rzeczywista sesja i dane Supabase pozostają oddzielone. Podgląd nie wysyła żądań integracyjnych do prawdziwego backendu. „Zakończ podgląd” wraca na stronę główną.

Aby lokalnie sprawdzić prawdziwe logowanie, ustaw `PUBLIC_LOCAL_PREVIEW=false` w `.env.local` i uruchom ponownie serwer. `npm run build` zawsze usuwa tryb podglądu — również przy `PUBLIC_LOCAL_PREVIEW=true` oraz podczas oglądania builda na localhost przez `npm run preview`. Funkcje Netlify i ich kontrola dostępu pozostają bez zmian.

Landing page: http://localhost:4321/ — strona prezentująca aplikację i prowadząca do panelu.

## Kontrole

```sh
npm run check
npm run build
npx playwright test
npm run test:auth
npm run test:admin-api
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

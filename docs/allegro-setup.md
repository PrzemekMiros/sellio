# Połączenie Sellio z Allegro (produkcja)

Konto sprzedawcy i aplikacja API to osobne elementy. Właściciel Sellio rejestruje jedną aplikację na https://apps.developer.allegro.pl/. Sprzedawcy korzystają potem z przycisku „Połącz konto Allegro”; nie podają kluczy aplikacji w panelu Sellio.

## Konfiguracja aplikacji przez właściciela Sellio

1. Zarejestruj aplikację webową Sellio korzystającą z Authorization Code flow.
2. Ustaw dokładny Redirect URI: `https://allsellio.netlify.app/api/allegro/callback` (bez końcowego ukośnika).
3. Włącz zakresy `allegro:api:profile:read`, `allegro:api:sale:offers:read`, `allegro:api:sale:offers:write` oraz `allegro:api:sale:settings:read`. Istniejące połączenia trzeba autoryzować ponownie, aby publikowanie ofert otrzymało nowe uprawnienia. Po błędzie `invalid_scope` sprawdź, czy wszystkie zakresy zapisano w produkcyjnej aplikacji AlSellio, której Client ID jest ustawiony w Netlify.
4. W Netlify → allsellio → Environment variables dodaj `ALLEGRO_CLIENT_ID` i `ALLEGRO_CLIENT_SECRET`. Ustaw kontekst Production i oznacz sekret jako secret. Jeśli plan pozwala, ogranicz zakres do Functions; w planie bez wyboru zakresów pozostaw domyślne zakresy dla sekretów. Nie wklejaj sekretu do czatu ani plików repozytorium.
5. `ALLEGRO_TOKEN_ENCRYPTION_KEY` musi zawierać 32 losowe bajty w Base64. Sprawdź, czy został już skonfigurowany, zanim wygenerujesz nowy. Nie zastępuj istniejącego klucza: służy do odszyfrowania zapisanych połączeń.
6. Wdróż ponownie funkcje Netlify, aby dostały nowe zmienne środowiskowe.
7. Zaloguj się do Sellio, otwórz Integracje → Połączenie z Allegro, kliknij „Połącz konto Allegro” i zaakceptuj zgodę na stronie Allegro.
8. Po powrocie sprawdź login konta oraz przycisk „Sprawdź połączenie”. Odśwież stronę, aby potwierdzić trwałość połączenia.

## Działanie i zakres

### Wymagany User-Agent

Przed połączeniem konta uzupełnij `PUBLIC_ALLEGRO_CONTACT_EMAIL` prawdziwym adresem kontaktowym właściciela i opublikuj stronę `https://allsellio.netlify.app/integracja-allegro/`. Zawiera ona opis funkcji, uprawnień, bezpieczeństwa i scenariusz weryfikacji; bez kontaktu wyświetla informację o nieukończonej dokumentacji.

Właściciel zarejestrował aplikację `AlSellio` i wygenerował identyfikator `AlSellio/1.0 (+https://github.com/PrzemekMiros/sellio/blob/main/README.md)`. Zapisz go dokładnie w zmiennej serwerowej Netlify `ALLEGRO_USER_AGENT` (Production, dostępnej dla Functions). Nie dopisuj prefiksu `User-Agent:` ani nie zmieniaj adresu dokumentacji. README pod podanym adresem musi zawierać aktualny opis integracji i kontakt; publiczna strona Sellio jest dodatkową kopią dokumentacji. Następnie wdróż funkcje ponownie. Brak nagłówka blokuje rozpoczęcie OAuth. Nagłówek trafia do każdego zapytania REST API Allegro, obecnie `GET /me`.

Wymagania Allegro: https://developer.allegro.pl/tutorials/informacje-podstawowe-b21569boAI1#user-agent

- Dane są przypisane do użytkownika Sellio. Jedno konto Allegro na użytkownika; ponowna autoryzacja zastępuje je dopiero po udanym zapisie.
- Tokeny i dane przepływu są szyfrowane AES-256-GCM, z identyfikatorem użytkownika jako AAD, w trwałym magazynie Netlify Blobs `sellio-allegro`. Nie trafiają do klienta ani localStorage.
- Publikacja korzysta z `POST /sale/product-offers`. Przed wysłaniem Sellio zapisuje blokadę publikacji przypisaną do użytkownika, magazynu i produktu. Przy niepewnym wyniku połączenia nie ponawia automatycznie żądania, ponieważ ponowny POST mógłby utworzyć duplikat.
- OAuth stosuje PKCE S256, losowy state, jednorazowe wykorzystanie state oraz cookie Secure/HttpOnly/SameSite=Lax. Sesja łączenia jest ważna 10 minut.
- Wymiana kodu z PKCE wysyła `client_id` i `code_verifier` w formularzu, bez nagłówka Basic, zgodnie z aktualnym poradnikiem Allegro. Odświeżanie tokenów nadal używa Basic z Client ID i Client Secret.
- Błędy powrotu OAuth pokazują bezpieczny kod przyczyny i losowy identyfikator diagnostyczny. Log funkcji `allegro-callback` zawiera tylko te wartości i status HTTP; nie zapisuje kodów autoryzacji, tokenów, cookies, treści błędów dostawcy ani danych konta.
- Odnowienie dostępu następuje przy sprawdzaniu połączenia oraz przez zadanie Netlify `allegro-maintenance` co 6 godzin. Cofnięta zgoda wymaga ponownej autoryzacji. Nie obiecujemy bezterminowego dostępu po zmianie hasła czy cofnięciu zgody w Allegro.
- Warunkowe zapisy ETag chronią przed równoczesnym odświeżaniem tokenów i przywróceniem połączenia po jego odłączeniu.
- Odłączenie usuwa dane dostępowe z Sellio. Zgodę po stronie Allegro użytkownik może dodatkowo cofnąć w „Powiązanych aplikacjach”.
- Obecnie działa autoryzacja i weryfikacja konta. Pobieranie ofert/zamówień i publikowanie szkiców są osobnymi etapami integracji; samo połączenie nie uruchamia żadnej sprzedaży.

## Wdrożenie i testy

`npm run test:allegro`, `npm run test:admin-api`, `npm run test:auth`, `npm run check`, `npm run build`.

Netlify maskuje sekrety dla buildów lokalnych. Buduj na Netlify albo dostarcz poprawne publiczne ustawienia Supabase lokalnie przed `npm run build` i użyj `netlify deploy --no-build`. Przed publikacją potwierdź, że bundle nie zawiera zamaskowanych wartości. Sekrety Allegro są potrzebne wyłącznie funkcjom.

Dokumentacja Allegro: https://developer.allegro.pl/tutorials/uwierzytelnianie-i-autoryzacja-zlq9e75GdIR

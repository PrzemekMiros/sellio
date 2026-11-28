// Only these fixed messages/codes may cross the OAuth redirect boundary.
export const allegroErrors = {
  configuration: 'Brakuje poprawnej konfiguracji aplikacji Allegro na serwerze Sellio. Administrator musi sprawdzić ustawienia Netlify.',
  browser_session: 'Nie potwierdzono sesji łączenia w tej przeglądarce. Wróć do Sellio i rozpocznij połączenie ponownie w tej samej przeglądarce.',
  session_expired: 'Próba połączenia wygasła lub została już użyta. Kliknij „Połącz konto Allegro”, aby rozpocząć nową próbę.',
  flow_replaced: 'Ta próba połączenia została zastąpiona nowszą lub anulowana. Rozpocznij połączenie ponownie w jednym oknie.',
  consent_denied: 'Nie udzielono zgody na połączenie. Rozpocznij ponownie i zaakceptuj uprawnienia na stronie Allegro.',
  invalid_scope: 'Allegro odrzuciło uprawnienie odczytu danych konta. W panelu Moje aplikacje Allegro otwórz AlSellio → Edytuj i włącz „Odczyt danych konta” (allegro:api:profile:read). Zapisz ustawienia i rozpocznij nowe połączenie w Sellio.',
  authorization_rejected: 'Allegro odrzuciło żądanie autoryzacji. Administrator musi sprawdzić typ aplikacji, adres powrotu i uprawnienia w panelu Allegro.',
  missing_code: 'Allegro nie przekazało poprawnego kodu autoryzacji. Rozpocznij połączenie ponownie z przycisku w Sellio.',
  invalid_client: 'Allegro odrzuciło dane aplikacji. Sprawdź Client ID i Client Secret w Netlify oraz zgodność ze środowiskiem produkcyjnym Allegro.',
  invalid_grant: 'Allegro odrzuciło kod autoryzacji lub token odnowienia. Rozpocznij nową próbę; jeśli błąd wróci, administrator musi sprawdzić adres powrotu i obsługę PKCE.',
  token_network: 'Nie udało się połączyć z serwerem autoryzacji Allegro. Spróbuj ponownie za chwilę.',
  token_rejected: 'Allegro nie wydało tokenu dostępu. Administrator może sprawdzić etap i status odpowiedzi w logach funkcji Allegro.',
  token_response: 'Serwer autoryzacji Allegro zwrócił nieprawidłową odpowiedź. Spróbuj ponownie za chwilę.',
  profile_network: 'Dostęp został udzielony, ale API Allegro nie odpowiedziało na odczyt konta. Spróbuj połączyć konto ponownie za chwilę.',
  profile_unauthorized: 'API Allegro odrzuciło uzyskany token podczas odczytu konta. Rozpocznij połączenie ponownie.',
  profile_forbidden: 'API Allegro odmówiło odczytu konta (HTTP 403). Sprawdź uprawnienie odczytu danych konta oraz zgodność nagłówka User-Agent z aplikacją Allegro.',
  profile_rejected: 'Nie udało się odczytać danych konta z API Allegro. Administrator może sprawdzić status odpowiedzi w logach funkcji Allegro.',
  profile_response: 'API Allegro zwróciło nieprawidłowe dane konta. Połączenie nie zostało zapisane.',
  storage_read: 'Nie można odczytać zapisanego połączenia. Administrator musi sprawdzić konfigurację aplikacji i klucz szyfrowania na serwerze.',
  storage_conflict: 'Połączenie zmieniło się podczas autoryzacji. Odśwież status i w razie potrzeby rozpocznij nową próbę.',
  internal: 'Nie udało się dokończyć autoryzacji po stronie Sellio. Przekaż administratorowi identyfikator diagnostyczny widoczny poniżej.',
} as const;
export type AllegroErrorCode = keyof typeof allegroErrors;
export function allegroErrorCode(value: unknown): AllegroErrorCode {
  return typeof value === 'string' && Object.hasOwn(allegroErrors, value) ? value as AllegroErrorCode : 'internal';
}

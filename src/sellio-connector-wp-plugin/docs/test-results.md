# Wyniki kontroli (2026-11-22)

- PHP CLI: 8.2.12, `php -l` uruchomiono dla wszystkich 10 plików PHP wtyczki — wynik: bez błędów składni.
- WordPress: 6.8.3; WooCommerce: 10.4.3. Kod deklaruje zgodność HPOS i korzysta z `wc_get_order`/`wc_get_orders`.
- WP-CLI: niedostępne w `PATH`; PHPUnit i skonfigurowana instalacja testowa nie zostały znalezione. Nie tworzono ani nie modyfikowano rzeczywistych zamówień lub produktów.
- Action Scheduler: jest dostarczany przez WooCommerce; nie został wykonany test runtime z powodu braku WP-CLI/testowej bazy.
- Node.js: niedostępny, dlatego mock nie został uruchomiony; plik jest przeznaczony do uruchomienia w środowisku z Node.js.

Do ręcznej weryfikacji na kopii deweloperskiej: aktywuj wtyczkę, uruchom mock, wpisz dane testowe, wygeneruj token katalogu, wykonaj `Sprawdź połączenie`, utwórz zamówienie gościa i wariantowy produkt, a następnie sprawdź Action Scheduler oraz chronione endpointy z README.

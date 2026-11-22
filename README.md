# Sellio — panel sprzedaży

Lokalny prototyp w Astro i TypeScript. Bez backendu, bazy danych, logowania, zewnętrznych API i fikcyjnych danych sprzedaży.

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

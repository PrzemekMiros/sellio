const legacyModules = [
  { name: 'Pulpit', slug: '', icon: 'dashboard', group: 'Obszar roboczy', description: 'Podsumowanie sprzedaży, zamówień i wysyłek w jednym miejscu.' },
  { name: 'Zamówienia', slug: 'zamowienia', icon: 'bag', group: 'Obszar roboczy', description: 'Zamówienia z Allegro i Wordpress, ich statusy oraz operacje zbiorcze.' },
  { name: 'Produkty', slug: 'produkty', icon: 'box', group: 'Obszar roboczy', description: 'Katalog produktów z Wordpress, SKU, warianty i zdjęcia.' },
  { name: 'Stany i ceny', slug: 'stany-i-ceny', icon: 'sliders', group: 'Obszar roboczy', description: 'Dostępność, ceny, powiązania ofert i synchronizacja.' },
  { name: 'Oferty Allegro', slug: 'oferty-allegro', icon: 'tag', group: 'Obszar roboczy', description: 'Lista ofert Allegro, ich wystawianie i edycja zbiorcza.' },
  { name: 'Szablony ofert', slug: 'szablony-ofert', icon: 'layout', group: 'Obszar roboczy', description: 'Sekcje tekstu i zdjęć, podgląd oraz przypisanie szablonów do kategorii.' },
  { name: 'Wysyłki', slug: 'wysylki', icon: 'truck', group: 'Obsługa sprzedaży', description: 'Przesyłki, etykiety oraz numery śledzenia.' },
  { name: 'Dokumenty', slug: 'dokumenty', icon: 'file', group: 'Obsługa sprzedaży', description: 'Faktury, korekty i statusy dokumentów sprzedaży.' },
  { name: 'Zwroty i reklamacje', slug: 'zwroty-i-reklamacje', icon: 'return', group: 'Obsługa sprzedaży', description: 'Zgłoszenia zwrotów i reklamacji, powiązania z zamówieniami oraz statusy.' },
  { name: 'Automatyzacje', slug: 'automatyzacje', icon: 'bolt', group: 'Zarządzanie', description: 'Reguły automatyzacji, warunki, akcje i historia wykonań.' },
  { name: 'Integracje', slug: 'integracje', icon: 'plug', group: 'Zarządzanie', description: 'Połączenia z Allegro, Wordpress, przewoźnikami i systemem fakturowania.' },
  { name: 'Raporty', slug: 'raporty', icon: 'chart', group: 'Zarządzanie', description: 'Sprzedaż, zamówienia i wyniki według kanału.' },
  { name: 'Dziennik zdarzeń', slug: 'dziennik-zdarzen', icon: 'activity', group: 'Zarządzanie', description: 'Historia synchronizacji, błędy i zdarzenia systemowe.' },
  { name: 'Ustawienia', slug: 'ustawienia', icon: 'settings', group: 'Zarządzanie', description: 'Dane firmy, użytkownicy, uprawnienia i konfiguracja aplikacji.' },
].map(module => ({ ...module, href: `/admin${module.slug ? `/${module.slug}` : ''}` }));
export type Module = { name: string; slug: string; icon: string; description: string; href: string; group: string };
export type NavigationItem = { name: string; icon: string; section?: string; module?: Module; children?: Module[] };

function page(name: string, slug: string, icon: string, description: string, group = ''): Module {
  return { name, slug, icon, description, group, href: `/admin${slug ? `/${slug}` : ''}` };
}
function link(name: string, slug: string, icon: string, description: string): NavigationItem {
  return { name, icon, module: page(name, slug, icon, description) };
}
function submenu(name: string, slug: string, icon: string, entries: [string, string, string][], section?: string): NavigationItem {
  return { name, icon, section, children: entries.map(([title, path, description]) => page(title, `${slug}/${path}`, icon, description, name)) };
}
const marketplaceEntries: [string, string, string][] = [
  ['Wystawianie', 'wystawianie', 'Przygotowanie i publikowanie ofert na marketplace.'],
  ['Zarządzanie ofertami', 'oferty', 'Przegląd ofert, ich statusów i edycja zbiorcza.'],
  ['Cenniki wysyłek', 'cenniki-wysylek', 'Konfiguracja metod dostawy i kosztów wysyłki.'],
  ['Kategorie i parametry', 'kategorie-i-parametry', 'Kategorie ofert oraz wymagane parametry produktów.'],
  ['Szablony ofert', 'szablony-ofert', 'Szablony opisów ofert z sekcjami tekstu i zdjęć.'],
  ['Powiązania', 'powiazania', 'Powiązania produktów, kategorii i parametrów ofert.'],
];

export const navigation: NavigationItem[] = [
  link('Strona główna', '', 'dashboard', 'Podsumowanie sprzedaży, zamówień i wysyłek w jednym miejscu.'),
  submenu('Zamówienia', 'zamowienia', 'bag', [
    ['Lista zamówień', 'lista', 'Zamówienia z kanałów sprzedaży, ich statusy i operacje zbiorcze.'],
    ['Faktury', 'faktury', 'Faktury, korekty i statusy dokumentów sprzedaży.'],
    ['Zwroty', 'zwroty', 'Obsługa zwrotów i powiązanych zamówień.'],
    ['Klienci', 'klienci', 'Dane klientów oraz historia ich zamówień.'],
    ['Statusy zamówień', 'statusy', 'Konfiguracja etapów obsługi zamówień.'],
    ['Szablony E-mail/SMS', 'szablony-wiadomosci', 'Szablony wiadomości e-mail i SMS do klientów.'],
    ['Automatyczne akcje', 'automatyczne-akcje', 'Reguły i akcje automatyzujące obsługę zamówień.'],
    ['Wydruki i eksporty', 'wydruki-i-eksporty', 'Szablony wydruków i eksport danych zamówień.'],
    ['Import przelewów', 'import-przelewow', 'Import płatności i powiązanie przelewów z zamówieniami.'],
    ['Ustawienia', 'ustawienia', 'Konfiguracja obsługi zamówień.'],
  ]),
  submenu('Produkty', 'produkty', 'box', [
    ['Lista produktów', 'lista', 'Katalog produktów, SKU, warianty i zdjęcia.'],
    ['Kontrola magazynu', 'kontrola-magazynu', 'Dostępność produktów, dostawy i kontrola stanów magazynowych.'],
    ['Automatyczne akcje', 'automatyczne-akcje', 'Reguły i akcje automatyzujące zarządzanie produktami.'],
    ['Import/Eksport', 'import-eksport', 'Importowanie i eksportowanie danych produktów.'],
    ['Ustawienia', 'ustawienia', 'Konfiguracja katalogów i magazynów.'],
  ]),
  link('Analityka', 'analityka', 'chart', 'Analiza sprzedaży, zamówień i wyników według kanału.'),
  link('Integracje', 'integracje', 'plug', 'Połączenia z kanałami sprzedaży, przewoźnikami i systemem fakturowania.'),
  link('Base Connect', 'base-connect', 'plug', 'Współpraca B2B oraz wymiana danych produktowych pomiędzy partnerami.'),
  link('Pomoc i kontakt', 'pomoc-i-kontakt', 'info', 'Materiały pomocnicze i informacje o kontakcie ze wsparciem.'),
  submenu('Allegro', 'allegro', 'tag', [
    ...marketplaceEntries.slice(0, 2),
    ['Ustawienia', 'ustawienia', 'Konfiguracja obsługi konta Allegro.'],
    ...marketplaceEntries.slice(2, 4),
    ['Osoby odpowiedzialne', 'osoby-odpowiedzialne', 'Dane osób odpowiedzialnych za produkty w ofertach.'],
    ['Producenci odpowiedzialni', 'producenci-odpowiedzialni', 'Dane producentów odpowiedzialnych za produkty w ofertach.'],
    ...marketplaceEntries.slice(4),
    ['Allegro Ads', 'ads', 'Zarządzanie reklamą ofert w Allegro Ads.'],
    ['Wiadomości', 'wiadomosci', 'Korespondencja z kupującymi na Allegro.'],
  ], 'Marketplace'),
  submenu('Skroutz V2', 'skroutz-v2', 'store', marketplaceEntries, 'Marketplace'),
  submenu('InPost Von Halsky', 'inpost-von-halsky', 'store', marketplaceEntries, 'Marketplace'),
];

export const menuModules = navigation.flatMap(item => item.children ?? (item.module ? [item.module] : []));
export const modules: Module[] = [...menuModules, ...legacyModules.filter(item => !menuModules.some(current => current.href === item.href))];

# Notuja Desktop

Cienka powłoka Electron wokół aplikacji webowej Notuja. Dodaje to, czego przeglądarka nie potrafi:

- nagrywanie **dźwięku komputera + mikrofonu bez okna wyboru ekranu** (proces główny sam odpowiada na `getDisplayMedia`: ekran główny + loopback dźwięku systemu),
- ikonę w zasobniku, nagrywanie przy schowanym oknie, skrót globalny,
- pytanie „Nagrać?”, gdy zaczyna się spotkanie.

Katalog jest niezależny od aplikacji webowej: własny `package.json`, czysty CommonJS (`.cjs`). Wszystkie polecenia uruchamiaj w `desktop/`, nigdy w katalogu głównym repo.

## Uruchomienie (dev)

```powershell
cd desktop
npm install
$env:NOTUJA_URL = "http://localhost:8080"   # opcjonalnie; domyślnie https://notuja.pl
npm start
```

Jeśli terminal ma ustawione `ELECTRON_RUN_AS_NODE=1` (np. terminal uruchomiony z VS Code), Electron wystartuje jako zwykły Node i zgłosi błąd — usuń zmienną: `Remove-Item Env:ELECTRON_RUN_AS_NODE`.

Self-test (dowód, że dźwięk systemu łapie się bez okna wyboru) — wypisuje jedną linię JSON i kończy kodem 0/1:

```powershell
npm run selftest
```

## Build (Windows)

```powershell
npm run icons      # tylko po zmianie znaku; ikony są w repo
npm run dist:win   # -> dist/Notuja-Setup-<wersja>.exe (NSIS, x64, instalacja dla użytkownika, bez admina)
```

CI: `.github/workflows/desktop-win.yml` (ręcznie albo tag `desktop-v*`), instalator jest artefaktem `notuja-windows`. Wersję ustawia `version` w `package.json`.

## Podpisywanie

Instalator **nie jest podpisany** — Windows SmartScreen pokaże ostrzeżenie „Nieznany wydawca”, dopóki nie dodamy certyfikatu do podpisywania kodu. electron-builder podpisze build sam, gdy dostanie:

| Zmienna | Znaczenie |
| --- | --- |
| `WIN_CSC_LINK` (lub `CSC_LINK`) | ścieżka, URL `https://` albo base64 pliku `.pfx`/`.p12` |
| `WIN_CSC_KEY_PASSWORD` (lub `CSC_KEY_PASSWORD`) | hasło do certyfikatu |

Certyfikaty w chmurze (Azure Trusted Signing) konfiguruje się przez `win.azureSignOptions` i zmienne `AZURE_TENANT_ID`, `AZURE_CLIENT_ID`, `AZURE_CLIENT_SECRET`. W CI trzymaj je w sekretach repozytorium.

## Most z aplikacją webową

`preload.cjs` wystawia `window.notujaDesktop` (`isDesktop`, `platform`, `version`, `onCommand`, `setState`, `ready`).

- Polecenia (`{ type: 'record', source: 'computer' | 'mic' }`, `{ type: 'stop' }`) przychodzą jako zdarzenie DOM `notuja:command` na `window` (w `event.detail`), wysyłane z aktywacją użytkownika. `onCommand` słucha tego samego zdarzenia — strona ma używać **jednego** z tych sposobów, inaczej dostanie polecenie dwa razy.
- Strona woła `ready()` po zarejestrowaniu nasłuchu (po każdym pełnym przeładowaniu). Bez `ready()` w 2 s powłoka otwiera `/app/nagraj?teraz=true&zrodlo=komputer`.
- `setState({ recording, paused?, elapsedMs?, title? })` steruje ikoną i podpowiedzią w zasobniku. Zegar w podpowiedzi tyka sam; `elapsedMs` tylko go koryguje.

## Wykrywanie spotkań (Windows)

`src/detect-win.cjs` co 5 s czyta (`reg query`, tylko odczyt) klucz
`HKCU\Software\Microsoft\Windows\CurrentVersion\CapabilityAccessManager\ConsentStore\microphone` — także podklucz `NonPackaged`. Aplikacja, która ma `LastUsedTimeStop = 0`, używa mikrofonu teraz. Reagujemy tylko na znane programy (Teams, Zoom, Webex, Slack, Discord, Skype, przeglądarki), po dwóch kolejnych odczytach i raz na spotkanie. Wpisy aktywne już przy starcie Notui są pomijane. macOS: `src/detect-mac.cjs` (ten sam kontrakt `createMeetingDetector({ onStart, onEnd })`); brak modułu = funkcja wyłączona.

## Skrót

Windows/Linux: **Ctrl+Alt+R**, macOS: **Cmd+Option+N**. W Windows celowo nie Ctrl+Alt+N: to to samo co AltGr+N, czyli „ń” — skrót globalny zabrałby tę literę we wszystkich programach. Zmiana: pole `shortcut` w `settings.json` w `%APPDATA%\Notuja` (format akceleratorów Electrona).

## Prywatność

- Nagrywanie zaczyna wyłącznie użytkownik (menu, skrót, kliknięcie powiadomienia). Wykrycie spotkania kończy się pytaniem, nigdy nagraniem.
- Nagrywanie jest zawsze widoczne: czerwona kropka na ikonie w zasobniku, czas w podpowiedzi i powiadomienie „Notuja nagrywa” przy starcie. Tego powiadomienia nie da się wyłączyć w aplikacji.
- Uprawnienia do mikrofonu i przechwytywania ekranu dostaje tylko adres aplikacji (`NOTUJA_URL`); inne linki otwierają się w domyślnej przeglądarce.
- Powłoka nie wysyła nigdzie żadnych danych; z rejestru czyta tylko nazwy programów używających mikrofonu.

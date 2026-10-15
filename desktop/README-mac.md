# Notuja na macOS

Stan: konfiguracja przygotowana na Windowsie i **nieuruchomiona jeszcze na żadnym Macu**. Pierwsza paczka z GitHub Actions wymaga ręcznego sprawdzenia nagrywania.

## Która paczka

- `Notuja-<wersja>-arm64.dmg` — Mac z procesorem Apple (M1 i nowsze)
- `Notuja-<wersja>-x64.dmg` — Mac z procesorem Intel

## Co działa na której wersji macOS

| macOS | Mikrofon | Dźwięk komputera |
|---|---|---|
| 14.2 i nowsze (Sonoma, Sequoia, Tahoe) | tak | tak — ścieżka wspierana przez Electron |
| 13.0–14.1 | tak | niepotwierdzone, do sprawdzenia na urządzeniu |
| 12 i starsze | tak | nie — system nie daje takiej możliwości |

## Pierwsze uruchomienie — uprawnienia

Notuja potrzebuje trzech zgód. Każdą można później zmienić w **menu Apple > Ustawienia systemowe > Prywatność i ochrona**.

1. **Mikrofon** — przy starcie pojawi się pytanie systemu; kliknij „Pozwól”. Ręcznie: Prywatność i ochrona > **Mikrofon** > włącz Notuję.
2. **Nagrywanie ekranu** — przy pierwszym nagraniu system odeśle do Ustawień. Prywatność i ochrona > **Nagrywanie ekranu i dźwięku systemowego** > włącz Notuję, potem zamknij i otwórz aplikację ponownie. Obraz ekranu nie jest zapisywany, ale bez tej zgody nagrywanie się nie rozpocznie.
3. **Dźwięk systemowy** (macOS 14.2+) — przy pierwszym nagraniu pojawi się osobne pytanie; kliknij „Pozwól”. W macOS 15 zgoda jest widoczna w tym samym panelu, w sekcji **Tylko nagrywanie dźwięku systemowego**.

Jeśli w nagraniu słychać tylko Ciebie, brakuje zgody z punktu 3 — aplikacja nie dostaje wtedy żadnego błędu.

W macOS 15 i nowszych system co pewien czas przypomina, że Notuja ma dostęp do nagrywania ekranu. Wybierz „Nadal zezwalaj”.

## Otwieranie paczki bez podpisu Apple (ad-hoc)

Dopóki nie ma certyfikatu Developer ID, macOS blokuje pierwsze uruchomienie.

- **macOS 15 i nowsze:** otwórz Notuję (pojawi się ostrzeżenie, kliknij „Gotowe”), potem Ustawienia systemowe > Prywatność i ochrona > przewiń w dół > **Otwórz mimo to** > potwierdź hasłem.
- **macOS 14 i starsze:** w Finderze kliknij Notuję z klawiszem Control (albo prawym przyciskiem) > **Otwórz** > **Otwórz**.
- Gdy system pisze, że aplikacja jest uszkodzona: w Terminalu `xattr -dr com.apple.quarantine /Applications/Notuja.app`.

Przy podpisie ad-hoc macOS wiąże zgody z konkretną wersją pliku, więc **po każdej aktualizacji trzeba nadać uprawnienia ponownie**. Znika to po podpisaniu certyfikatem Developer ID.

## Wydanie podpisane i notaryzowane

Potrzebne:

1. Członkostwo w **Apple Developer Program** (99 USD rocznie).
2. Certyfikat **Developer ID Application**, wyeksportowany z Pęku kluczy jako plik `.p12` z hasłem.
3. **Hasło dla aplikacji** do Apple ID (account.apple.com > Logowanie i bezpieczeństwo > Hasła dla aplikacji).
4. **Team ID** (developer.apple.com > Membership).

Sekrety repozytorium (GitHub > Settings > Secrets and variables > Actions):

| Sekret | Wartość |
|---|---|
| `CSC_LINK` | plik `.p12` w base64: `base64 -i certyfikat.p12 \| pbcopy` |
| `CSC_KEY_PASSWORD` | hasło do pliku `.p12` |
| `APPLE_ID` | adres e-mail konta Apple |
| `APPLE_APP_SPECIFIC_PASSWORD` | hasło dla aplikacji |
| `APPLE_TEAM_ID` | Team ID |

Bez sekretów workflow buduje paczkę ad-hoc. Z `CSC_LINK` podpisuje certyfikatem i włącza hardened runtime; z kompletem `APPLE_*` dodatkowo notaryzuje.

## Budowanie

GitHub > Actions > **Desktop macOS** > Run workflow, albo wypchnięcie tagu `desktop-v*`. Pliki `.dmg` są w artefakcie `notuja-macos`. Lokalnie na Macu: `cd desktop && npm install && npm run dist:mac`.

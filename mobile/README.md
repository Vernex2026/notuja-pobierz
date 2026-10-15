# Notuja — aplikacja Android

Natywna powłoka (Capacitor 8) wokół serwisu `https://notuja.pl`. Aplikacja nie zawiera kopii strony — ładuje ją z sieci, więc zmiany w serwisie są widoczne od razu, bez nowego APK.

> Stan: projekt przygotowany bez lokalnej kompilacji (na maszynie autora nie ma JDK ani Android SDK). Pierwszy build w GitHub Actions i test na telefonie są jeszcze do wykonania — patrz „Co jest niesprawdzone”.

## Co daje ponad stronę w przeglądarce

- **Nagrywanie w tle.** Po zgaszeniu ekranu albo przejściu do innej aplikacji nagranie trwa dalej. Odpowiada za to usługa pierwszoplanowa typu `microphone` ze stałym powiadomieniem „Notuja nagrywa” (z licznikiem czasu; dotknięcie wraca do aplikacji).
- Przycisk „Wstecz” cofa w historii strony, a na jej początku chowa aplikację zamiast ją zamykać (nagranie nie zostaje przerwane).
- Linki poza `notuja.pl` i `mgfhfthlbzknsctsryuj.supabase.co` otwierają się w przeglądarce systemowej.
- Bez internetu pojawia się lokalny ekran „Brak połączenia” z przyciskiem ponowienia.

## Ograniczenia

- **Tylko mikrofon.** Aplikacja nagrywa to, co słyszy mikrofon telefonu. Nagrywanie dźwięku innych aplikacji (Teams, Zoom, Meet) ani rozmów telefonicznych **nie jest możliwe** i aplikacja tego nie próbuje — Android na to nie pozwala zwykłym aplikacjom.
- Nagrywanie trzeba **rozpocząć przy widocznej aplikacji** (wymóg Androida 14+ dla usług z mikrofonem). Nie da się go wystartować z tła.
- Usunięcie aplikacji z listy ostatnich kończy nagrywanie (powiadomienie znika razem z nią).
- Jeśli inna aplikacja przejmie mikrofon (np. rozmowa telefoniczna), system może na ten czas wyciszyć nagranie.
- Logowanie przez Google wewnątrz WebView nie zadziała (Google blokuje WebView, a obce hosty i tak otwierają się w przeglądarce) — działa logowanie e-mailem.

## Most strona ↔ aplikacja

W stronie dostępny jest obiekt `window.notujaNative` (metody synchroniczne, nie rzucają wyjątków):

| Wywołanie | Działanie |
| --- | --- |
| `platform()` | zwraca `"android"` |
| `version()` | zwraca `versionName`, np. `"0.1.0"` |
| `setRecording(true, tytuł)` | uruchamia usługę i powiadomienie; ponowne wywołanie zmienia tytuł |
| `setRecording(false, "")` | zatrzymuje usługę |
| `isRecordingServiceActive()` | dodatek: `true`, gdy usługa faktycznie działa |
| `reload()` | dodatek: ładuje serwis od nowa (używa go ekran „Brak połączenia”) |

`setRecording(true, …)` trzeba wołać **po** udanym `getUserMedia` (wtedy uprawnienie do mikrofonu jest już przyznane) i przy widocznej aplikacji. Pełne przeładowanie strony automatycznie zatrzymuje usługę. Do `User-Agent` dopisywane jest `NotujaAndroid/0.1.0`.

## Budowanie

### GitHub Actions (zalecane)

Workflow `.github/workflows/android.yml` uruchamia się ręcznie (Actions → „Android (Notuja)” → Run workflow) albo po wypchnięciu tagu `android-v*`, np. `android-v0.1.0`. Gotowy plik jest w artefakcie **`notuja-android`**.

- Bez sekretów podpisu powstaje `notuja-debug.apk` (do testów).
- Z sekretami powstaje podpisany `notuja-release.apk`.
- `versionCode` to numer uruchomienia workflow.

### Lokalnie (Android Studio)

Wymagane: Node 22+, Android Studio z JDK 21 i Android SDK 36.

```powershell
cd mobile
npm ci
npx cap sync android
npx cap open android      # otwiera projekt w Android Studio
```

Z wiersza poleceń: `cd android; .\gradlew.bat assembleDebug` → `android\app\build\outputs\apk\debug\app-debug.apk`.

Inny adres serwisu (np. testowy): ustaw `NOTUJA_URL` przed synchronizacją — `$env:NOTUJA_URL = "https://test.example.pl"; npx cap sync android`.

Po każdej zmianie `capacitor.config.js` albo `www/` uruchom ponownie `npx cap sync android`.

## Klucz podpisu i sekrety GitHub

Klucz tworzy się raz i **trzeba go zachować** — bez niego nie da się wydać aktualizacji tej samej aplikacji.

```powershell
keytool -genkeypair -v -keystore notuja-release.jks -alias notuja -keyalg RSA -keysize 2048 -validity 10000
[Convert]::ToBase64String([IO.File]::ReadAllBytes("notuja-release.jks")) | Set-Content keystore.base64.txt
```

(`keytool` jest częścią JDK / Android Studio.) W repozytorium: Settings → Secrets and variables → Actions:

| Sekret | Wartość |
| --- | --- |
| `ANDROID_KEYSTORE_BASE64` | zawartość `keystore.base64.txt` |
| `ANDROID_KEYSTORE_PASSWORD` | hasło do pliku klucza |
| `ANDROID_KEY_ALIAS` | alias, np. `notuja` |
| `ANDROID_KEY_PASSWORD` | hasło klucza |

Plików `*.jks` i `keystore.base64.txt` nie wolno dodawać do repozytorium (są w `.gitignore`). Lokalnie te same dane można podać jako zmienne środowiskowe lub właściwości Gradle: `ANDROID_KEYSTORE_FILE` (ścieżka do `.jks`), `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`, `ANDROID_KEY_PASSWORD`.

## Instalacja APK na telefonie

1. Pobierz artefakt `notuja-android`, rozpakuj i prześlij plik `.apk` na telefon.
2. Otwórz plik. Android zapyta o zgodę na instalowanie z tego źródła („Instaluj nieznane aplikacje”) — zezwól dla używanej aplikacji (Pliki/Chrome).
3. Przy pierwszym nagraniu zezwól na **mikrofon** i **powiadomienia**.

Wersja debug i wersja podpisana mają różne klucze — przed zmianą jednej na drugą trzeba odinstalować poprzednią.

## Google Play — co będzie potrzebne

- **Docelowe API**: projekt celuje w API 36 (domyślne w Capacitor 8); Play wymaga aktualnego poziomu dla nowych aplikacji.
- **Deklaracja usługi pierwszoplanowej** (Zasady → Zawartość aplikacji): typ `microphone`, opis funkcji, skutek przerwania zadania oraz **link do filmu** pokazującego, jak użytkownik uruchamia nagrywanie i że widzi powiadomienie.
- **Polityka prywatności** (publiczny adres) i formularz „Bezpieczeństwo danych” — aplikacja nagrywa dźwięk i wysyła go na serwer.
- Uzasadnienie uprawnienia do mikrofonu; pakiet `.aab` zamiast `.apk` (`./gradlew bundleRelease`) i Podpisywanie aplikacji przez Google Play.
- Aplikacja musi dawać coś więcej niż sama strona (zasada minimalnej funkcjonalności) — tu jest to nagrywanie w tle.
- Nie dodajemy prośby o wyłączenie optymalizacji baterii — Play na to w tym zastosowaniu nie pozwala.

## Oszczędzanie baterii u producentów

Niektóre nakładki (Xiaomi/MIUI/HyperOS, Huawei/EMUI, Samsung One UI, Oppo, Vivo) potrafią zatrzymać aplikację w tle mimo usługi pierwszoplanowej. Jeśli nagranie urywa się po zgaszeniu ekranu:

- **Samsung**: Ustawienia → Aplikacje → Notuja → Bateria → „Bez ograniczeń”; usuń Notuję z „Uśpionych aplikacji”.
- **Xiaomi**: Ustawienia → Aplikacje → Notuja → Oszczędzanie baterii → „Bez ograniczeń”, włącz „Autostart”; zablokuj aplikację kłódką na liście ostatnich.
- **Huawei**: Ustawienia → Bateria → Uruchamianie aplikacji → Notuja → „Zarządzaj ręcznie” i zaznacz wszystkie trzy opcje.
- Wyłącz tryb oszczędzania energii na czas długiego nagrania i nie usuwaj aplikacji z listy ostatnich.

Opisy dla innych marek: <https://dontkillmyapp.com>.

## Co jest niesprawdzone

Nic nie zostało skompilowane ani uruchomione na urządzeniu. Sprawdzone zostały tylko: `npm install`, `npx cap add android`, `npx cap sync android`, poprawność składni XML i YAML oraz zgodność kodu z dokumentacją Androida i źródłami Capacitora 8.5.2. Do potwierdzenia na telefonie:

- czy projekt kompiluje się w CI (Java, zasoby, Gradle),
- czy nagranie faktycznie trwa przy zgaszonym ekranie przez dłuższy czas (30+ minut) i czy części wysyłają się w tle,
- podtrzymanie widoczności WebView w tle (`dispatchWindowVisibilityChanged`) — to obejście dławienia timerów, niegwarantowane przez dokumentację,
- zachowanie na Androidzie 14/15/16 oraz na telefonach Xiaomi/Huawei/Samsung.

## Struktura

- `capacitor.config.js` — adres serwisu, dozwolone hosty, ekran błędu.
- `www/index.html` — lokalny ekran „Brak połączenia”.
- `android/app/src/main/java/pl/notuja/app/` — `MainActivity` (przycisk Wstecz), `NotujaPlugin` (most `notujaNative`, WebView w tle), `RecordingService` (usługa pierwszoplanowa, powiadomienie, blokada wybudzenia).
- `android/app/src/main/AndroidManifest.xml` — uprawnienia i deklaracja usługi.

Dokumentacja, na której oparto usługę: [typy usług pierwszoplanowych](https://developer.android.com/develop/background-work/services/fgs/service-types), [ograniczenia startu z tła](https://developer.android.com/develop/background-work/services/fgs/restrictions-bg-start), [wymagane typy w Androidzie 14](https://developer.android.com/about/versions/14/changes/fgs-types-required), [deklaracja w Play Console](https://support.google.com/googleplay/android-developer/answer/13392821).

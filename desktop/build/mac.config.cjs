// Konfiguracja electron-builder dla macOS. Wszystkie klucze najwyższego poziomu
// są scalane przez ../electron-builder.config.cjs.
//
// Sprawdzone w kodzie electron-builder 26.15.3 (app-builder-lib/out/mac/MacTargetHelper.js)
// i w dokumentacji https://www.electron.build/v26/docs/mac :
//  - `identity: '-'`  -> podpis ad-hoc; `identity: null` -> brak podpisu; brak klucza -> szukanie
//    certyfikatu w pęku kluczy, a gdy go nie ma, podpis jest POMIJANY (w 26.15.3 nie ma już
//    automatycznego ad-hoc dla arm64). Dlatego bez certyfikatu ustawiamy '-' jawnie:
//    niepodpisana aplikacja arm64 w ogóle się nie uruchomi, a macOS nie zapamięta jej uprawnień.
//  - ad-hoc + hardenedRuntime wymaga uprawnienia disable-library-validation (builder ostrzega),
//    więc w trybie ad-hoc hardened runtime jest wyłączony - ma sens dopiero z notaryzacją.
//  - notaryzacja jest wbudowana (@electron/notarize); builder czyta APPLE_ID,
//    APPLE_APP_SPECIFIC_PASSWORD, APPLE_TEAM_ID (albo APPLE_API_KEY, APPLE_API_KEY_ID,
//    APPLE_API_ISSUER). `notarize: false` pomija ją bez błędu.
'use strict';

const has = (name) => Boolean(process.env[name] && process.env[name].trim());

// Certyfikat Developer ID: plik .p12 (CSC_LINK) albo nazwa z pęku kluczy (CSC_NAME).
const hasCertificate = has('CSC_LINK') || has('CSC_NAME');
const hasNotaryCredentials =
  (has('APPLE_ID') && has('APPLE_APP_SPECIFIC_PASSWORD') && has('APPLE_TEAM_ID')) ||
  (has('APPLE_API_KEY') && has('APPLE_API_KEY_ID') && has('APPLE_API_ISSUER'));

// Osobne paczki arm64 i x64 zamiast universal: połowa rozmiaru pobierania, brak etapu
// scalania (@electron/universal), a aplikacja nie ma modułów natywnych, więc nic nie zyskujemy.
const arch = ['arm64', 'x64'];

const mac = {
  target: [
    { target: 'dmg', arch },
    { target: 'zip', arch },
  ],
  category: 'public.app-category.productivity',
  artifactName: 'Notuja-${version}-${arch}.${ext}',
  hardenedRuntime: hasCertificate,
  gatekeeperAssess: false,
  entitlements: 'build/entitlements.mac.plist',
  entitlementsInherit: 'build/entitlements.mac.plist',
  notarize: hasCertificate && hasNotaryCredentials,
  extendInfo: {
    LSUIElement: false,
    NSMicrophoneUsageDescription:
      'Notuja nagrywa Twój mikrofon tylko wtedy, gdy samodzielnie włączysz nagrywanie spotkania lub notatki.',
    // macOS 14.2+: bez tego klucza ścieżka dźwięku systemowego powstaje martwa, bez żadnego błędu.
    NSAudioCaptureUsageDescription:
      'Notuja nagrywa dźwięk komputera (głosy pozostałych uczestników spotkania) tylko wtedy, gdy samodzielnie włączysz nagrywanie.',
    // Nagrywanie ekranu nie ma własnego klucza z opisem celu - system pokazuje stały komunikat.
  },
};

if (!hasCertificate) mac.identity = '-';

module.exports = {
  mac,
  dmg: {
    artifactName: 'Notuja-${version}-${arch}.${ext}',
    // Notaryzowana jest aplikacja w środku; podpisywanie samego obrazu nie jest potrzebne.
    sign: false,
  },
};

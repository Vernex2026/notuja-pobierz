// Uprawnienia macOS potrzebne do nagrywania. Wywołanie z main.cjs:
//
//   const mac = require('./src/mac-setup.cjs').setupMac({ app, systemPreferences, shell, dialog });
//
// raz, w dowolnym momencie (przed lub po `app.whenReady()` - funkcja sama czeka na gotowość).
// Opcjonalnie tuż przed rozpoczęciem nagrywania: `await mac.ensureRecordingPermissions(okno)`.
//
// Przełączniki wiersza poleceń NIE są potrzebne: od Electron 39 dźwięk systemowy na macOS 14.2+
// idzie przez CoreAudio Tap domyślnie (docs/api/desktop-capturer.md). Nie dodawaj
// `disable-features=MacCatapLoopbackAudioForScreenShare`.
//
// Trzy osobne zgody systemu:
//  - Mikrofon: pytamy przy starcie (askForMediaAccess).
//  - Nagrywanie ekranu: wymagane, bo getDisplayMedia dostaje ścieżkę wideo z desktopCapturer;
//    stan da się odczytać, ale zgodę użytkownik włącza ręcznie w Ustawieniach.
//  - Dźwięk systemowy (macOS 14.2+): system pyta sam przy pierwszym nagraniu; Electron nie ma
//    API do odczytu tej zgody, a przy odmowie ścieżka audio jest po prostu martwa.
'use strict';

const PANES = {
  microphone: 'Privacy_Microphone',
  screen: 'Privacy_ScreenCapture',
};

function setupMac({ app, systemPreferences, shell, dialog } = {}) {
  const isMac = process.platform === 'darwin';

  function status(kind) {
    try {
      return isMac ? systemPreferences.getMediaAccessStatus(kind) : 'granted';
    } catch {
      return 'unknown';
    }
  }

  function openSettings(kind) {
    if (!isMac) return;
    try {
      const pane = PANES[kind] || PANES.screen;
      shell.openExternal(`x-apple.systempreferences:com.apple.preference.security?${pane}`).catch(() => {});
    } catch {
      /* brak ustawień = nic nie robimy */
    }
  }

  async function askMicrophone() {
    try {
      if (!isMac) return true;
      if (status('microphone') === 'granted') return true;
      // Pokazuje okno systemowe tylko przy pierwszym pytaniu; po odmowie zwraca false od razu.
      return await systemPreferences.askForMediaAccess('microphone');
    } catch {
      return false;
    }
  }

  /** Sprawdza zgody i w razie braku proponuje otwarcie Ustawień. Nigdy nie rzuca. */
  async function ensureRecordingPermissions(parentWindow) {
    const result = { microphone: true, screen: true, ok: true };
    if (!isMac) return result;
    try {
      result.microphone = await askMicrophone();
      result.screen = status('screen') === 'granted';
      result.ok = result.microphone && result.screen;
      if (result.ok) return result;

      const missing = result.screen ? 'microphone' : 'screen';
      const options = {
        type: 'info',
        buttons: ['Otwórz Ustawienia', 'Nie teraz'],
        defaultId: 0,
        cancelId: 1,
        message: result.screen ? 'Notuja nie ma dostępu do mikrofonu' : 'Włącz nagrywanie dźwięku komputera',
        detail: result.screen
          ? 'W Ustawieniach systemowych > Prywatność i ochrona > Mikrofon włącz Notuję.'
          : 'W Ustawieniach systemowych > Prywatność i ochrona > Nagrywanie ekranu i dźwięku systemowego włącz Notuję, a potem uruchom ją ponownie. Notuja zapisuje tylko dźwięk - obraz ekranu nie jest nagrywany.',
      };
      const box = parentWindow ? await dialog.showMessageBox(parentWindow, options) : await dialog.showMessageBox(options);
      if (box.response === 0) openSettings(missing);
    } catch {
      result.ok = false;
    }
    return result;
  }

  if (isMac) {
    try {
      app.whenReady().then(askMicrophone).catch(() => {});
    } catch {
      /* nigdy nie blokujemy startu */
    }
  }

  return {
    getStatus: () => ({ microphone: status('microphone'), screen: status('screen') }),
    openSettings,
    ensureRecordingPermissions,
  };
}

module.exports = { setupMac };

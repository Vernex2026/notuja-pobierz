// Konfiguracja electron-builder. Część dla macOS jest w build/mac.config.cjs (osobny plik,
// może jeszcze nie istnieć) - wszystkie jego klucze najwyższego poziomu trafiają do konfiguracji.
'use strict';

let mac = {};
try {
  mac = require('./build/mac.config.cjs');
} catch {
  // brak konfiguracji macOS - budujemy tylko Windows
}

module.exports = {
  appId: 'pl.notuja.desktop',
  productName: 'Notuja',
  copyright: 'Notuja',
  directories: {
    output: 'dist',
    buildResources: 'build',
  },
  files: ['main.cjs', 'preload.cjs', 'src/**/*', 'assets/**/*', 'selftest/**/*', 'package.json'],
  asar: true,
  npmRebuild: false,
  win: {
    target: [{ target: 'nsis', arch: ['x64'] }],
    icon: 'build/icon.ico',
  },
  nsis: {
    oneClick: true,
    perMachine: false, // instalacja dla bieżącego użytkownika, bez uprawnień administratora
    artifactName: 'Notuja-Setup-${version}.${ext}',
    shortcutName: 'Notuja',
    createDesktopShortcut: true,
    createStartMenuShortcut: true,
    runAfterFinish: true,
    deleteAppDataOnUninstall: false,
  },
  ...mac,
};

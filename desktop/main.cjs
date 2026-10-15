// Notuja Desktop - cienka powłoka Electron wokół aplikacji webowej.
// Zasada nadrzędna: nagrywanie zawsze zaczyna użytkownik i zawsze jest widoczne
// (ikona w zasobniku + powiadomienie przy starcie). Nic nie nagrywa się samo.
'use strict';
const path = require('node:path');
const {
  app,
  BrowserWindow,
  Menu,
  Notification,
  Tray,
  desktopCapturer,
  dialog,
  globalShortcut,
  ipcMain,
  nativeImage,
  powerSaveBlocker,
  screen,
  session,
  shell,
} = require('electron');
const { createSettings } = require('./src/settings.cjs');

const APP_ID = 'pl.notuja.desktop';
const APP_URL = (process.env.NOTUJA_URL || 'https://notuja.pl').replace(/\/+$/, '');
const APP_ORIGIN = new URL(APP_URL).origin;
const ALLOWED_ORIGINS = new Set([APP_ORIGIN, 'https://mgfhfthlbzknsctsryuj.supabase.co']);
const SELF_TEST = process.argv.includes('--self-test');
const START_HIDDEN = process.argv.includes('--hidden');
const IS_MAC = process.platform === 'darwin';
// Ctrl+Alt+N to w Windows to samo co AltGr+N, czyli litera „ń” - globalny skrót
// zabrałby ją w każdym programie. Dlatego poza macOS domyślnie Ctrl+Alt+R.
const DEFAULT_SHORTCUT = IS_MAC ? 'Command+Alt+N' : 'Control+Alt+R';
const READY_TIMEOUT_MS = 2000;
const ASSETS = path.join(__dirname, 'assets');

let settings = null;
let win = null;
let tray = null;
let detector = null;
let isQuitting = false;
let pageReady = false; // strona wywołała notujaDesktop.ready() od ostatniej nawigacji
let loadedAt = 0;
let pending = null; // polecenie czekające na ready(): { cmd, at }
let pendingTimer = null;
let activateAfterLoad = false;
let recState = { recording: false, paused: false, title: '' };
let recBase = 0; // Date.now() - elapsedMs
let recFrozenMs = 0;
let tooltipTimer = null;
let sleepBlockId = null;
const liveNotifications = new Set();

// macOS: zgody systemowe obsługuje osobny moduł (może nie istnieć).
let macSetup = null;
if (IS_MAC) {
  try {
    const { systemPreferences } = require('electron');
    macSetup = require('./src/mac-setup.cjs').setupMac({ app, systemPreferences, shell, dialog }) || null;
  } catch (err) {
    if (err && err.code !== 'MODULE_NOT_FOUND') console.error('[notuja] mac-setup:', err.message);
  }
}

process.on('uncaughtException', (err) => console.error('[notuja] uncaughtException:', err));
process.on('unhandledRejection', (err) => console.error('[notuja] unhandledRejection:', err));

// ---------------------------------------------------------------- narzędzia

function originOf(url) {
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}

function isAppOrigin(url) {
  return originOf(url) === APP_ORIGIN;
}

function isLocalPage(url) {
  // Własne strony powłoki (offline, self-test) ładowane z dysku.
  return typeof url === 'string' && url.startsWith('file://');
}

function openExternal(url) {
  try {
    const u = new URL(url);
    if (['https:', 'http:', 'mailto:', 'tel:'].includes(u.protocol)) shell.openExternal(u.toString());
  } catch {
    // nieprawidłowy adres - ignorujemy
  }
}

function notify({ title, body, onClick }) {
  if (!Notification.isSupported()) {
    if (tray && process.platform === 'win32') tray.displayBalloon({ title, content: body, iconType: 'info' });
    return;
  }
  const n = new Notification({ title, body, icon: path.join(ASSETS, 'icon.png'), silent: false });
  liveNotifications.add(n); // bez referencji GC potrafi zgubić zdarzenie click
  const release = () => liveNotifications.delete(n);
  n.on('click', () => {
    release();
    if (onClick) onClick();
  });
  n.on('close', release);
  n.on('failed', release);
  setTimeout(release, 5 * 60 * 1000).unref();
  n.show();
}

function formatElapsed(ms) {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const mm = String(m).padStart(2, '0');
  const ss = String(s).padStart(2, '0');
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

// ---------------------------------------------------------------- sesja: uprawnienia i dźwięk systemu

function setupSession() {
  const ses = session.defaultSession;
  const MEDIA = new Set(['media', 'display-capture']);
  const HARMLESS = new Set(['clipboard-sanitized-write', 'fullscreen', 'notifications']);

  const allowed = (permission, url) => {
    if (SELF_TEST && isLocalPage(url)) return MEDIA.has(permission);
    if (!isAppOrigin(url)) return false;
    return MEDIA.has(permission) || HARMLESS.has(permission);
  };

  ses.setPermissionRequestHandler((wc, permission, callback, details) => {
    const url = (details && details.requestingUrl) || (wc ? wc.getURL() : '');
    callback(allowed(permission, url));
  });
  ses.setPermissionCheckHandler((wc, permission, requestingOrigin, details) => {
    const url = requestingOrigin || (details && details.requestingUrl) || (wc ? wc.getURL() : '');
    return allowed(permission, url);
  });

  // Bez okna wyboru: odpowiadamy sami - ekran główny + dźwięk systemu (loopback).
  // Wideo jest wymagane przez getDisplayMedia; aplikacja webowa używa tylko ścieżki audio.
  ses.setDisplayMediaRequestHandler(
    (request, callback) => {
      const deny = () => {
        try {
          callback(null);
        } catch {
          // starsze wersje Electrona rzucają przy pustej odpowiedzi - to też jest odmowa
        }
      };
      const requester = request.securityOrigin || (request.frame ? request.frame.url : '');
      const ok = isAppOrigin(requester) || (SELF_TEST && isLocalPage(request.frame ? request.frame.url : requester));
      if (!ok) return deny();
      desktopCapturer
        .getSources({ types: ['screen'], thumbnailSize: { width: 0, height: 0 } })
        .then((sources) => {
          if (!sources.length) return deny();
          const primaryId = String(screen.getPrimaryDisplay().id);
          const source = sources.find((s) => s.display_id === primaryId) || sources[0];
          const streams = { video: source };
          // Loopback działa w Windows i (od macOS 14.2, z NSAudioCaptureUsageDescription) w macOS.
          if (request.audioRequested && process.platform !== 'linux') streams.audio = 'loopback';
          callback(streams);
        })
        .catch((err) => {
          console.error('[notuja] desktopCapturer:', err);
          deny();
        });
    },
    { useSystemPicker: false },
  );
}

// Każda zawartość (okno główne i ewentualne okna potomne) trzyma się dozwolonych adresów.
function guardWebContents(contents) {
  const guard = (event, url) => {
    const origin = originOf(url);
    if (ALLOWED_ORIGINS.has(origin)) return;
    if (isLocalPage(url) && isLocalPage(contents.getURL())) return;
    event.preventDefault();
    openExternal(url);
  };
  contents.on('will-navigate', guard);
  contents.on('will-redirect', guard);
  contents.on('will-attach-webview', (event) => event.preventDefault());
  contents.setWindowOpenHandler(({ url }) => {
    if (isAppOrigin(url)) {
      // Osobne okno, żeby link target=_blank nie przeładował strony w trakcie nagrywania.
      return {
        action: 'allow',
        overrideBrowserWindowOptions: {
          width: 1000,
          height: 760,
          autoHideMenuBar: true,
          icon: path.join(ASSETS, 'icon.png'),
          webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
        },
      };
    }
    openExternal(url);
    return { action: 'deny' };
  });
}

// ---------------------------------------------------------------- okno

function restoredBounds() {
  const b = settings.get('bounds');
  const fallback = { width: 1200, height: 820 };
  if (!b || typeof b.width !== 'number' || typeof b.height !== 'number') return fallback;
  if (typeof b.x !== 'number' || typeof b.y !== 'number') return { width: b.width, height: b.height };
  const area = screen.getDisplayMatching(b).workArea;
  const visible = b.x < area.x + area.width - 80 && b.x + b.width > area.x + 80 && b.y >= area.y - 10 && b.y < area.y + area.height - 80;
  return visible ? { x: b.x, y: b.y, width: b.width, height: b.height } : fallback;
}

function createWindow({ show }) {
  win = new BrowserWindow({
    ...restoredBounds(),
    minWidth: 380,
    minHeight: 560,
    show: false,
    title: 'Notuja',
    backgroundColor: '#ffffff',
    autoHideMenuBar: true,
    icon: path.join(ASSETS, 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: false, // nagrywanie trwa także przy ukrytym oknie
      additionalArguments: [`--notuja-version=${app.getVersion()}`],
    },
  });
  if (settings.get('maximized')) win.maximize();
  if (show) win.once('ready-to-show', () => win && win.show());

  let saveTimer = null;
  const saveBounds = () => {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      if (!win || win.isDestroyed() || win.isMinimized()) return;
      settings.set('maximized', win.isMaximized());
      if (!win.isMaximized() && !win.isFullScreen()) settings.set('bounds', win.getBounds());
    }, 500);
  };
  win.on('resize', saveBounds);
  win.on('move', saveBounds);

  win.on('close', (event) => {
    if (isQuitting) return;
    event.preventDefault();
    win.hide();
    if (!settings.get('closeHintShown')) {
      settings.set('closeHintShown', true);
      notify({
        title: 'Notuja działa w tle',
        body: 'Okno zostało schowane do zasobnika obok zegara. Nagrywanie nie zostaje przerwane. Aby zamknąć aplikację, kliknij ikonę prawym przyciskiem i wybierz „Zakończ”.',
        onClick: showWindow,
      });
    }
  });
  win.on('closed', () => {
    win = null;
  });

  const wc = win.webContents;
  wc.on('did-navigate', () => {
    // Pełne przeładowanie strony: rejestrator zniknął, a nowa strona musi znów zgłosić ready().
    pageReady = false;
    applyState({ recording: false });
  });
  wc.on('did-finish-load', () => {
    loadedAt = Date.now();
    if (activateAfterLoad) {
      activateAfterLoad = false;
      // Aktywacja użytkownika dla strony, która sama startuje nagrywanie z ?teraz=true.
      wc.executeJavaScript('void 0', true).catch(() => {});
    }
  });
  wc.on('did-fail-load', (_e, code, _desc, url, isMainFrame) => {
    if (!isMainFrame || code === -3 || isLocalPage(url)) return; // -3 = przerwane przez kolejną nawigację
    wc.loadFile(path.join(__dirname, 'src', 'offline.html'), { query: { u: `${APP_URL}/app` } }).catch(() => {});
  });
  wc.on('render-process-gone', () => {
    pageReady = false;
    applyState({ recording: false });
  });

  win.loadURL(`${APP_URL}/app`).catch(() => {});
}

function showWindow() {
  if (!win) createWindow({ show: true });
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
}

// ---------------------------------------------------------------- polecenia do strony

function dispatchCommand(cmd) {
  if (!win) return;
  const js = `window.dispatchEvent(new CustomEvent('notuja:command',{detail:${JSON.stringify(cmd)}}))`;
  // userGesture = true: getDisplayMedia wymaga aktywacji użytkownika, a klik w zasobniku jej stronie nie daje.
  win.webContents.executeJavaScript(js, true).catch((err) => console.error('[notuja] polecenie:', err.message));
}

function fallbackLoad(cmd) {
  if (!win) return;
  const query = cmd.source === 'computer' ? '?teraz=true&zrodlo=komputer' : '?teraz=true';
  activateAfterLoad = true;
  win.loadURL(`${APP_URL}/app/nagraj${query}`).catch(() => {
    activateAfterLoad = false;
  });
}

function clearPending() {
  pending = null;
  clearInterval(pendingTimer);
  pendingTimer = null;
}

async function sendCommand(cmd) {
  if (cmd.type === 'record') {
    if (recState.recording) return showWindow();
    showWindow();
    if (macSetup && typeof macSetup.ensureRecordingPermissions === 'function') {
      try {
        await macSetup.ensureRecordingPermissions(win);
      } catch (err) {
        console.error('[notuja] uprawnienia macOS:', err && err.message);
      }
    }
  }
  if (!win) return;
  if (pageReady || cmd.type !== 'record') return dispatchCommand(cmd);

  // Strona jeszcze nie zgłosiła ready(): czekamy 2 s (liczone od końca ładowania),
  // potem zakładamy starszą wersję aplikacji i startujemy przez adres.
  clearPending();
  pending = { cmd, at: Date.now() };
  pendingTimer = setInterval(() => {
    if (!pending || !win) return clearPending();
    const waited = Date.now() - pending.at;
    if (win.webContents.isLoading() && waited < 20000) return;
    if (Date.now() - Math.max(pending.at, loadedAt) < READY_TIMEOUT_MS) return;
    const { cmd: c } = pending;
    clearPending();
    fallbackLoad(c);
  }, 200);
}

function isTrustedSender(event) {
  if (!win || event.sender !== win.webContents) return false;
  const frame = event.senderFrame;
  if (!frame || frame !== win.webContents.mainFrame) return false;
  return isAppOrigin(frame.url) || (SELF_TEST && isLocalPage(frame.url));
}

function setupIpc() {
  ipcMain.on('notuja:ready', (event) => {
    if (!isTrustedSender(event)) return;
    pageReady = true;
    if (pending) {
      const { cmd } = pending;
      clearPending();
      dispatchCommand(cmd);
    }
  });
  ipcMain.on('notuja:state', (event, state) => {
    if (!isTrustedSender(event)) return;
    applyState(state);
  });
}

// ---------------------------------------------------------------- stan nagrywania -> zasobnik

function elapsedNow() {
  return recState.paused ? recFrozenMs : Date.now() - recBase;
}

function applyState(next) {
  const s = next && typeof next === 'object' ? next : {};
  const wasRecording = recState.recording;
  const recording = s.recording === true;
  const paused = recording && s.paused === true;
  const elapsed = typeof s.elapsedMs === 'number' && Number.isFinite(s.elapsedMs) ? Math.max(0, s.elapsedMs) : null;

  if (recording) {
    if (elapsed !== null) {
      recBase = Date.now() - elapsed;
      recFrozenMs = elapsed;
    } else if (!wasRecording) {
      recBase = Date.now();
      recFrozenMs = 0;
    } else if (paused && !recState.paused) {
      recFrozenMs = Date.now() - recBase;
    } else if (!paused && recState.paused) {
      recBase = Date.now() - recFrozenMs;
    }
  }
  recState = { recording, paused, title: typeof s.title === 'string' ? s.title.slice(0, 80) : '' };

  if (recording !== wasRecording) {
    if (recording) {
      // Nagrywanie nigdy nie jest ukryte: to powiadomienie nie ma wyłącznika.
      notify({
        title: 'Notuja nagrywa',
        body: 'Nagrywanie trwa – także po schowaniu okna. Zatrzymasz je w oknie Notui lub z ikony w zasobniku.',
        onClick: showWindow,
      });
      if (sleepBlockId === null) sleepBlockId = powerSaveBlocker.start('prevent-app-suspension');
      tooltipTimer = setInterval(refreshTooltip, 1000);
    } else {
      clearInterval(tooltipTimer);
      tooltipTimer = null;
      if (sleepBlockId !== null) {
        powerSaveBlocker.stop(sleepBlockId);
        sleepBlockId = null;
      }
    }
    refreshTray();
  }
  refreshTooltip();
}

function trayImage(recording) {
  return nativeImage.createFromPath(path.join(ASSETS, recording ? 'tray-rec.png' : 'tray.png'));
}

function refreshTooltip() {
  if (!tray) return;
  if (!recState.recording) return tray.setToolTip('Notuja');
  const label = recState.paused ? 'Nagrywanie wstrzymane' : 'Nagrywanie';
  const title = recState.title ? ` – ${recState.title}` : '';
  tray.setToolTip(`${label} ${formatElapsed(elapsedNow())}${title}`.slice(0, 120));
}

function loginItemOptions() {
  // W wersji deweloperskiej exe to electron.exe, więc trzeba dopisać ścieżkę aplikacji.
  return app.isPackaged ? { args: ['--hidden'] } : { path: process.execPath, args: [app.getAppPath(), '--hidden'] };
}

function buildTrayMenu() {
  const rec = recState.recording;
  const template = [];
  if (rec) {
    template.push({ label: 'Zatrzymaj nagrywanie', click: () => sendCommand({ type: 'stop' }) }, { type: 'separator' });
  }
  template.push(
    {
      label: 'Nagraj spotkanie (dźwięk komputera + mikrofon)',
      enabled: !rec,
      accelerator: settings.get('shortcut') || DEFAULT_SHORTCUT,
      registerAccelerator: false,
      click: () => sendCommand({ type: 'record', source: 'computer' }),
    },
    { label: 'Nagraj tylko mikrofon', enabled: !rec, click: () => sendCommand({ type: 'record', source: 'mic' }) },
    { label: 'Otwórz Notuję', click: showWindow },
    { type: 'separator' },
    {
      label: 'Uruchamiaj przy starcie systemu',
      type: 'checkbox',
      checked: app.getLoginItemSettings(loginItemOptions()).openAtLogin,
      click: (item) => {
        app.setLoginItemSettings({ openAtLogin: item.checked, ...loginItemOptions() });
        refreshTray();
      },
    },
    {
      label: 'Pytaj, gdy zacznie się spotkanie',
      type: 'checkbox',
      checked: settings.get('askOnMeeting') !== false,
      enabled: detector !== null,
      click: (item) => {
        settings.set('askOnMeeting', item.checked);
        refreshTray();
      },
    },
    { type: 'separator' },
    { label: 'Zakończ', click: quitApp },
  );
  return Menu.buildFromTemplate(template);
}

function refreshTray() {
  if (!tray) return;
  tray.setImage(trayImage(recState.recording));
  tray.setContextMenu(buildTrayMenu());
}

function createTray() {
  tray = new Tray(trayImage(false));
  tray.on('click', showWindow);
  refreshTray();
  refreshTooltip();
}

async function quitApp() {
  if (recState.recording) {
    const opts = {
      type: 'warning',
      buttons: ['Anuluj', 'Zakończ mimo to'],
      defaultId: 0,
      cancelId: 0,
      title: 'Notuja',
      message: 'Trwa nagrywanie',
      detail: 'Zamknięcie aplikacji przerwie nagrywanie i możesz stracić nagranie. Najpierw zatrzymaj je w oknie Notui.',
    };
    const visible = win && win.isVisible() ? win : null;
    const { response } = visible ? await dialog.showMessageBox(visible, opts) : await dialog.showMessageBox(opts);
    if (response !== 1) return;
  }
  isQuitting = true;
  app.quit();
}

// ---------------------------------------------------------------- wykrywanie spotkań

function setupDetector() {
  try {
    const mod = require(`./src/detect-${IS_MAC ? 'mac' : 'win'}.cjs`);
    detector = mod.createMeetingDetector({
      onStart(info) {
        if (settings.get('askOnMeeting') === false || recState.recording) return;
        const name = info && typeof info.app === 'string' && info.app ? ` (${info.app})` : '';
        // Tylko pytanie. Nagrywanie rusza dopiero po kliknięciu przez użytkownika.
        notify({
          title: 'Notuja',
          body: `Wygląda na to, że zaczęło się spotkanie${name}. Nagrać?`,
          onClick: () => sendCommand({ type: 'record', source: 'computer' }),
        });
      },
      onEnd() {},
    });
    detector.start();
  } catch (err) {
    detector = null; // brak detektora = funkcja po cichu wyłączona
    if (err && err.code !== 'MODULE_NOT_FOUND') console.error('[notuja] detektor spotkań:', err.message);
  }
}

// ---------------------------------------------------------------- self-test

async function runSelfTest() {
  const result = { displayAudioTracks: 0, displayVideoTracks: 0, mic: false, error: null };
  const finish = (code) => {
    process.stdout.write(JSON.stringify(result) + '\n');
    setTimeout(() => app.exit(code), 100);
  };
  const timeout = setTimeout(() => {
    result.error = 'timeout';
    finish(1);
  }, 45000);
  try {
    setupSession();
    setupIpc();
    win = new BrowserWindow({
      show: false,
      width: 480,
      height: 320,
      webPreferences: {
        preload: path.join(__dirname, 'preload.cjs'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        backgroundThrottling: false,
        additionalArguments: [`--notuja-version=${app.getVersion()}`],
      },
    });
    const wc = win.webContents;
    await win.loadFile(path.join(__dirname, 'selftest', 'index.html'));

    // Test nagrania: `--self-test --capture-test=12000 --tones=880,1320` — nagrywa dźwięk systemu do pliku i sprawdza,
    // czy są w nim tony grane w tym czasie przez inne programy (wynik: głośność i siła tonów sekunda po sekundzie).
    const captureArg = process.argv.find((a) => a.startsWith('--capture-test'));
    if (captureArg) {
      const ms = Number(captureArg.split('=')[1]) || 10000;
      const tones = ((process.argv.find((a) => a.startsWith('--tones=')) || '').split('=')[1] || '880,1320').split(',').map(Number).filter(Boolean);
      clearTimeout(timeout);
      const capture = await wc.executeJavaScript(`runCapture(${ms}, ${JSON.stringify(tones)})`, true);
      process.stdout.write(JSON.stringify(capture) + '\n');
      setTimeout(() => app.exit(capture.ok ? 0 : 1), 100);
      return;
    }

    // 1) bez flagi userGesture - czy Electron w ogóle wymusza aktywację użytkownika?
    const noGesture = await wc.executeJavaScript('runDisplay(false)', false);
    result.withoutUserGesture = noGesture.ok ? 'ok' : noGesture.error;
    // 2) z flagą userGesture - tak powłoka wysyła polecenia z zasobnika.
    const display = await wc.executeJavaScript('runDisplay(true)', true);
    result.displayAudioTracks = display.audio;
    result.displayVideoTracks = display.video;
    result.loopbackSignal = display.signal;
    if (!display.ok) result.error = display.error;

    const mic = await wc.executeJavaScript('runMic()', true);
    result.mic = mic.ok;
    if (!mic.ok) result.micError = mic.error;

    // 3) most: zdarzenie DOM -> onCommand, dokładnie tą samą drogą co w aplikacji.
    const bridge = wc.executeJavaScript('runBridge()', false);
    await new Promise((r) => setTimeout(r, 300));
    dispatchCommand({ type: 'record', source: 'computer' });
    result.bridge = await bridge;
    result.readyReceived = pageReady;
  } catch (err) {
    result.error = String((err && err.message) || err);
  }
  clearTimeout(timeout);
  finish(result.error === null && result.displayAudioTracks > 0 ? 0 : 1);
}

// ---------------------------------------------------------------- start

function main() {
  app.setAppUserModelId(app.isPackaged ? APP_ID : process.execPath);

  if (SELF_TEST) {
    app.whenReady().then(runSelfTest);
    app.on('window-all-closed', () => {});
    return;
  }

  if (!app.requestSingleInstanceLock()) {
    app.quit();
    return;
  }
  app.on('second-instance', showWindow);
  app.on('web-contents-created', (_e, contents) => guardWebContents(contents));
  app.on('window-all-closed', () => {}); // aplikacja żyje w zasobniku
  app.on('before-quit', () => {
    isQuitting = true;
  });
  app.on('will-quit', () => {
    globalShortcut.unregisterAll();
    if (detector) detector.stop();
  });
  app.on('activate', showWindow); // macOS: klik w Docku

  app.whenReady().then(() => {
    settings = createSettings(app.getPath('userData'));
    if (!IS_MAC) Menu.setApplicationMenu(null);
    setupSession();
    setupIpc();
    setupDetector();
    createTray();
    createWindow({ show: !START_HIDDEN });

    const shortcut = settings.get('shortcut') || DEFAULT_SHORTCUT;
    let registered = false;
    try {
      registered = globalShortcut.register(shortcut, () => sendCommand({ type: 'record', source: 'computer' }));
    } catch {
      registered = false;
    }
    if (!registered) console.error(`[notuja] skrót ${shortcut} jest zajęty lub nieprawidłowy - pominięty`);
  });
}

main();

// Wykrywanie spotkań w Windows: aplikacja, która w rejestrze zgód mikrofonu ma
// LastUsedTimeStop = 0, używa mikrofonu w tej chwili. Tylko odczyt (`reg query`).
'use strict';
const { execFile } = require('node:child_process');
const path = require('node:path');

const KEY = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\CapabilityAccessManager\\ConsentStore\\microphone';
const POLL_MS = 5000;
const CONFIRM_POLLS = 2; // ile kolejnych odczytów musi potwierdzić zmianę

// Kolejność ma znaczenie: pierwsze trafienie wygrywa.
const KNOWN = [
  [/webview2/, null], // osadzony silnik wielu aplikacji - bez nazwy nie zgadujemy
  [/teams/, 'Teams'],
  [/zoom/, 'Zoom'],
  [/webex|ciscocollab|atmgr/, 'Webex'],
  [/slack/, 'Slack'],
  [/discord/, 'Discord'],
  [/skype/, 'Skype'],
  [/chrome|msedge|microsoftedge|firefox|brave|opera|vivaldi/, 'przeglądarka'],
];

function labelFor(name) {
  const lower = name.toLowerCase();
  for (const [re, label] of KNOWN) if (re.test(lower)) return label;
  return null;
}

/** Zwraca Map<nazwaKlucza, etykieta> aplikacji, które teraz używają mikrofonu. */
function parseActive(stdout, ownExe) {
  const active = new Map();
  let current = null;
  for (const line of stdout.split(/\r?\n/)) {
    if (/^HKEY_/i.test(line)) {
      const idx = line.toLowerCase().lastIndexOf('\\microphone\\');
      current = idx === -1 ? null : line.slice(idx + '\\microphone\\'.length).replace(/^NonPackaged\\?/i, '');
      continue;
    }
    if (!current) continue;
    const m = /^\s+LastUsedTimeStop\s+REG_QWORD\s+(0x[0-9a-f]+|\d+)/i.exec(line);
    if (!m || Number(m[1]) !== 0) continue;
    const lower = current.toLowerCase();
    if (lower.includes('notuja') || (ownExe && lower.endsWith(ownExe))) continue;
    const label = labelFor(current);
    if (label) active.set(current, label);
  }
  return active;
}

function createMeetingDetector({ onStart, onEnd }) {
  const ownExe = path.basename(process.execPath).toLowerCase();
  let timer = null;
  let busy = false;
  let baseline = null; // wpisy aktywne już przy starcie (trwające spotkanie albo śmieci po awarii)
  let inMeeting = false;
  let hits = 0;
  let misses = 0;

  function evaluate(active) {
    if (baseline === null) {
      baseline = new Set(active.keys());
      return;
    }
    for (const key of baseline) if (!active.has(key)) baseline.delete(key);
    const labels = [...active].filter(([key]) => !baseline.has(key)).map(([, label]) => label);

    if (labels.length > 0) {
      hits += 1;
      misses = 0;
      if (!inMeeting && hits >= CONFIRM_POLLS) {
        inMeeting = true;
        const app = labels.find((l) => l !== 'przeglądarka') || labels[0];
        try {
          onStart && onStart({ app });
        } catch (err) {
          console.error('[notuja] detektor/onStart:', err);
        }
      }
    } else {
      misses += 1;
      hits = 0;
      if (inMeeting && misses >= CONFIRM_POLLS) {
        inMeeting = false;
        try {
          onEnd && onEnd();
        } catch (err) {
          console.error('[notuja] detektor/onEnd:', err);
        }
      }
    }
  }

  function poll() {
    if (busy) return;
    busy = true;
    execFile('reg', ['query', KEY, '/s'], { windowsHide: true, timeout: 4000, maxBuffer: 8 * 1024 * 1024 }, (err, stdout) => {
      busy = false;
      if (err || !timer) return; // błąd odczytu = pomijamy ten cykl
      evaluate(parseActive(String(stdout), ownExe));
    });
  }

  return {
    start() {
      if (timer || process.platform !== 'win32') return;
      timer = setInterval(poll, POLL_MS);
      if (timer.unref) timer.unref();
      poll();
    },
    stop() {
      if (timer) clearInterval(timer);
      timer = null;
      baseline = null;
      inMeeting = false;
      hits = 0;
      misses = 0;
    },
  };
}

module.exports = { createMeetingDetector, parseActive, labelFor };

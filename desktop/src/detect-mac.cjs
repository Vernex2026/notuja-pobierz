// Wykrywanie spotkań w macOS bez modułów natywnych: co 5 s czytamy listę procesów (`ps`)
// i blokady usypiania (`pmset -g assertions`). Tylko odczyt, bez uprawnień administratora.
//
// UWAGA: nic z tego pliku nie zostało uruchomione na Macu. Stan wiedzy o sygnałach:
//  [udokumentowane] `ps -axo pid=,comm=` i `pmset -g assertions` istnieją w każdym macOS
//                   i nie wymagają uprawnień; `pmset` wypisuje blokady z nazwą i procesem.
//  [założenie]      Zoom uruchamia proces `CptHost` tylko na czas spotkania.
//  [założenie]      Silnik Chromium (Chrome, Edge, Brave, Arc, a także Slack, Discord, Teams)
//                   trzyma podczas rozmowy blokadę o nazwie "WebRTC has active PeerConnections".
//  [założenie]      Teams, Webex, FaceTime i Zoom trzymają w trakcie rozmowy blokadę usypiania
//                   ekranu (np. "Microsoft Teams Call in progress").
//  [założenie]      coreaudiod tworzy blokadę z dopiskiem "Created for PID: N" dla procesu,
//                   który używa wejścia audio, a jej nazwa zawiera "input" albo "microphone".
// Odrzucone: `log stream` z com.apple.controlcenter (format zmienia się między wersjami systemu,
// wymaga konta administratora) i `ioreg` IOAudioEngineState (nie działa na Apple Silicon).
// Gdy polecenia zawodzą kilka razy z rzędu, detektor wyłącza się sam.
'use strict';
const { execFile } = require('node:child_process');

const POLL_MS = 5000;
const CONFIRM_POLLS = 2; // ile kolejnych odczytów musi potwierdzić zmianę
const MAX_FAILS = 6; // tyle nieudanych odczytów z rzędu wyłącza detektor
const BROWSER = 'przeglądarka';
const UNKNOWN = 'spotkanie';

// Kolejność ma znaczenie: pierwsze trafienie wygrywa. null = ignoruj.
const KNOWN = [
  [/voice ?memos|quicktime|garageband|logic pro|audacity|obs\.app|screenflow|audio hijack|loopback\.app/, null],
  [/microsoft teams|msteams/, 'Teams'],
  [/zoom\.us|cpthost/, 'Zoom'],
  [/webex/, 'Webex'],
  [/slack/, 'Slack'],
  [/discord/, 'Discord'],
  [/skype/, 'Skype'],
  [/facetime/, 'FaceTime'],
  [/whatsapp/, 'WhatsApp'],
  [/google chrome|chromium|microsoft edge|safari|com\.apple\.webkit|firefox|brave browser|\/arc\.app\/|opera|vivaldi/, BROWSER],
];
const DEDICATED = new Set(['Teams', 'Zoom', 'Webex', 'FaceTime']);
const SYSTEM_PATH = /^\/(system|usr|sbin|bin|library\/apple)\//;
const CALL_NAME = /webrtc has active peerconnections|call in progress|in a call|meeting in progress|huddle/i;
const INPUT_NAME = /input|microphone/i;
const DISPLAY_TYPE = /^(PreventUserIdleDisplaySleep|NoDisplaySleepAssertion)$/;

/** Etykieta dla ścieżki procesu; null = nie liczymy tego procesu. */
function labelFor(procPath) {
  const lower = String(procPath || '').toLowerCase();
  if (!lower) return null;
  for (const [re, label] of KNOWN) if (re.test(lower)) return label;
  if (SYSTEM_PATH.test(lower)) return null; // Siri, dyktowanie i inne usługi systemu
  return UNKNOWN;
}

/** `ps -axo pid=,comm=` -> Map<pid, ścieżka programu>. */
function parseProcesses(stdout) {
  const procs = new Map();
  for (const line of String(stdout || '').split(/\r?\n/)) {
    const m = /^\s*(\d+)\s+(.+?)\s*$/.exec(line);
    if (m) procs.set(Number(m[1]), m[2]);
  }
  return procs;
}

/** `pmset -g assertions` -> [{ pid, owner, type, name, forPid }]. */
function parseAssertions(stdout) {
  const list = [];
  let last = null;
  for (const line of String(stdout || '').split(/\r?\n/)) {
    const m = /^\s*pid (\d+)\((.*?)\): \[[^\]]*\] \S+ (\S+) named: "(.*)"/.exec(line);
    if (m) {
      last = { pid: Number(m[1]), owner: m[2], type: m[3], name: m[4], forPid: null };
      list.push(last);
      continue;
    }
    const created = /Created for PID: (\d+)/.exec(line);
    if (created && last) last.forPid = Number(created[1]);
    else if (/^\S/.test(line)) last = null; // nowa sekcja wydruku
  }
  return list;
}

/** Zwraca Map<klucz, etykieta> sygnałów "trwa rozmowa". */
function collectSignals(procs, assertions, isOwn) {
  const signals = new Map();

  for (const [pid, procPath] of procs) {
    if (/(^|\/)CptHost$/.test(procPath) && !isOwn(pid, procPath)) signals.set('proc:CptHost', 'Zoom');
  }

  for (const a of assertions) {
    const viaAudio = a.owner === 'coreaudiod';
    if (viaAudio && !(a.forPid && INPUT_NAME.test(a.name))) continue;
    const pid = viaAudio ? a.forPid : a.pid;
    const procPath = procs.get(pid) || (viaAudio ? '' : a.owner);
    if (isOwn(pid, procPath)) continue;
    const label = labelFor(procPath);
    if (!label) continue;
    const inCall = viaAudio || CALL_NAME.test(a.name) || (DEDICATED.has(label) && DISPLAY_TYPE.test(a.type));
    if (inCall) signals.set(`pid:${pid}:${label}`, label);
  }
  return signals;
}

function run(file, args, done) {
  let finished = false;
  const finish = (err, stdout) => {
    if (finished) return;
    finished = true;
    done(err, String(stdout || ''));
  };
  try {
    execFile(
      file,
      args,
      { timeout: 4000, maxBuffer: 8 * 1024 * 1024, env: { ...process.env, LC_ALL: 'C' } },
      (err, stdout) => finish(err, stdout),
    );
  } catch (err) {
    finish(err, '');
  }
}

function createMeetingDetector({ onStart, onEnd } = {}) {
  const exec = String(process.execPath || '');
  const appEnd = exec.indexOf('.app/');
  const ownBundle = appEnd === -1 ? null : exec.slice(0, appEnd + 5);
  const isOwn = (pid, procPath) =>
    pid === process.pid || /notuja/i.test(procPath) || Boolean(ownBundle && procPath.startsWith(ownBundle));

  let timer = null;
  let busy = false;
  let fails = 0;
  let baseline = null; // sygnały obecne już przy starcie (trwające spotkanie)
  let inMeeting = false;
  let hits = 0;
  let misses = 0;

  function emit(fn, arg) {
    try {
      if (typeof fn === 'function') fn(arg);
    } catch (err) {
      console.error('[notuja] detektor:', err);
    }
  }

  function evaluate(signals) {
    if (baseline === null) {
      baseline = new Set(signals.keys());
      return;
    }
    for (const key of baseline) if (!signals.has(key)) baseline.delete(key);
    const labels = [...signals].filter(([key]) => !baseline.has(key)).map(([, label]) => label);

    if (labels.length > 0) {
      hits += 1;
      misses = 0;
      if (!inMeeting && hits >= CONFIRM_POLLS) {
        inMeeting = true;
        const app =
          labels.find((l) => l !== BROWSER && l !== UNKNOWN) || labels.find((l) => l !== UNKNOWN) || labels[0];
        emit(onStart, { app });
      }
    } else {
      misses += 1;
      hits = 0;
      if (inMeeting && misses >= CONFIRM_POLLS) {
        inMeeting = false;
        emit(onEnd);
      }
    }
  }

  function stop() {
    if (timer) clearInterval(timer);
    timer = null;
    baseline = null;
    inMeeting = false;
    hits = 0;
    misses = 0;
  }

  function poll() {
    if (busy || !timer) return;
    busy = true;
    run('/bin/ps', ['-axo', 'pid=,comm='], (psErr, psOut) => {
      run('/usr/bin/pmset', ['-g', 'assertions'], (pmErr, pmOut) => {
        busy = false;
        if (!timer) return;
        try {
          if (psErr) {
            // Bez listy procesów nie odróżnimy własnej aplikacji - pomijamy cykl.
            fails += 1;
            if (fails >= MAX_FAILS) stop();
            return;
          }
          fails = 0;
          const assertions = pmErr ? [] : parseAssertions(pmOut);
          evaluate(collectSignals(parseProcesses(psOut), assertions, isOwn));
        } catch (err) {
          console.error('[notuja] detektor:', err);
        }
      });
    });
  }

  return {
    start() {
      try {
        if (timer || process.platform !== 'darwin') return;
        fails = 0;
        timer = setInterval(poll, POLL_MS);
        if (timer.unref) timer.unref();
        poll();
      } catch (err) {
        console.error('[notuja] detektor:', err);
      }
    },
    stop,
  };
}

module.exports = { createMeetingDetector, parseProcesses, parseAssertions, collectSignals, labelFor };

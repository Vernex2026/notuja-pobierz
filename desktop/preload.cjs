// Most między aplikacją webową a powłoką: window.notujaDesktop.
// Polecenia docierają do strony jako zdarzenie DOM `notuja:command` (wysyłane
// przez proces główny z gestem użytkownika); onCommand słucha tego samego zdarzenia.
'use strict';
const { contextBridge, ipcRenderer } = require('electron');

const versionArg = process.argv.find((a) => a.startsWith('--notuja-version='));
const version = versionArg ? versionArg.slice('--notuja-version='.length) : '';

function cleanState(state) {
  const s = state && typeof state === 'object' ? state : {};
  const out = { recording: s.recording === true };
  if (typeof s.paused === 'boolean') out.paused = s.paused;
  if (typeof s.elapsedMs === 'number' && Number.isFinite(s.elapsedMs)) out.elapsedMs = Math.max(0, s.elapsedMs);
  if (typeof s.title === 'string') out.title = s.title.slice(0, 200);
  return out;
}

contextBridge.exposeInMainWorld('notujaDesktop', {
  isDesktop: true,
  platform: process.platform,
  version,
  onCommand(cb) {
    if (typeof cb !== 'function') return () => {};
    const handler = (event) => {
      const d = event && event.detail;
      if (!d || typeof d.type !== 'string') return;
      cb(d.type === 'record' ? { type: 'record', source: d.source === 'mic' ? 'mic' : 'computer' } : { type: d.type });
    };
    window.addEventListener('notuja:command', handler);
    return () => window.removeEventListener('notuja:command', handler);
  },
  setState(state) {
    ipcRenderer.send('notuja:state', cleanState(state));
  },
  ready() {
    ipcRenderer.send('notuja:ready');
  },
});

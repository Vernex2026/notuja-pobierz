// Małe ustawienia w pliku JSON w katalogu userData.
'use strict';
const fs = require('node:fs');
const path = require('node:path');

const DEFAULTS = {
  askOnMeeting: true,
  closeHintShown: false,
  bounds: null,
  shortcut: null, // null = domyślny skrót dla platformy
};

function createSettings(dir) {
  const file = path.join(dir, 'settings.json');
  let data = { ...DEFAULTS };
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (parsed && typeof parsed === 'object') data = { ...DEFAULTS, ...parsed };
  } catch {
    // brak pliku lub uszkodzony JSON - zostają wartości domyślne
  }

  function save() {
    try {
      fs.mkdirSync(dir, { recursive: true });
      const tmp = file + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
      fs.renameSync(tmp, file);
    } catch (err) {
      console.error('[notuja] nie udało się zapisać ustawień:', err.message);
    }
  }

  return {
    get: (key) => data[key],
    set(key, value) {
      data[key] = value;
      save();
    },
  };
}

module.exports = { createSettings };

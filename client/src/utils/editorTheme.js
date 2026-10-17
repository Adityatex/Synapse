import { readStorage, writeStorage } from './storage';

// Editor theme (room and solo editor). Light is the default; a choice made
// with the toggle is remembered. The key changed when light became the
// default, so an old saved 'dark' (which was only the previous default)
// doesn't carry over.
const KEY = 'synapse-editor-theme';

export function readEditorTheme() {
  const saved = readStorage(KEY);
  return saved === 'dark' || saved === 'light' ? saved : 'light';
}

export function saveEditorTheme(theme) {
  writeStorage(KEY, theme);
}

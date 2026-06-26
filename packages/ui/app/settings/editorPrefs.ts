const STORAGE_KEY = 'editor-auto-save';

export type AutoSaveMode = 'afterDelay' | 'off';

export function getAutoSaveMode(): AutoSaveMode {
  if (typeof localStorage === 'undefined') return 'afterDelay';
  const v = localStorage.getItem(STORAGE_KEY);
  if (v === 'off') return 'off';
  return 'afterDelay';
}

export function setAutoSaveMode(mode: AutoSaveMode): void {
  if (typeof localStorage === 'undefined') return;
  localStorage.setItem(STORAGE_KEY, mode);
}

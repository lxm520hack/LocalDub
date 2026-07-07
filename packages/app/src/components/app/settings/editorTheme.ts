import type { MonacoTheme } from 'monaco-themes';

const STORAGE_KEY = 'editor-theme';

// Themes available from monaco-themes
export const EDITOR_THEMES = [
  { value: 'Dracula', label: 'Dracula' },
  { value: 'GitHub Dark', label: 'GitHub Dark' },
  { value: 'GitHub Light', label: 'GitHub Light' },
  { value: 'One Dark Pro', label: 'One Dark Pro' },
  { value: 'Monokai', label: 'Monokai' },
  { value: 'Solarized-dark', label: 'Solarized Dark' },
  { value: 'Solarized-light', label: 'Solarized Light' },
  { value: 'Night Owl', label: 'Night Owl' },
  { value: 'Ayu-dark', label: 'Ayu Dark' },
  { value: 'Ayu-light', label: 'Ayu Light' },
  { value: 'Nord', label: 'Nord' },
  { value: 'Palenight', label: 'Palenight' },
  { value: 'Material Palenight', label: 'Material Palenight' },
] as const;

export type EditorThemeName = (typeof EDITOR_THEMES)[number]['value'];

export function getEditorTheme(): EditorThemeName {
  if (typeof localStorage === 'undefined') return 'Dracula';
  return (localStorage.getItem(STORAGE_KEY) as EditorThemeName) || 'Dracula';
}

export function setEditorTheme(theme: string): void {
  if (typeof localStorage === 'undefined') return;
  localStorage.setItem(STORAGE_KEY, theme);
}

export async function loadEditorTheme(monaco: typeof import('monaco-editor'), themeName: string) {
  try {
    const themes = await import('monaco-themes/themes/themelist')
    type themeKey = keyof typeof themes;
    const themeLabel = themes[themeName as themeKey];
    const themeData: MonacoTheme | undefined = await import(`monaco-themes/themes/${themeLabel}.json`)
    if (themeData) {
      monaco.editor.defineTheme(themeName, themeData);
      monaco.editor.setTheme(themeName);
    }
  } catch {
    monaco.editor.setTheme('vs-dark');
  }
}

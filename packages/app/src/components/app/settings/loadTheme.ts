import type { editor } from 'monaco-editor';

type MonacoThemeData = editor.IStandaloneThemeData;

const BUILT_IN: Record<string, MonacoThemeData> = {
  'catppuccin-macchiato': {
    base: 'vs-dark',
    inherit: true,
    rules: [
      { token: '', background: '24273a' },
      { token: 'comment', foreground: '5b6078', fontStyle: 'italic' },
      { token: 'string', foreground: 'a6da95' },
      { token: 'string.key.json', foreground: 'a6da95' },
      { token: 'string.value.json', foreground: 'cad3f5' },
      { token: 'number', foreground: 'f5a97f' },
      { token: 'keyword', foreground: 'ed8796' },
      { token: 'type', foreground: 'c6a0f6' },
      { token: 'tag', foreground: '8aadf4' },
    ],
    colors: {
      'editor.background': '#24273a',
      'editor.foreground': '#cad3f5',
      'editor.lineHighlightBackground': '#363a4f',
      'editor.selectionBackground': '#494d64',
      'editorCursor.foreground': '#8aadf4',
      'editorLineNumber.foreground': '#6e738d',
      'editorLineNumber.activeForeground': '#939ab7',
      'editorIndentGuide.background': '#363a4f',
      'editorIndentGuide.activeBackground': '#5b6078',
      'editorWidget.background': '#1e2030',
      'editorWidget.border': '#363a4f',
      'input.background': '#363a4f',
      'input.foreground': '#cad3f5',
      'list.activeSelectionBackground': '#363a4f',
      'list.hoverBackground': '#363a4f',
    },
  },
  'catppuccin-latte': {
    base: 'vs',
    inherit: true,
    rules: [
      { token: '', background: 'eff1f5' },
      { token: 'comment', foreground: 'acb0be', fontStyle: 'italic' },
      { token: 'string', foreground: '40a02b' },
      { token: 'string.key.json', foreground: '40a02b' },
      { token: 'string.value.json', foreground: '4c4f69' },
      { token: 'number', foreground: 'fe640b' },
      { token: 'keyword', foreground: 'd20f39' },
      { token: 'type', foreground: '8839ef' },
      { token: 'tag', foreground: '1e66f5' },
    ],
    colors: {
      'editor.background': '#eff1f5',
      'editor.foreground': '#4c4f69',
      'editor.lineHighlightBackground': '#ccd0da',
      'editor.selectionBackground': '#bcc0cc',
      'editorCursor.foreground': '#1e66f5',
      'editorLineNumber.foreground': '#9ca0b0',
      'editorLineNumber.activeForeground': '#7c7f93',
      'editorIndentGuide.background': '#ccd0da',
      'editorIndentGuide.activeBackground': '#acb0be',
      'editorWidget.background': '#e6e9ef',
      'editorWidget.border': '#ccd0da',
      'input.background': '#ccd0da',
      'input.foreground': '#4c4f69',
      'list.activeSelectionBackground': '#ccd0da',
      'list.hoverBackground': '#ccd0da',
    },
  },
};

// Pre-loaded theme data from monaco-themes
const themeModules = import.meta.glob<{ default: MonacoThemeData }>(
  '../../node_modules/monaco-themes/themes/*.json',
  { eager: false },
);

export async function loadMonacoTheme(monaco: typeof import('monaco-editor'), themeFile: string, themeValue: string) {
  // Built-in themes first (Catppuccin)
  if (BUILT_IN[themeValue]) {
    monaco.editor.defineTheme(themeValue, BUILT_IN[themeValue]);
    return;
  }

  // Try loading from monaco-themes package
  for (const [path, loader] of Object.entries(themeModules)) {
    if (path.includes(themeFile)) {
      try {
        const mod = await loader();
        const data = (mod as any).default || mod;
        monaco.editor.defineTheme(themeValue, data as MonacoThemeData);
        return;
      } catch { /* fallback */ }
    }
  }
  monaco.editor.setTheme('vs-dark');
}

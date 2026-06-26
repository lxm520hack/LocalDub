import { onMount, onCleanup } from 'solid-js';
import { useClientApi } from '../api/context';
import { getAutoSaveMode } from './editorPrefs';
import { useTheme } from '@repo/ui-solid/theme';

const AUTO_SAVE_DELAY = 2000;

export function InputEditor() {
  const api = useClientApi().inputEditorApi;
  const { themeName } = useTheme();
  let containerRef: HTMLDivElement | undefined;
  let editor: any = null;
  let model: any = null;
  let autoSaveTimer: ReturnType<typeof setTimeout> | undefined;

  const debouncedSave = (content: string) => {
    clearTimeout(autoSaveTimer);
    autoSaveTimer = setTimeout(async () => {
      if (!api) return;
      try {
        JSON.parse(content);
        await api.writeInput(content);
      } catch { /* silent */ }
    }, AUTO_SAVE_DELAY);
  };

  onMount(async () => {
    if (!api || !containerRef) return;

    const [fileContent, schemaContent] = await Promise.all([
      api.readInput(),
      api.readInputSchema().catch(() => '{}'),
    ]);

    const monaco = await import('monaco-editor');

    // Configure workers for JSON language features
    (self as any).MonacoEnvironment = {
      getWorker: async (_: string, label: string) => {
        if (label === 'json') {
          const mod = await import('monaco-editor/esm/vs/language/json/json.worker?worker');
          return new mod.default();
        }
        const mod = await import('monaco-editor/esm/vs/editor/editor.worker?worker');
        return new mod.default();
      },
    };

    // Register JSON schema
    let schemaObj: any;
    try { schemaObj = JSON.parse(schemaContent); } catch { schemaObj = null; }

    if (schemaObj && (monaco.languages.json as any)?.jsonDefaults) {
      (monaco.languages.json as any).jsonDefaults.setDiagnosticsOptions({
        allowComments: true,
        validate: true,
        schemas: [{
          uri: 'inmemory://input.schema.json',
          fileMatch: ['*'],
          schema: schemaObj,
        }],
      });
    }

    // Load Monaco theme matching the current app theme
    const { themeByName } = await import('@repo/ui-solid/theme/defs');
    const { loadMonacoTheme } = await import('./loadTheme');
    const def = themeByName(themeName());
    let monacoTheme = 'vs-dark';
    if (def) {
      try {
        const themeFile = def.monacoTheme.replace(/[\\/:"*?<>|]/g, '_');
        await loadMonacoTheme(monaco, themeFile, def.value);
        monacoTheme = def.value;
      } catch { /* fallback */ }
    }

    // Create the editor
    model = monaco.editor.createModel(fileContent, 'json');
    editor = monaco.editor.create(containerRef, {
      model,
      language: 'json',
      theme: monacoTheme,
      automaticLayout: true,
      fontSize: 13,
      minimap: { enabled: false },
      scrollBeyondLastLine: false,
      padding: { top: 8 },
      tabSize: 2,
      quickSuggestions: true,
      wordWrap: 'on',
    });

    // Auto-save on content change
    const autoSaveMode = getAutoSaveMode();
    editor.onDidChangeModelContent(() => {
      if (autoSaveMode === 'afterDelay') {
        debouncedSave(editor.getValue());
      }
    });
  });

  onCleanup(() => {
    clearTimeout(autoSaveTimer);
    editor?.dispose();
    model?.dispose();
  });

  const handleSave = async () => {
    if (!api || !editor) return;
    const content = editor.getValue();
    try {
      JSON.parse(content);
      await api.writeInput(content);
      clearTimeout(autoSaveTimer);
    } catch {
      alert('Invalid JSON');
    }
  };

  if (!api) return null;

  return (
    <div class="space-y-3">
      <div ref={containerRef} class="border border-gray-700 rounded-lg overflow-hidden" style="height: 500px" />
      <div class="flex gap-2">
        <button
          onClick={handleSave}
          class="px-4 py-1.5 text-sm font-medium rounded-lg bg-green-600 hover:bg-green-500 text-white"
        >
          Save
        </button>
      </div>
    </div>
  );
}

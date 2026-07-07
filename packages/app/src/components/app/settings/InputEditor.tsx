import { createSignal, onMount, onCleanup } from 'solid-js';
import { getAutoSaveMode } from './editorPrefs';
import { useTheme } from '@repo/ui-solid/theme';
import { readInput, readInputSchema } from '#/fn/input.ts';
import { rspc } from '#/integrations/rspc/rspc.ts';

const AUTO_SAVE_DELAY = 2000;

export function InputEditor() {
  const { themeName } = useTheme();
  let containerRef: HTMLDivElement | undefined;
  let editor: any = null;
  let model: any = null;
  let autoSaveTimer: ReturnType<typeof setTimeout> | undefined;
  let lastSavedContent = '';
  const [dirty, setDirty] = createSignal(false);

  const updateDirty = () => {
    if (!editor) return;
    setDirty(editor.getValue() !== lastSavedContent);
  };
  const writeInputM = rspc.createMutation(() => "writeInput")

  const doSave = async () => {
    if ( !editor) return;
    const content = editor.getValue();
    try {
      JSON.parse(content);
      await writeInputM.mutateAsync(content);
      clearTimeout(autoSaveTimer);
      lastSavedContent = content;
      setDirty(false);
    } catch {
      alert('Invalid JSON');
    }
  };

  const debouncedSave = (content: string) => {
    clearTimeout(autoSaveTimer);
    autoSaveTimer = setTimeout(async () => {
      try {
        JSON.parse(content);
        await writeInputM.mutateAsync(content);
        lastSavedContent = content;
        setDirty(false);
      } catch { /* silent */ }
    }, AUTO_SAVE_DELAY);
  };
  const readInputQ = rspc.createQuery(()=>['readInput', null])
  const schemaContentQ = rspc.createQuery(()=>['readInputSchema', null])
  onMount(async () => {
    if (!containerRef) return;


    lastSavedContent = readInputQ.data ?? '{}';

    const monaco = await import('monaco-editor');

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

    let schemaObj: any;
    try { schemaObj = JSON.parse(schemaContentQ.data??"{}"); } catch { schemaObj = null; }

    const SCHEMA_URI = 'file:///packages/cli/input.schema.json';
    if (schemaObj && (monaco.languages.json as any)?.jsonDefaults) {
      (monaco.languages.json as any).jsonDefaults.setDiagnosticsOptions({
        validate: true,
        allowComments: true,
        schemas: [{ uri: SCHEMA_URI, schema: schemaObj }],
      });
    }

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

    model = monaco.editor.createModel(readInputQ.data ?? "", 'json', monaco.Uri.parse('file:///packages/cli/input.json'));
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

    const autoSaveMode = getAutoSaveMode();
    editor.onDidChangeModelContent(() => {
      updateDirty();
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


  return (
    <div class="flex flex-col h-full">
      <div class="flex items-center gap-2 px-3 py-1.5 text-sm border-b  rounded-t-lg select-none">
        <svg class="w-3.5 h-3.5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z" />
          <polyline points="14 2 14 8 20 8" />
        </svg>
        <span>input.json</span>
        <span
          class="text-sm cursor-pointer bg-primary rounded-full size-1.5 shrink-0"
          classList={{ 'opacity-0': !dirty() }}
          onClick={doSave}
          title="Unsaved changes — click to save"
        ></span>
      </div>
      <div ref={containerRef} class="border-x border-b border-gray-700  overflow-hidden h-full"  />
    </div>
  );
}

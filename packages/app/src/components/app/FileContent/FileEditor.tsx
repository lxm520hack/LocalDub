import { createSignal, onMount, onCleanup } from 'solid-js';
import { getAutoSaveMode } from '../settings/editorPrefs';
import { useTheme } from '@repo/ui-solid/theme';
import { fnrpc, client } from '#/integrations/fnrpc/client.ts';
import { loadMonacoTheme } from '../settings/loadTheme';

const AUTO_SAVE_DELAY = 2000;

const EXT_LANG: Record<string, string> = {
  json: 'json',
  ts: 'typescript',
  tsx: 'typescript',
  js: 'javascript',
  jsx: 'javascript',
  rs: 'rust',
  py: 'python',
  toml: 'plaintext',
  yaml: 'yaml',
  yml: 'yaml',
  md: 'markdown',
  css: 'css',
  html: 'html',
  srt: 'plaintext',
  vtt: 'plaintext',
  txt: 'plaintext',
  csv: 'plaintext',
  xml: 'xml',
  log: 'plaintext',
  svelte: 'html',
  vue: 'html',
};

function detectLang(path: string): string {
  const ext = path.split('.').pop()?.toLowerCase();
  return ext ? (EXT_LANG[ext] ?? 'plaintext') : 'plaintext';
}

function resolveRelative(filePath: string, ref: string): string {
  if (ref.startsWith('/')) return ref.slice(1);
  const dir = filePath.split('/').slice(0, -1).join('/');
  const normalized = ref.startsWith('./') ? ref.slice(2) : ref;
  return dir ? `${dir}/${normalized}` : normalized;
}

interface Props {
  path: string;
  label: string;
}

export function FileEditor(props: Props) {
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

  const writeFile = fnrpc.createMutation(() => 'write_app_file_text');
  const fileQuery = fnrpc.createQuery(() => ['read_app_file_text', props.path]);

  const doSave = async () => {
    if (!editor) return;
    const content = editor.getValue();
    try {
      if (props.path.endsWith('.json')) JSON.parse(content);
      await writeFile.mutateAsync([props.path, content]);
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
        if (props.path.endsWith('.json')) JSON.parse(content);
        await writeFile.mutateAsync([props.path, content]);
        lastSavedContent = content;
        setDirty(false);
      } catch { /* silent */ }
    }, AUTO_SAVE_DELAY);
  };

  onMount(async () => {
    if (!containerRef) return;

    const content = fileQuery.data ?? '';
    lastSavedContent = content;

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

    const lang = detectLang(props.path);

    if (lang === 'json' && content) {
      try {
        const parsed = JSON.parse(content);
        const schemaRef: unknown = parsed?.$schema;
        if (typeof schemaRef === 'string' && !schemaRef.startsWith('http')) {
          const schemaPath = schemaRef.startsWith('/')
            ? schemaRef.slice(1)
            : resolveRelative(props.path, schemaRef);
          try {
            const schemaContent = await client.read_app_file_text.query(schemaPath);
            const schemaObj = JSON.parse(schemaContent);
            (monaco.languages.json as any)?.jsonDefaults?.setDiagnosticsOptions({
              validate: true,
              schemas: [{ uri: `file://${schemaPath}`, schema: schemaObj }],
            });
          } catch { /* schema not found */ }
        }
      } catch { /* not valid JSON */ }
    }

    const { themeByName } = await import('@repo/ui-solid/theme/defs');
    const def = themeByName(themeName());
    let monacoTheme = 'vs-dark';
    if (def) {
      try {
        const themeFile = def.monacoTheme.replace(/[\\/:"*?<>|]/g, '_');
        await loadMonacoTheme(monaco, themeFile, def.value);
        monacoTheme = def.value;
      } catch { /* fallback */ }
    }

    model = monaco.editor.createModel(content, lang, monaco.Uri.parse(`file://${props.path}`));
    editor = monaco.editor.create(containerRef, {
      model,
      language: lang,
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
      <div class="flex items-center gap-2 px-3 py-1.5 text-sm border-b rounded-t-lg select-none">
        <svg class="w-3.5 h-3.5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z" />
          <polyline points="14 2 14 8 20 8" />
        </svg>
        <span>{props.label}</span>
        <span
          class="text-sm cursor-pointer bg-primary rounded-full size-1.5 shrink-0"
          classList={{ 'opacity-0': !dirty() }}
          onClick={doSave}
          title="Unsaved changes — click to save"
        ></span>
      </div>
      <div ref={containerRef} class="border-x border-b border-gray-700 overflow-hidden h-full" />
    </div>
  );
}

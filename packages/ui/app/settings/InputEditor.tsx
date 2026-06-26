import { onMount, onCleanup } from 'solid-js';
import { EditorView, basicSetup } from 'codemirror';
import { EditorState } from '@codemirror/state';
import { json, jsonParseLinter } from '@codemirror/lang-json';
import { linter } from '@codemirror/lint';
import { useClientApi } from '../api/context';
import { getAutoSaveMode } from './editorPrefs';

const AUTO_SAVE_DELAY = 2000;

export function InputEditor() {
  const api = useClientApi().inputEditorApi;
  let containerRef: HTMLDivElement | undefined;
  let view: EditorView | undefined;
  let autoSaveTimer: ReturnType<typeof setTimeout> | undefined;

  const debouncedSave = (content: string) => {
    clearTimeout(autoSaveTimer);
    autoSaveTimer = setTimeout(async () => {
      if (!api) return;
      try {
        JSON.parse(content);
        await api.writeInput(content);
      } catch {
        // silent — invalid JSON, don't save
      }
    }, AUTO_SAVE_DELAY);
  };

  onMount(async () => {
    if (!api || !containerRef) return;

    const [content, schema] = await Promise.all([
      api.readInput(),
      api.readInputSchema().catch(() => '{}'),
    ]);

    let schemaObj: any;
    try { schemaObj = JSON.parse(schema); } catch { schemaObj = null; }

    const autoSaveMode = getAutoSaveMode();
    const updateListener = EditorView.updateListener.of((update) => {
      if (!update.docChanged) return;
      if (autoSaveMode === 'afterDelay') {
        debouncedSave(update.state.doc.toString());
      }
    });

    const extensions: any[] = [
      basicSetup,
      json(),
      linter(jsonParseLinter()),
      updateListener,
      EditorView.theme({
        '&': { height: '400px', 'font-size': '13px' },
        '.cm-scroller': { overflow: 'auto' },
      }),
    ];

    const state = EditorState.create({
      doc: content,
      extensions,
    });

    view = new EditorView({ state, parent: containerRef });
  });

  onCleanup(() => {
    clearTimeout(autoSaveTimer);
    view?.destroy();
  });

  const handleSave = async () => {
    if (!api || !view) return;
    const content = view.state.doc.toString();
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
      <div ref={containerRef} class="border border-gray-700 rounded-lg overflow-hidden" />
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

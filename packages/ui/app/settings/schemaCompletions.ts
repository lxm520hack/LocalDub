import { type Completion, type CompletionContext } from '@codemirror/autocomplete';
import { syntaxTree } from '@codemirror/language';

interface SchemaNode {
  type?: string | string[];
  properties?: Record<string, SchemaNode>;
  enum?: (string | number)[];
  additionalProperties?: boolean | SchemaNode;
  allOf?: SchemaNode[];
  anyOf?: SchemaNode[];
  oneOf?: SchemaNode[];
  default?: unknown;
}

function resolveAllOf(schema: SchemaNode): SchemaNode {
  if (!schema.allOf) return schema;
  const merged: SchemaNode = { ...schema };
  delete merged.allOf;
  for (const sub of schema.allOf) {
    const resolved = resolveAllOf(sub);
    merged.properties = { ...merged.properties, ...resolved.properties };
    if (resolved.enum) merged.enum = resolved.enum;
    if (resolved.type && !merged.type) merged.type = resolved.type;
  }
  return merged;
}

function schemaAtPath(schema: SchemaNode, path: string[]): SchemaNode | null {
  let current = resolveAllOf(schema);
  if (current.allOf) current = resolveAllOf(current);
  for (const key of path) {
    if (!current.properties) return null;
    const child = current.properties[key];
    if (!child) return null;
    current = resolveAllOf(child);
    if (current.allOf) current = resolveAllOf(current);
  }
  return current;
}

export function schemaCompletions(rootSchema: SchemaNode) {
  const root = resolveAllOf(rootSchema);

  return (context: CompletionContext) => {
    const doc = context.state.doc.toString();
    const pos = context.pos;

    // Walk the syntax tree to find the path of keys from root to cursor
    const path: string[] = [];
    const tree = syntaxTree(context.state);
    let cur: any = tree.resolve(pos, -1);

    // Walk up from cursor to collect enclosing object property names
    while (cur && cur.name) {
      if (cur.name === 'Property') {
        // This is a key-value pair — find its key string
        const keyNode = cur.getChild('String');
        if (keyNode) {
          const raw = doc.slice(keyNode.from + 1, keyNode.to - 1);
          if (keyNode.to <= pos) path.unshift(raw);
        }
      }
      cur = cur.parent || undefined;
    }

    const node = schemaAtPath(root, path);

    // Check if cursor is after "key": → suggest values
    const before = doc.slice(Math.max(0, pos - 50), pos).replace(/\s+$/, '');
    const valueMatch = before.match(/"([^"]+)"\s*:\s*$/);
    if (valueMatch) {
      const keyPath = [...path];
      keyPath.push(valueMatch[1]);
      const valueNode = schemaAtPath(root, keyPath);

      if (valueNode) {
        const options: Completion[] = [];
        if (valueNode.enum) {
          for (const val of valueNode.enum) {
            const str = JSON.stringify(val);
            if (str && context.matchBefore(new RegExp(str.slice(0, Math.max(1, pos - doc.lastIndexOf(str.slice(0, 3), pos))).replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '$'))) {
              options.push({ label: str, type: 'keyword' });
            } else {
              options.push({ label: str, type: 'keyword' });
            }
          }
        }
        if (valueNode.type === 'boolean') {
          options.push({ label: 'true', type: 'keyword' });
          options.push({ label: 'false', type: 'keyword' });
        }
        if (valueNode.properties) {
          options.push({ label: '{', type: 'keyword' });
        }
        return options.length > 0 ? { from: pos, options } : null;
      }
    }

    // Check if cursor is at a property key position (after `{` or `,` in object)
    const near = doc.slice(Math.max(0, pos - 10), pos).replace(/\s/g, '');
    const isNewKeyPos = near.endsWith('{') || near.endsWith(',') || /"(\w*)$/.test(doc.slice(0, pos));

    if (isNewKeyPos) {
      const parentNode = schemaAtPath(root, path);
      if (parentNode?.properties) {
        const options: Completion[] = Object.entries(parentNode.properties).map(([name, prop]) => ({
          label: JSON.stringify(name),
          type: prop.enum ? 'keyword' : 'property',
          detail: typeof prop.type === 'string' ? prop.type : undefined,
        }));
        return { from: pos, options };
      }
    }

    return null;
  };
}

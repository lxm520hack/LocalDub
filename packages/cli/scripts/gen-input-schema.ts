import { writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ConfigSchema } from '../src/feat/config/types.ts';

const __dirname = dirname(fileURLToPath(import.meta.url));
const outPath = resolve(__dirname, '..', 'input.schema.json');

const jsonSchema = ConfigSchema.toJSONSchema();
writeFileSync(outPath, JSON.stringify(jsonSchema, null, 2));
console.log(`Generated: ${outPath}`);

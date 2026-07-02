import { writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CliInputSchema } from '../src/feat/input/types.ts';

const __dirname = dirname(fileURLToPath(import.meta.url));
const outPath = resolve(__dirname, '..', 'input.schema.json');

const jsonSchema = CliInputSchema.toJSONSchema({
  io: 'input'
});
writeFileSync(outPath, JSON.stringify(jsonSchema, null, 2));
console.log(`Generated: ${outPath}`);

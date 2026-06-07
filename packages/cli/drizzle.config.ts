import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { config as loadEnv } from 'dotenv';
import { defineConfig } from 'drizzle-kit';

const configDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(configDir, '../..');

loadEnv({ path: resolve(repoRoot, '.env') });

const dbFileName = process.env.DB_FILE_NAME ?? 'data/youdub.sqlite';

export default defineConfig({
	out: './drizzle',
	schema: './src/db/schema.ts',
	dialect: 'sqlite',
	casing: 'snake_case',
	dbCredentials: {
		url: resolve(repoRoot, dbFileName),
	},
});

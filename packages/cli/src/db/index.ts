import { Database } from 'bun:sqlite';

import { drizzle } from 'drizzle-orm/bun-sqlite';
import { env } from '@repo/config';
import * as schema from './schema.ts';

export const sql = new Database(env.DB_FILE_NAME);

export const db = drizzle({ client: sql, schema });

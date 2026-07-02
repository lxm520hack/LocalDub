import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import enJson from './messages/en.json' 
import zhCnJson from './messages/zh-cn.json' 
const __dirname = dirname(fileURLToPath(import.meta.url));

const en = JSON.parse(readFileSync(join(__dirname, 'messages', 'en.json'), 'utf-8'));
const zhCn = JSON.parse(readFileSync(join(__dirname, 'messages', 'zh-cn.json'), 'utf-8'));

export const locale = process.env.LANG?.startsWith('zh') ? 'zh-cn' : 'en';

const messages = locale === 'zh-cn' ? zhCnJson : enJson;
export type ServerI18nKey = keyof typeof messages;

export function t(key: ServerI18nKey, vars?: Record<string, string | number | boolean>): string {
  let msg = messages[key];
  if (msg === undefined) return key;
  if (vars) {
    for (const [k, v] of Object.entries(vars)) {
      msg = msg.replace(`{${k}}`, String(v));
    }
  }
  return msg;
}

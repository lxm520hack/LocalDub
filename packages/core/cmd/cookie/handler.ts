import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { YOUTUBE_COOKIE_PATH } from '@repo/config/path/paths';
import { CookieArgs } from './input';

export const setCookie = ({
  service="youtube",
  content,
}: {
  service: 'youtube',
  content: string;
}) => {
  if (!content.trim()) {
    console.error('[Cookie] No content provided');
    throw new Error('[Cookie] No content provided');
  }

  mkdirSync(dirname(YOUTUBE_COOKIE_PATH), { recursive: true });
  writeFileSync(YOUTUBE_COOKIE_PATH, content, 'utf-8');
  console.log(`[Cookie] YouTube cookie saved (${content.length} chars)`);
}

export async function cmdCookie(input: CookieArgs) {
  let { content } = input;

  if (!content?.trim()) {
    console.log('Paste your Netscape cookie (Ctrl+D to finish):');
    const chunks: Buffer[] = [];
    for await (const chunk of Bun.stdin.stream()) {
      chunks.push(Buffer.from(chunk));
    }
    content = Buffer.concat(chunks).toString('utf-8');
  }

  setCookie({
    service: input.service,
    content,
  });
}

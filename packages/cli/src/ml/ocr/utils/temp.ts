import { tmpdir } from 'node:os';
import { join } from 'node:path';

/** Get the temp directory for OCR junction creation. */
export function getTempDir(): string {
	return tmpdir();
}

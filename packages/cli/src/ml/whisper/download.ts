import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { WHISPER_ONNX_DIR as WHISPER_MODEL_PATH } from '@repo/config';

export { WHISPER_MODEL_PATH };

const HF_BASE =
	'https://huggingface.co/onnx-community/whisper-large-v3-turbo_timestamped/resolve/main';

const ONNX_FILES = [
	'onnx/encoder_model.onnx',
	'onnx/encoder_model.onnx_data',
	'onnx/decoder_model_merged.onnx',
];

const TOKENIZER_FILES = [
	'config.json',
	'preprocessor_config.json',
	'generation_config.json',
	'vocab.json',
	'merges.txt',
	'tokenizer.json',
	'tokenizer_config.json',
	'added_tokens.json',
	'normalizer.json',
	'special_tokens_map.json',
];

async function fetchSize(url: string): Promise<number> {
	const resp = await fetch(url, { method: 'HEAD' });
	return +(resp.headers.get('Content-Length') ?? 0);
}

async function downloadFile(
	url: string,
	dest: string,
	onProgress: (pct: number, msg: string) => void,
) {
	const totalSize = await fetchSize(url);
	onProgress(0, `Downloading ${dest.split('/').pop()}...`);

	const resp = await fetch(url);
	if (!resp.ok) throw new Error(`Failed to download ${url}: ${resp.status}`);
	const reader = resp.body!.getReader();
	const file = Bun.file(dest);

	const writer = file.writer();
	let received = 0;

	while (true) {
		const { done, value } = await reader.read();
		if (done) break;
		writer.write(value);
		received += value.length;
		if (totalSize > 0) {
			onProgress(
				Math.floor((received / totalSize) * 100),
				`${dest.split('/').pop()} ${Math.floor((received / totalSize) * 100)}%`,
			);
		}
	}
	writer.end();
}

export async function downloadWhisper(
	onProgress: (pct: number, msg: string) => void,
) {
	const outDir = join(WHISPER_MODEL_PATH, 'onnx');
	const tokenizerDir = WHISPER_MODEL_PATH;

	if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });
	if (!existsSync(tokenizerDir)) mkdirSync(tokenizerDir, { recursive: true });

	const allFiles = [
		...ONNX_FILES.map((f) => ({
			url: `${HF_BASE}/${f}`,
			dest: join(outDir, f.replace('onnx/', '')),
		})),
		...TOKENIZER_FILES.map((f) => ({
			url: `${HF_BASE}/${f}`,
			dest: join(tokenizerDir, f),
		})),
	];

	let done = 0;
	for (const { url, dest } of allFiles) {
		await downloadFile(url, dest, (pct, msg) => {
			onProgress(Math.floor(((done + pct / 100) / allFiles.length) * 100), msg);
		});
		done++;
	}
	onProgress(100, 'Whisper model downloaded');
}

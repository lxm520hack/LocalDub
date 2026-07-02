import { Context } from "../context/context";
import { srtTime } from "./utils";
import { writeFile } from "./fileOps";

export function writeSrt(translation: any[], ctx: Context, outputPath: string, useSource?: boolean) {
	function splitProtected(text: string): string[] {
		const PUNCTUATION = new Set([
			'，',
			',',
			'；',
			';',
			'：',
			':',
			'。',
			'?',
			'？',
			'!',
			'！',
			'、',
		]);
		const PROTECTED_PAIRS: Record<string, string> = {
			'《': '》',
			'（': '）',
			'【': '】',
			'「': '」',
			'『': '』',
		};
		const segs: string[] = [];
		let buf: string[] = [],
			inside: string | null = null;
		for (const ch of text) {
			if (!inside && ch in PROTECTED_PAIRS) {
				inside = PROTECTED_PAIRS[ch];
				buf.push(ch);
				continue;
			}
			if (inside && ch === inside) {
				inside = null;
				buf.push(ch);
				continue;
			}
			if (!inside && PUNCTUATION.has(ch)) {
				const s = buf.join('').trim();
				if (s) segs.push(s);
				buf = [];
				continue;
			}
			buf.push(ch);
		}
		const tail = buf.join('').trim();
		if (tail) segs.push(tail);
		return segs;
	}

	function attachClosingQuotes(segs: string[]): string[] {
		const fixed: string[] = [];
		const CLOSING_QUOTES = new Set([
			'"',
			"'",
			'」',
			'』',
			'》',
			'）',
			'】',
			'\u201d',
			'\u2019',
			']',
		]);
		for (const s of segs) {
			if (s && CLOSING_QUOTES.has(s[0]) && fixed.length) {
				fixed[fixed.length - 1] = `${fixed[fixed.length - 1]}${s}`.trim();
			} else {
				fixed.push(s.trim());
			}
		}
		return fixed;
	}

	function mergeShort(segs: string[]): string[] {
		const merged: string[] = [];
		let i = 0;
		while (i < segs.length) {
			const cur = segs[i];
			if (cur.trim().length < 5 && i + 1 < segs.length) {
				segs[i + 1] = `${cur}${segs[i + 1]}`.trim();
				i++;
				continue;
			}
			merged.push(cur);
			i++;
		}
		return merged;
	}

	function stripTrailingPunct(segs: string[]): string[] {
		return segs
			.map((s) => {
				const t = s.trim();
				if (!t) return '';
				if (t.endsWith('，') || t.endsWith(',') || t.endsWith('。'))
					return t.slice(0, -1);
				return t.replace(/\s+/g, ' ').trim();
			})
			.filter(Boolean);
	}

	function splitSubtitle(text: string): string[] {
		if (!text.trim()) return [];
		const segs = stripTrailingPunct(
			mergeShort(attachClosingQuotes(splitProtected(text))),
		);
		return segs.length ? segs : [text.trim()];
	}

	const lines: string[] = [];
	let idx = 1;
	for (const item of translation) {
		const start = Math.floor(item.actual_start_time ?? item.start_time);
		const end = Math.floor(item.actual_end_time ?? item.end_time);
		if (end <= start) continue;

		const text = (
			useSource ? (item.src || '').trim() : (item.dst || item.zh || '').trim()
		);
		if (!text) continue;
		const fragments = ctx.input?.subtitleSource === 'ocr' || ctx.input?.subtitleSource === 'asr_ocr'
			? [text]
			: splitSubtitle(text);
		if (!fragments.length) continue;

		const totalDuration = end - start;
		const weights = fragments.map((f) =>
			Math.max(1, f.replace(/\s/g, '').length),
		);
		const totalWeight = weights.reduce((a, b) => a + b, 0);
		let cursor = start,
			allocated = 0;

		for (let f = 0; f < fragments.length; f++) {
			const share =
				f < fragments.length - 1
					? Math.max(
							200,
							Math.min(
								Math.round((totalDuration * weights[f]) / totalWeight),
								totalDuration - allocated - 100,
							),
						)
					: Math.max(100, totalDuration - allocated);
			lines.push(String(idx));
			lines.push(`${srtTime(cursor)} --> ${srtTime(cursor + share)}`);
			lines.push(fragments[f]);
			lines.push('');
			cursor += share;
			allocated += share;
			idx++;
		}
	}

	writeFile(outputPath, lines.join('\n'), ctx);
}
import { Context } from "../context/context";
import { srtTime } from "./utils";
import { writeFile } from "./fileOps";

/**
 *  按标点切分长句（,, ,, 。, ? 等），但保护配对符号（《》、「」 里的内容不被切开）
 */
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
/**
 * 修复引号被切到下一段的问题：如果一段以右引号开头，就合并到上一段末尾
 */
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
/**
 * 合并 <5 字符的超短段到下一段（避免字幕一闪而过）
 */
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

/** 先保留 */
function splitSubtitle(text: string): string[] {
	if (!text.trim()) return [];
	const segs = stripTrailingPunct(
		mergeShort(attachClosingQuotes(splitProtected(text))),
	);
	return segs.length ? segs : [text.trim()];
}

/** 
 * 按 fragment 分配时间的写入逻辑（就是从原 writeSrt 抽出来的）
 * 先保留
 */
function writeSrtFragments(
  lines: string[], idx: { value: number },
  start: number, end: number, fragments: string[],
) {
  const totalDuration = end - start;
  const weights = fragments.map(f => Math.max(1, f.replace(/\s/g, '').length));
  const totalWeight = weights.reduce((a, b) => a + b, 0);
  let cursor = start, allocated = 0;
  for (let f = 0; f < fragments.length; f++) {
    const share = f < fragments.length - 1
      ? Math.max(200, Math.min(Math.round((totalDuration * weights[f]) / totalWeight), totalDuration - allocated - 100))
      : Math.max(100, totalDuration - allocated);
    lines.push(String(idx.value), `${srtTime(cursor)} --> ${srtTime(cursor + share)}`, fragments[f], '');
    cursor += share;
    allocated += share;
    idx.value++;
  }
}

export function writeSrt(translation: any[], ctx: Context, outputPath: string, useSource?: boolean) {
	console.log(`Writing SRT length: ${translation.length}...`);
	const lines: string[] = [];
	let idx = 1;
	for (const item of translation) {
		const start = Math.floor(item.actual_start_time ?? item.start_time);
		const end = Math.floor(item.actual_end_time ?? item.end_time);
		// if (end <= start) continue;

		const text = (
			useSource ? (item.src || '').trim() : (item.dst || item.zh || '').trim()
		);
		if (!text) continue;
		 // 默认一条 SRT（之前由 splitSubtitle 切分的逻辑已抽成 writeSrtFragments）
    lines.push(String(idx), `${srtTime(start)} --> ${srtTime(end)}`, text, '');
    idx++;
	}

	writeFile(outputPath, lines.join('\n'), ctx);
}
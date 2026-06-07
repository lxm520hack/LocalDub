/**
 * 默认字符集（仅小写 + 数字，大小写不敏感排序器也能正确排列）
 * 字符集顺序 = 编码大小顺序，'0' < '9' < 'a' < 'z'
 *
 * 如需缩短 ID 长度可使用大小写混合字母表（base‑62），但此时字典序只能保证在
 * **ASCII 严格比较**（case‑sensitive）下才等于时间序，不适用于 VS Code 等
 * 默认 case‑insensitive 排序的环境：
 *
 * ```ts
 * // base‑62，ASCII 升序：'0' < '9' < 'A' < 'Z' < 'a' < 'z'
 * const alphabet = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
 * timeId({ alphabet })
 * ```
 */
const defaultAlphabet = '0123456789abcdefghijklmnopqrstuvwxyz';

function encode(num: number, alphabet: string): string {
	const base = alphabet.length;
	if (num === 0) return alphabet[0];
	let result = '';
	while (num > 0) {
		result = alphabet[num % base] + result;
		num = Math.floor(num / base);
	}
	return result;
}

function getRandomValues(length: number): Uint8Array {
	if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
		return crypto.getRandomValues(new Uint8Array(length));
	}
	throw new Error('crypto.getRandomValues is not available');
}

function randomString(length: number, alphabet: string): string {
	const base = alphabet.length;
	const maxValid = 256 - (256 % base);
	const bytes = getRandomValues(length);
	let result = '';
	for (let i = 0; i < bytes.length; i++) {
		if (result.length >= length) break;
		if (bytes[i] < maxValid) {
			result += alphabet[bytes[i] % base];
		}
	}
	if (result.length < length) {
		result += randomString(length - result.length, alphabet);
	}
	return result;
}

let lastTime = 0;
let counter = 0;

/**
 * @param size    ID 总长度（默认 16）。太小时会因放不下时间戳前缀而抛错
 * @param alphabet 字符集，**必须按 ASCII 升序排列**，否则字典序 ≠ 时间序
 *                 默认字符集（仅小写+数字）兼容大小写不敏感排序器。
 *                 counter 优先让位于 random，仅在有剩余空间时使用，
 *                 因此同毫秒内不能保证严格调用序。
 *                 仅单进程内保证单调递增（毫秒级），多实例需外部协调
 */
export type TimeIdOptions = {
	size?: number;
	alphabet?: string;
};

export function timeId(options?: TimeIdOptions): string {
	const { size = 16, alphabet = defaultAlphabet } = options ?? {};
	const base = alphabet.length;

	if (size < 1) throw new Error('size must be at least 1');
	if (base < 2) throw new Error('alphabet must have at least 2 characters');

	let now = Date.now();

	const ts = encode(now, alphabet);
	if (ts.length > size) {
		throw new Error(
			`size ${size} is too small for timestamp prefix (${ts.length})`,
		);
	}

	const randomLen = size - ts.length;
	if (randomLen < 1) {
		throw new Error(
			`size ${size} leaves no room for any suffix (timestamp=${ts.length})`,
		);
	}

	const counterLen = Math.min(2, Math.max(0, randomLen - 1));
	const randomSuffixLen = randomLen - counterLen;

	if (counterLen > 0) {
		if (now === lastTime) {
			counter++;
			if (counter >= base ** counterLen) {
				while (Date.now() === lastTime) {
					/* spin to next ms */
				}
				now = Date.now();
				counter = 0;
			}
		} else {
			counter = 0;
		}
		lastTime = now;
	}

	return (
		ts +
		(counterLen > 0
			? encode(counter, alphabet).padStart(counterLen, alphabet[0])
			: '') +
		(randomSuffixLen > 0 ? randomString(randomSuffixLen, alphabet) : '')
	);
}

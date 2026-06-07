export const getSafeLength = (val?: string | number | string[] | readonly string[]): number => {
	if (Array.isArray(val)) return val.length; // 数组返回元素个数
	if (val === undefined || val === null) return 0;
	return String(val).length; // 字符串或数字返回字符数
};
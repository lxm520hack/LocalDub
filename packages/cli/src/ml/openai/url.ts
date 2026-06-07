export const normalizeOpenAIBaseUrl = (baseUrl?: string) => {
	if (!baseUrl) return 'https://api.openai.com/v1';
	let url = baseUrl.trim().replace(/\/+$/, '');
	let lower = url.toLowerCase();
	for (const suffix of ['/chat/completions', '/completions']) {
		if (lower.endsWith(suffix)) {
			url = url.slice(0, -suffix.length).replace(/\/+$/, '');
			lower = url.toLowerCase();
		}
	}
	return url || 'https://api.openai.com/v1';
};

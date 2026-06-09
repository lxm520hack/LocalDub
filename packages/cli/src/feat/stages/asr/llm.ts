export const DEFAULT_API_BASE = 'http://localhost:11434/v1';
export const DEFAULT_MODEL = 'gemma4:31b-cloud';

export function buildSystemPrompt(domainHint?: string): string {
  let prompt = `你是一个 ASR 纠错助手。修正中文转录文本中的错别字。

输入包含两部分：
1. "全文上下文" — 完整对话，帮助理解语境
2. "请修正以下条目" — 按行号列出的待修正文本

规则：
1. 先参考全文上下文理解语境，再逐条修正
2. 保持行号不变
3. 只修改文字错误，不改标点
4. 保持行数完全一致
5. 不要添加解释或额外内容
6. 没有错误的行保持原样
7. 注意：中文 ASR 常见同音/近音字错误，根据上下文判断正确用词`;

  if (domainHint) {
    prompt += `\n\n领域提示：${domainHint}`;
  }
  return prompt;
}

export function segmentsToPrompt(segments: { text: string }[]): string {
  const fullText = segments.map(s => s.text).join(' ');
  const lines = segments.map((s, i) => `${i + 1}: ${s.text}`).join('\n');
  return `全文上下文（参考用，每句以空格分隔）：\n${fullText}\n\n请修正以下条目（保持行号不变）：\n${lines}`;
}

export function parseLines(input: string, expectedCount: number): string[] | null {
  const texts: string[] = [];
  const lines = input.trim().split('\n');
  for (const line of lines) {
    const m = line.match(/^\s*\d+\s*[):.]\s*(.+)/);
    if (m) texts.push(m[1].trim());
  }
  if (texts.length !== expectedCount) return null;
  return texts;
}

export async function fixWithLLM(
  prompt: string,
  opts?: { model?: string; apiBase?: string; domainHint?: string; signal?: AbortSignal },
): Promise<string> {
  const apiBase = opts?.apiBase || DEFAULT_API_BASE;
  const model = opts?.model || DEFAULT_MODEL;
  const resp = await fetch(`${apiBase}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    signal: opts?.signal,
    body: JSON.stringify({
      model,
      max_tokens: 4096,
      temperature: 0.1,
      messages: [
        { role: 'system', content: buildSystemPrompt(opts?.domainHint) },
        { role: 'user', content: prompt },
      ],
    }),
  });
  if (!resp.ok) {
    const err = await resp.text();
    throw new Error(`LLM API ${resp.status}: ${err.slice(0, 200)}`);
  }
  const json = await resp.json();
  return (json.choices?.[0]?.message?.content || '').trim();
}

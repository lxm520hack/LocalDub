import { env } from "@repo/config/env";

export const chat_completions = async (
  prompt: string,
  opts: { model?: string; apiBase?: string; 
    systemPrompt: string; signal?: AbortSignal 
  }
) => {
  const apiBase = opts?.apiBase || env.OPENAI_BASE_URL;
  const model = opts?.model || env.OPENAI_MODEL;
  const resp = await fetch(`${apiBase}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    signal: opts?.signal,
    body: JSON.stringify({
      model,
      max_tokens: 4096,
      temperature: 0.1,
      messages: [
        { role: 'system', content: opts.systemPrompt },
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
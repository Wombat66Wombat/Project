// Asks Claude for musical ideas and gets them back as structured notes and chords.

import Anthropic from '@anthropic-ai/sdk';
import { SYSTEM, SCHEMA, buildRequest } from '../app/prompt.js';

export const MODEL = 'claude-opus-5-5';

/** payload: { task: 'continue'|'variation'|'chords'|'free', request: string, bars: number, song } */
export async function askClaude(apiKey, payload) {
  const client = new Anthropic({ apiKey, timeout: 120_000 });
  const text = buildRequest(payload);

  try {
    const response = await client.beta.messages.create({
      model: MODEL,
      max_tokens: 16000,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      output_config: { effort: 'medium', format: { type: 'json_schema', schema: SCHEMA } },
      system: SYSTEM,
      messages: [{ role: 'user', content: text }],
    });
    if (response.stop_reason === 'refusal') {
      return { ok: false, error: response.stop_details?.explanation || 'Claude declined this request. Try wording it differently.' };
    }
    if (response.stop_reason === 'max_tokens') return { ok: false, error: 'The answer was too long. Ask for fewer bars.' };
    const block = response.content.find((b) => b.type === 'text');
    if (!block) return { ok: false, error: 'Claude sent no music back. Please try again.' };
    return { ok: true, data: JSON.parse(block.text), model: response.model };
  } catch (error) {
    if (error instanceof Anthropic.AuthenticationError) return { ok: false, needsKey: true, error: 'Claude rejected the API key. Check it in Settings.' };
    if (error instanceof Anthropic.PermissionDeniedError) return { ok: false, error: 'This API key is not allowed to use the model. Check your Claude Console account.' };
    if (error instanceof Anthropic.RateLimitError) return { ok: false, error: 'Too many requests right now. Wait a moment and try again.' };
    if (error instanceof Anthropic.BadRequestError) return { ok: false, error: `Claude couldn't read the request: ${error.message}` };
    if (error instanceof Anthropic.APIConnectionError) return { ok: false, error: "Can't reach Claude. Check your internet connection." };
    if (error instanceof Anthropic.APIError) return { ok: false, error: `Claude had a problem (${error.status ?? 'error'}). Try again in a moment.` };
    if (error instanceof SyntaxError) return { ok: false, error: 'Claude sent an answer the app could not read. Please try again.' };
    return { ok: false, error: String(error?.message || error) };
  }
}

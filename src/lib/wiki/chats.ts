export interface ChatMessage {
  role: 'user' | 'assistant';
  text: string;
  time: number | null;
}

export interface Conversation {
  id: string;
  title: string;
  platform: 'ChatGPT' | 'Claude';
  created: number | null;
  messages: ChatMessage[];
}

const toMs = (v: unknown): number | null => {
  if (typeof v === 'number' && Number.isFinite(v)) return v < 1e12 ? v * 1000 : v; // seconds or ms
  if (typeof v === 'string') {
    const t = Date.parse(v);
    return Number.isFinite(t) ? t : null;
  }
  return null;
};

type Rec = Record<string, unknown>;
const isRec = (x: unknown): x is Rec => !!x && typeof x === 'object' && !Array.isArray(x);

/** ChatGPT export (conversations.json): each chat is a tree of messages; follow the current branch. */
function fromChatGPT(c: Rec): Conversation | null {
  const mapping = c.mapping;
  if (!isRec(mapping)) return null;
  const order: Rec[] = [];
  let node = typeof c.current_node === 'string' ? c.current_node : null;
  const seen = new Set<string>();
  while (node && isRec(mapping[node]) && !seen.has(node)) {
    seen.add(node);
    const entry = mapping[node] as Rec;
    if (isRec(entry.message)) order.push(entry.message);
    node = typeof entry.parent === 'string' ? entry.parent : null;
  }
  order.reverse();
  const messages: ChatMessage[] = [];
  for (const m of order) {
    const role = isRec(m.author) ? m.author.role : null;
    if (role !== 'user' && role !== 'assistant') continue;
    const content = isRec(m.content) ? m.content : {};
    const parts = Array.isArray(content.parts) ? content.parts : [];
    const text = parts.filter((p): p is string => typeof p === 'string').join('\n').trim();
    if (!text) continue;
    messages.push({ role, text, time: toMs(m.create_time) });
  }
  if (!messages.length) return null;
  return {
    id: String(c.conversation_id ?? c.id ?? `${c.title}-${c.create_time}`),
    title: String(c.title || 'Untitled chat').trim(),
    platform: 'ChatGPT',
    created: toMs(c.create_time),
    messages,
  };
}

/** Claude export (conversations.json): a flat list of chat_messages. */
function fromClaude(c: Rec): Conversation | null {
  const list = Array.isArray(c.chat_messages) ? c.chat_messages : null;
  if (!list) return null;
  const messages: ChatMessage[] = [];
  for (const m of list) {
    if (!isRec(m)) continue;
    const role = m.sender === 'human' ? 'user' : m.sender === 'assistant' ? 'assistant' : null;
    if (!role) continue;
    let text = typeof m.text === 'string' ? m.text : '';
    if (!text.trim() && Array.isArray(m.content)) {
      text = m.content.filter((p): p is Rec => isRec(p) && p.type === 'text' && typeof p.text === 'string').map((p) => p.text as string).join('\n');
    }
    if (!text.trim()) continue;
    messages.push({ role, text: text.trim(), time: toMs(m.created_at) });
  }
  if (!messages.length) return null;
  return {
    id: String(c.uuid ?? `${c.name}-${c.created_at}`),
    title: String(c.name || 'Untitled chat').trim(),
    platform: 'Claude',
    created: toMs(c.created_at),
    messages,
  };
}

/** Parse a conversations.json from ChatGPT or Claude (detected automatically). */
export function parseConversations(json: string): Conversation[] {
  let data: unknown;
  try {
    data = JSON.parse(json);
  } catch {
    throw new Error('That file isn’t valid JSON.');
  }
  const list = Array.isArray(data) ? data : isRec(data) && Array.isArray(data.conversations) ? data.conversations : null;
  if (!list) throw new Error('No conversations found. Use conversations.json from a ChatGPT or Claude data export.');
  const out: Conversation[] = [];
  for (const c of list) {
    if (!isRec(c)) continue;
    const conv = 'mapping' in c ? fromChatGPT(c) : 'chat_messages' in c ? fromClaude(c) : null;
    if (conv) out.push(conv);
  }
  return out;
}

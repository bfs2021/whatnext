import type {SessionMessage} from 'claude-code';

import type {FoundLink, Recap} from '../types';

// The recap's model call and what goes to whatnext (docs/DESIGN.md "まとめの mod"). Pure functions.

export const RECAP_SYSTEM = `You recap a coding agent's session for a person who runs several sessions at once and glances at a list of them.
The input is the previous recap (if any), the person's instructions (oldest first) and the agent's last answer.
- goal: what the session as a whole is trying to achieve. Keep the previous goal unless the person changed course.
- now: how far it has got: what is done or decided, concretely.
- next: what comes next, or what the agent waits for the person to decide. "" if nothing.
Write in the language the person writes in. Reply with this JSON only:
{"goal": "at most 40 characters", "now": "at most 100 characters", "next": "at most 60 characters"}`;

/** How many instructions the model reads, newest last. */
export const PROMPTS = 10;
/** How many links go to whatnext, newest first. */
export const SENT_LINKS = 20;

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

/** The person's instructions: user messages that carry words and no tool results. */
export function promptsOf(messages: readonly SessionMessage[]): string[] {
  return messages
    .filter(m => m.role === 'user' && (m.toolResults?.length ?? 0) === 0 && m.text.trim() !== '')
    .map(m => m.text)
    .slice(-PROMPTS);
}

export function recapPrompt(prev: Recap, prompts: readonly string[], answer: string): string {
  const lines: string[] = [];
  if (prev) lines.push('## Previous recap', JSON.stringify(prev), '');
  lines.push("## The person's instructions (oldest first)");
  for (const p of prompts) lines.push(`- ${clip(p.replace(/\s+/g, ' '), 300)}`);
  if (answer) lines.push('', "## The agent's last answer", clip(answer, 2000));
  return lines.join('\n');
}

export function parseRecap(text: string): Recap {
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) return null;
  try {
    const v = JSON.parse(m[0]) as Record<string, unknown>;
    const str = (x: unknown, n: number) => (typeof x === 'string' ? clip(x.trim(), n) : '');
    const r = {goal: str(v.goal, 80), now: str(v.now, 200), next: str(v.next, 120)};
    return r.goal || r.now || r.next ? r : null;
  } catch {
    return null;
  }
}

/** What whatnext receives at `/v1/hooks`, beside the hooks of Claude Code. */
export interface RecapBody {
  hook_event_name: 'WhatnextRecap';
  session_id: string;
  recap: Recap;
  links: {label: string; href: string}[];
}

export function recapBody(sessionId: string, recap: Recap, links: readonly FoundLink[]): RecapBody {
  return {
    hook_event_name: 'WhatnextRecap',
    session_id: sessionId,
    recap,
    links: links.slice(0, SENT_LINKS).map(l => ({label: nameOf(l), href: l.href})),
  };
}

/** A link as the pane and the list name it: a Markdown link's words, else the label made from its URL. */
export function nameOf(l: FoundLink): string {
  return l.text ?? l.label;
}

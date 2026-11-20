import type {SessionMessage} from 'claude-code';

import type {Digest, FoundLink} from '../types';

// The digest's model call and what goes to whatnext (docs/DESIGN.md "ダイジェストの mod"). Pure functions.

export const DIGEST_SYSTEM = `You write a digest of a coding agent's session for a person who runs several sessions at once and glances at a list of them.
The input is the previous digest (if any), the user's instructions (oldest first) and the agent's last answer.
- goal: what the session as a whole is trying to achieve. Keep the previous goal unless the user changed course.
- progress: how far it has got: what is done or decided, concretely.
- next: what comes next, or what the agent waits for the user to decide. "" if nothing.
Write every value in the language the user writes in, including the words for "the user". Reply with this JSON only:
{"goal": "at most 40 characters", "progress": "at most 100 characters", "next": "at most 60 characters"}`;

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

export function digestPrompt(prev: Digest, prompts: readonly string[], answer: string): string {
  const lines: string[] = [];
  if (prev) lines.push('## Previous digest', JSON.stringify(prev), '');
  lines.push("## The person's instructions (oldest first)");
  for (const p of prompts) lines.push(`- ${clip(p.replace(/\s+/g, ' '), 300)}`);
  if (answer) lines.push('', "## The agent's last answer", clip(answer, 2000));
  return lines.join('\n');
}

export function parseDigest(text: string): Digest {
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) return null;
  try {
    const v = JSON.parse(m[0]) as Record<string, unknown>;
    const str = (x: unknown, n: number) => (typeof x === 'string' ? clip(x.trim(), n) : '');
    const r = {goal: str(v.goal, 80), progress: str(v.progress, 200), next: str(v.next, 120)};
    return r.goal || r.progress || r.next ? r : null;
  } catch {
    return null;
  }
}

/** What whatnext receives at `/v1/hooks`, beside the hooks of Claude Code. */
export interface DigestBody {
  hook_event_name: 'WhatnextDigest';
  session_id: string;
  digest: Digest;
  links: {label: string; href: string}[];
}

export function digestBody(sessionId: string, digest: Digest, links: readonly FoundLink[]): DigestBody {
  return {
    hook_event_name: 'WhatnextDigest',
    session_id: sessionId,
    digest,
    links: links.slice(0, SENT_LINKS).map(l => ({label: nameOf(l), href: l.href})),
  };
}

/** A link as the pane and the list name it: a Markdown link's words, else the label made from its URL. */
export function nameOf(l: FoundLink): string {
  return l.text ?? l.label;
}

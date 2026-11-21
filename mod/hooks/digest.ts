import type {SessionMessage} from 'claude-code';

import type {Digest, FoundLink} from '../types';

// The digest's model call and what goes to whatnext (docs/DESIGN.md "ダイジェストの mod"). Pure functions.

export const DIGEST_SYSTEM = `You write a digest of a coding agent's session for a person who runs several sessions at once and glances at a list of them.
The input is the previous digest (if any), the user's instructions (oldest first) and the agent's last answer.
- goal: what the session as a whole is trying to achieve. Keep the previous goal unless the user changed course.
- progress: how far it has got: what is done or decided, concretely.
- next: what comes next, or what the agent waits for the user to decide. "" if nothing.
Write every value in the language the "## Language" part of the input names, including the words for "the user", even when the previous digest or the agent's answer is in another language. Reply with this JSON only:
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

export type Language = 'Japanese' | 'English';

/**
 * The language one instruction is written in: Japanese when it has kana, English when its letters are all
 * Latin. Code, URLs and the name of a slash command are not counted. Undefined for any other (or no) letters.
 */
export function languageOfOne(text: string): Language | undefined {
  const words = text
    .replace(/```[\s\S]*?(```|$)/g, ' ')
    .replace(/`[^`]*`/g, ' ')
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/^\s*\/\S+/, ' ');
  if (/[\p{Script=Hiragana}\p{Script=Katakana}]/u.test(words)) return 'Japanese';
  const letters = words.match(/\p{L}/gu) ?? [];
  if (letters.length === 0) return undefined;
  return letters.every(c => /\p{Script=Latin}/u.test(c)) ? 'English' : undefined;
}

/**
 * The language of the person's instructions: the one most of them are in; on a tie, the newest one's.
 * Undefined when none is in Japanese or English.
 */
export function languageOf(prompts: readonly string[]): Language | undefined {
  const count = {Japanese: 0, English: 0};
  let newest: Language | undefined;
  for (const p of prompts) {
    const l = languageOfOne(p);
    if (!l) continue;
    count[l]++;
    newest = l;
  }
  if (count.Japanese === count.English) return newest;
  return count.Japanese > count.English ? 'Japanese' : 'English';
}

/** The part of the input that names the language to write in. */
export function languageLine(language: Language | undefined): string {
  if (language) {
    return `Write goal, progress and next in ${language}: the person's instructions are in ${language}. Translate the previous digest into ${language} if it is in another language.`;
  }
  return "Write goal, progress and next in the language of the person's instructions above: in Japanese if they are in Japanese, in English if they are in English. Never use a language they are not written in.";
}

export function digestPrompt(prev: Digest, prompts: readonly string[], answer: string): string {
  const lines: string[] = [];
  if (prev) lines.push('## Previous digest', JSON.stringify(prev), '');
  lines.push("## The person's instructions (oldest first)");
  for (const p of prompts) lines.push(`- ${clip(p.replace(/\s+/g, ' '), 300)}`);
  if (answer) lines.push('', "## The agent's last answer", clip(answer, 2000));
  lines.push('', '## Language', languageLine(languageOf(prompts)));
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

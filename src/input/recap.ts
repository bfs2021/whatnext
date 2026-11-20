import {HookStore} from '../../lib/input/hooks.js';

// まとめの受け口(DESIGN.md「まとめの受信」)。mod は今の受け口の `/v1/hooks` に、`hook_event_name` が
// `WhatnextRecap` の本文を送る。lib の受け口はフックの本文を `HookStore.receiveHook` に渡すので、その手前で
// まとめだけを抜き取り、ほかはそのまま lib に渡す(lib の契約を変えずに口を足す)。

export interface Recap {
  goal: string;
  now: string;
  next: string;
}

export interface RecapLink {
  label: string;
  href: string;
}

export interface RecapFacts {
  recap?: Recap;
  links: RecapLink[];
  /** 受け取った時刻。 */
  at: number;
}

export const RECAP_EVENT = 'WhatnextRecap';
/** 受けるリンクの数の上限(mod が送るのは 20 件)。 */
const MAX_LINKS = 20;
const MAX = {goal: 200, now: 400, next: 300, label: 200, href: 2048};

/** 制御文字(改行とタブを含む)を除き、長さを切る。受け口にはローカルのどのプロセスからも送れるので、描く前に落とす。 */
export function sanitize(s: unknown, max: number): string {
  if (typeof s !== 'string') return '';
  let out = '';
  for (const ch of s.replace(/[\r\n\t]+/g, ' ')) {
    const c = ch.codePointAt(0) ?? 0;
    if (c < 0x20 || c === 0x7f || (c >= 0x80 && c < 0xa0)) continue;
    out += ch;
  }
  out = out.trim();
  return out.length > max ? `${out.slice(0, max - 1)}…` : out;
}

/** 本文からまとめを読む。まとめの本文でなければ undefined。 */
export function parseRecapBody(body: unknown, now: number): {sid: string; facts: RecapFacts} | undefined {
  let v: unknown = body;
  if (typeof v === 'string') {
    try {
      v = JSON.parse(v);
    } catch {
      return undefined;
    }
  }
  if (!v || typeof v !== 'object') return undefined;
  const o = v as Record<string, unknown>;
  if (o.hook_event_name !== RECAP_EVENT) return undefined;
  const sid = typeof o.session_id === 'string' ? o.session_id : '';
  if (!sid) return undefined;
  let recap: Recap | undefined;
  if (o.recap && typeof o.recap === 'object') {
    const r = o.recap as Record<string, unknown>;
    const x = {goal: sanitize(r.goal, MAX.goal), now: sanitize(r.now, MAX.now), next: sanitize(r.next, MAX.next)};
    if (x.goal || x.now || x.next) recap = x;
  }
  const links: RecapLink[] = [];
  if (Array.isArray(o.links)) {
    for (const l of o.links.slice(0, MAX_LINKS)) {
      if (!l || typeof l !== 'object') continue;
      const href = sanitize((l as Record<string, unknown>).href, MAX.href);
      // 開くのは http(s) の URL だけ(`open` にほかの形を渡さない)
      if (!/^https?:\/\/[^\s]+$/.test(href)) continue;
      links.push({href, label: sanitize((l as Record<string, unknown>).label, MAX.label) || href});
    }
  }
  return {sid, facts: {recap, links, at: now}};
}

/**
 * フックの値に加えて、まとめをセッションごとにメモリに持つ。まとめを受けるのは、`--recap` で起動したときだけ。
 * 受けないときは、まとめの本文を捨てる(lib にも渡さない)。
 */
export class RecapHookStore extends HookStore {
  private recaps = new Map<string, RecapFacts>();

  constructor(
    private readonly enabled: boolean,
    private readonly clock: () => number = Date.now,
  ) {
    super();
  }

  override receiveHook(body: unknown): void {
    const r = parseRecapBody(body, this.clock());
    if (r) {
      if (!this.enabled) return;
      // まとめが作れなかった回(リンクだけ届いた)は、前のまとめを残す
      const prev = this.recaps.get(r.sid);
      this.recaps.set(r.sid, {...r.facts, recap: r.facts.recap ?? prev?.recap});
      return;
    }
    if (isRecapLike(body)) return;
    super.receiveHook(body);
  }

  /** そのセッションの最後に受けたまとめ。 */
  recapOf(sid: string): RecapFacts | undefined {
    return this.recaps.get(sid);
  }

  /** 今のまとめの写し(更新の時点の値を一覧に渡す)。 */
  snapshot(): Map<string, RecapFacts> {
    return new Map(this.recaps);
  }

  override forget(keep: ReadonlySet<string>): void {
    super.forget(keep);
    for (const k of [...this.recaps.keys()]) if (!keep.has(k)) this.recaps.delete(k);
  }
}

/** 形の崩れたまとめの本文(セッションの ID がないなど)。lib のフックの扱いに渡さない。 */
function isRecapLike(body: unknown): boolean {
  if (typeof body === 'string') return body.includes(RECAP_EVENT);
  return !!body && typeof body === 'object' && (body as Record<string, unknown>).hook_event_name === RECAP_EVENT;
}

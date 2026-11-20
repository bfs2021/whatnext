import {describe, expect, it} from 'vitest';
import {stripAnsi, width} from '../../lib/text/text.js';
import {parseArgs} from '../../src/cli/args.js';
import {withRecapPort} from '../../src/cli/list.js';
import {parseRecapBody, RecapHookStore, sanitize} from '../../src/input/recap.js';
import {hyperlink, render, SIDE_MIN_COLS, sideLines, wrap} from '../../src/screen/screen.js';
import type {Screen, ScreenRow} from '../../src/screen/types.js';

const body = (over: Record<string, unknown> = {}) => ({
  hook_event_name: 'WhatnextRecap',
  session_id: 's1',
  recap: {goal: 'ログイン画面の二重送信を直す', now: 'ボタンを無効にした', next: 'レビューを待つ'},
  links: [{label: 'PR #58', href: 'https://github.com/acme/app/pull/58'}],
  ...over,
});

describe('まとめの受け口', () => {
  it('まとめの本文を読み、制御文字を落とし、http(s) でないリンクを捨てる', () => {
    const r = parseRecapBody(
      body({
        recap: {goal: 'a\x1b[31mb\nc', now: 'n', next: ''},
        links: [
          {label: 'x\x07', href: 'https://example.com/a'},
          {label: 'bad', href: 'file:///etc/passwd'},
          {label: 'bad2', href: 'https://a b'},
        ],
      }),
      5,
    );
    expect(r?.sid).toBe('s1');
    expect(r?.facts.recap).toEqual({goal: 'a[31mb c', now: 'n', next: ''});
    expect(r?.facts.links).toEqual([{label: 'x', href: 'https://example.com/a'}]);
    expect(r?.facts.at).toBe(5);
  });

  it('文字列の本文も読む。まとめでない本文、セッションのない本文は読まない', () => {
    expect(parseRecapBody(JSON.stringify(body()), 0)?.facts.recap?.goal).toBe('ログイン画面の二重送信を直す');
    expect(parseRecapBody({hook_event_name: 'Stop', session_id: 's1'}, 0)).toBeUndefined();
    expect(parseRecapBody(body({session_id: ''}), 0)).toBeUndefined();
    expect(parseRecapBody('not json', 0)).toBeUndefined();
  });

  it('長さを切る', () => {
    expect(sanitize('x'.repeat(500), 10)).toBe(`${'x'.repeat(9)}…`);
    expect(sanitize(3, 10)).toBe('');
  });

  it('--recap のときだけ持ち、まとめのない回は前のまとめを残す。消えたセッションは忘れる', () => {
    const on = new RecapHookStore(true, () => 1);
    on.receiveHook(body());
    on.receiveHook(body({recap: null, links: []}));
    expect(on.recapOf('s1')?.recap?.goal).toBe('ログイン画面の二重送信を直す');
    expect(on.recapOf('s1')?.links).toEqual([]);
    on.forget(new Set(['s2']));
    expect(on.recapOf('s1')).toBeUndefined();

    const off = new RecapHookStore(false);
    off.receiveHook(body());
    expect(off.recapOf('s1')).toBeUndefined();
    expect(off.snapshot().size).toBe(0);
  });

  it('まとめのほかのフックは今までどおり受ける', () => {
    const s = new RecapHookStore(true);
    s.receiveHook({hook_event_name: 'UserPromptSubmit', session_id: 's1', prompt: 'hello'});
    expect(s.get('s1').prompt?.text).toBe('hello');
  });

  it('mod に送り先のポートを渡す', () => {
    const j = JSON.parse(withRecapPort(JSON.stringify({hooks: {}, env: {A: '1'}}), 14555));
    expect(j.env).toEqual({A: '1', WHATNEXT_RECAP_PORT: '14555'});
    expect(j.hooks).toEqual({});
  });
});

describe('起動の引数', () => {
  it('--recap は単独のときだけ。--help は先頭のときだけ', () => {
    expect(parseArgs([])).toEqual({cmd: 'list', recap: false});
    expect(parseArgs(['--recap'])).toEqual({cmd: 'list', recap: true});
    expect(parseArgs(['--recap', '--help'])).toEqual({cmd: 'bad', arg: '--help'});
    expect(parseArgs(['--recap', 'workbench'])).toEqual({cmd: 'bad', arg: 'workbench'});
    expect(parseArgs(['workbench', '--recap'])).toEqual({cmd: 'bad', arg: '--recap'});
    expect(parseArgs(['--help', '--recap'])).toEqual({cmd: 'help'});
  });
});

const row = (sid: string, over: Partial<ScreenRow> = {}): ScreenRow => ({
  sid,
  name: sid,
  status: 'Review',
  tone: 'review',
  where: {},
  depth: 0,
  last: true,
  ancestorsLast: [],
  hasChildren: false,
  ...over,
});

/** 埋め込みのリンク(OSC 8)の列。lib の stripAnsi は除かない。 */
const ESC = String.fromCharCode(0x1b);
const OSC8 = new RegExp(`${ESC}\\]8;;[^${ESC}]*${ESC}\\\\`, 'g');
const unlink = (s: string) => s.replace(OSC8, '');
const plain = (s: Screen) => render(s).map(l => stripAnsi(unlink(l)).trimEnd());
const link = (label: string, href = `https://example.com/${label}`) => ({label, href});

const screen = (w: number, over: Partial<Screen> = {}): Screen => ({
  width: w,
  height: 16,
  cursor: 'fix-login',
  groups: [
    {
      title: 'app',
      rows: [
        row('fix-login', {
          where: {branch: 'fix/double-submit', pr: {number: 58, state: 'open'}},
          ctx: 91000,
          age: 5 * 3600000,
          goal: 'ログイン画面の二重送信を直す',
          line: '送信中はボタンを無効にして、テストを2件足しました。',
          note: 'レビュー待ち',
        }),
        row('refactor the auth middleware', {
          status: 'Working',
          tone: 'working',
          where: {branch: 'auth-token'},
          ctx: 40000,
          age: 42 * 60000,
          goal: '認証ミドルウェアをセッション方式からトークン方式へ移す',
          line: '→ admin 配下のルートも移して',
        }),
      ],
    },
  ],
  keys: 'keys',
  side: {
    title: 'fix-login',
    recap: {
      goal: 'ログイン画面の二重送信を直す',
      now: '送信ボタンを押下中は無効にし、テストを2件足した。PR #58 を作った。',
      next: 'レビューの指摘を待つ',
    },
    links: [
      link('PR #58', 'https://github.com/acme/app/pull/58'),
      link('acme/app#412', 'https://github.com/acme/app/issues/412'),
      link('acme/app@3f2a91c', 'https://github.com/acme/app/commit/3f2a91c'),
    ],
  },
  ...over,
});

describe('まとめの画面', () => {
  it('目的の行は一言の上に出る(目的 → 一言 → ⚙ → ↳ メモ)', () => {
    const lines = plain(screen(100, {side: undefined}));
    const i = lines.findIndex(l => l.includes('◎ ログイン画面の二重送信を直す'));
    expect(i).toBeGreaterThan(0);
    expect(lines[i + 1]).toContain('送信中はボタンを無効にして');
    expect(lines[i + 2]).toContain('↳ レビュー待ち');
    expect(lines[i - 1]).toMatch(/^> fix-login/);
  });

  it(`端末が ${SIDE_MIN_COLS} 桁以上なら右に欄を出し、どの行も端末の幅に収める`, () => {
    const lines = plain(screen(150));
    expect(lines[0]).toMatch(/SESSION.*│ fix-login$/);
    expect(lines.some(l => /│ Goal {2}ログイン画面の二重送信を直す$/.test(l))).toBe(true);
    expect(lines.some(l => /│ Links$/.test(l))).toBe(true);
    for (const l of render(screen(150))) expect(width(l)).toBeLessThanOrEqual(150);
    // 最下部のキーの説明は全幅のまま
    expect(lines.at(-1)).toBe('keys');
  });

  it(`${SIDE_MIN_COLS} 桁より狭ければ右の欄を出さない(目的の行は出る)`, () => {
    const lines = plain(screen(SIDE_MIN_COLS - 1));
    expect(lines.some(l => l.includes('│ Goal'))).toBe(false);
    expect(lines.some(l => l.includes('◎ ログイン'))).toBe(true);
  });

  it('まとめのない行では、まだないことを出す。高さに収まらない分は切る', () => {
    const none = sideLines({title: 'demo', links: []}, 46, 20).map(stripAnsi);
    expect(none[2]).toMatch(/^No recap yet\./);
    const many = sideLines(
      {
        title: 't',
        recap: {goal: 'g', now: 'n', next: 'x'},
        links: ['1', '2', '3', '4', '5', '6', '7'].map(x => link(x)),
      },
      46,
      30,
    ).map(l => stripAnsi(unlink(l)));
    expect(many).toContain('  5');
    expect(many).toContain('  +2 more');
    const cut = sideLines(
      {title: 't', recap: {goal: 'g', now: 'n', next: 'x'}, links: [link('1'), link('2')]},
      46,
      4,
    ).map(stripAnsi);
    expect(cut).toEqual(['t', '', 'Goal  g', '…']);
  });

  it('右の欄のリンクは、埋め込みのリンク(OSC 8)で描き、幅には名前だけを数える', () => {
    const raw = render(screen(150));
    const pr = raw.find(l => l.includes('PR #58') && l.includes('\x1b]8;;'));
    expect(pr).toContain('\x1b]8;;https://github.com/acme/app/pull/58\x1b\\PR #58\x1b]8;;\x1b\\');
    for (const l of raw) expect(width(l)).toBeLessThanOrEqual(150);
    // 名前が長くて切るときも、切るのは名前だけで、リンクの先は全部残す
    const long = sideLines({title: 't', links: [link('x'.repeat(80), 'https://example.com/long')]}, 46, 20);
    const l = long.find(x => x.includes('\x1b]8;;')) ?? '';
    expect(l).toContain('\x1b]8;;https://example.com/long\x1b\\');
    expect(width(l)).toBe(46);
    // http(s) でない先や制御文字を含む先は、リンクにしない
    expect(hyperlink('javascript:alert(1)', 'x')).toBe('x');
    expect(hyperlink('https://a.example/\x07\x1b]8;;evil', 'x')).toBe('x');
    expect(hyperlink('https://a.example/ b', 'x')).toBe('x');
    expect(hyperlink('https://ja.wikipedia.org/wiki/東京', '東京')).toBe(
      '\x1b]8;;https://ja.wikipedia.org/wiki/東京\x1b\\東京\x1b]8;;\x1b\\',
    );
  });

  it('折り返しは表示幅で数え、空白があればその後ろで折る', () => {
    expect(wrap('あいうえお', 4)).toEqual(['あい', 'うえ', 'お']);
    expect(wrap('move the admin routes too', 12)).toEqual(['move the', 'admin routes', 'too']);
    // 日本語の中の英数字の語も、語の途中では折らない
    expect(wrap('案を提示。issue #412 と README は未確認', 14)).toEqual([
      '案を提示。',
      'issue #412 と',
      'README は未確',
      '認',
    ]);
    // 句読点は行の頭に置かない
    expect(wrap('あいう。えお', 6)).toEqual(['あい', 'う。え', 'お']);
  });
});

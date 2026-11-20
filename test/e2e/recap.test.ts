import {mkdirSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {afterEach, describe, expect, it} from 'vitest';
import {bg, CLI, Harness, REPO, sid, sleep, tty} from './harness.js';

// まとめ(PRODUCT.md「まとめ」)。mod の代わりに、テストが受け口へまとめの本文を送る。
// WN_CAPTURE=<ディレクトリ> を付けて流すと、取った画面をそこに書く(見た目の決定に使う)。

let h: Harness;
afterEach(() => h?.cleanup());

const capture = (name: string, screen: string) => {
  const dir = process.env.WN_CAPTURE;
  if (!dir) return;
  mkdirSync(dir, {recursive: true});
  writeFileSync(join(dir, `${name}.txt`), screen);
};

async function post(port: number, body: object): Promise<void> {
  await fetch(`http://127.0.0.1:${port}/v1/hooks`, {
    method: 'POST',
    headers: {'content-type': 'application/json'},
    body: JSON.stringify(body),
  });
}

const recap = (id: string, r: {goal: string; now: string; next: string} | null, links: [string, string][] = []) => ({
  hook_event_name: 'WhatnextRecap',
  session_id: sid(id),
  recap: r,
  links: links.map(([label, href]) => ({label, href})),
});

function rows(app: string, demo: string) {
  return [
    bg('fixlogin', {name: 'fix-login', cwd: app, state: 'done'}),
    bg('refactor', {name: 'refactor the auth middleware', cwd: app, state: 'working', status: 'busy'}),
    bg('demoread', {name: 'demo readme', cwd: demo, state: 'done'}),
    tty('ttyrow', {name: 'scratch', cwd: demo}),
  ];
}

async function sendAll(port: number): Promise<void> {
  await post(
    port,
    recap(
      'fixlogin',
      {
        goal: 'ログイン画面の二重送信を直す',
        now: '送信ボタンを押下中は無効にし、テストを2件足した。PR #58 を作った。',
        next: 'レビューの指摘を待つ',
      },
      [
        ['PR #58', 'https://github.com/acme/app/pull/58'],
        ['acme/app#412', 'https://github.com/acme/app/issues/412'],
        ['acme/app@3f2a91c', 'https://github.com/acme/app/commit/3f2a91c'],
      ],
    ),
  );
  await post(
    port,
    recap(
      'refactor',
      {
        goal: '認証ミドルウェアをセッション方式からトークン方式へ移す',
        now: 'ルートの半分を移し終えた。残りは admin 配下。',
        next: 'admin 配下のルートを移す',
      },
      [['acme/infra#77', 'https://github.com/acme/infra/issues/77']],
    ),
  );
  await post(port, recap('demoread', {goal: 'README.mdの末尾に「hello」の行を追加する', now: '行を足した', next: ''}));
}

const ago = (min: number) => new Date(Date.now() - min * 60000).toISOString();

/** 一言の出どころの会話記録(画面の例と同じ一言にする)。 */
function talk(x: Harness): void {
  const said = (id: string, prompt: string, answer: string | undefined, min: number) =>
    x.transcript(sid(id), [
      {type: 'user', message: {role: 'user', content: prompt}, timestamp: ago(min)},
      ...(answer
        ? [
            {
              type: 'assistant',
              message: {role: 'assistant', content: [{type: 'text', text: answer}]},
              timestamp: ago(1),
            },
          ]
        : []),
    ]);
  said('fixlogin', 'ログイン画面の二重送信を直して', '送信中はボタンを無効にして、テストを2件足しました。', 300);
  said('refactor', 'admin 配下のルートも移して', undefined, 42);
  said('demoread', 'README に hello の行を足して', 'README.md に hello の行を足しました。', 3);
}

describe('まとめ', () => {
  it('80・81: --recap で起動すると、届いたまとめの目的が各行の一言の上に、カーソルの行のまとめとリンクが右の欄に出る', async () => {
    h = new Harness();
    const app = h.repo('app');
    const demo = h.repo('demo');
    h.agents(rows(app, demo));
    talk(h);
    await h.start({args: '--recap', size: {cols: 150, rows: 30}});
    await sendAll(h.port);
    let s = await h.refresh();
    s = await h.waitFor(/◎ README/);
    capture('recap-150-cursor-first', s);
    const lines = s.split('\n');
    const goal = lines.findIndex(l => l.includes('◎ ログイン画面の二重送信を直す'));
    expect(lines[goal - 1]).toMatch(/fix-login/);
    expect(lines[goal + 1]).toMatch(/送信中はボタンを無効にして/);
    expect(s).toMatch(/◎ 認証ミドルウェアをセッション方式からトークン方式へ移す/);
    expect(s).toMatch(/│ Goal {2}ログイン画面の二重送信を直す/);
    expect(s).toMatch(/│ Now {3}送信ボタンを押下中は無効にし/);
    expect(s).toMatch(/│ Next {2}レビューの指摘を待つ/);
    expect(s).toMatch(/│ Links\n.*│ {3}PR #58\n.*│ {3}acme\/app#412/);
    expect(s).toMatch(/o links/);
    // カーソルを動かすと、右の欄がその行に替わる
    await h.select('refactor the auth middleware');
    s = await h.waitFor(/│ refactor the auth middleware/);
    capture('recap-150-cursor-second', s);
    expect(s).toMatch(/│ Goal {2}認証ミドルウェアを/);
    expect(s).toMatch(/│ {5}acme\/infra#77|│ {3}acme\/infra#77/);
    // まとめのない行((tty) の行)
    await h.select('scratch');
    s = await h.waitFor(/│ scratch/);
    capture('recap-150-no-recap', s);
    expect(s).toMatch(/│ No recap yet\./);
  });

  it('81: 端末が狭いと右の欄は出ず、目的の行だけが出る', async () => {
    h = new Harness();
    const app = h.repo('app');
    const demo = h.repo('demo');
    h.agents(rows(app, demo));
    talk(h);
    await h.start({args: '--recap', size: {cols: 110, rows: 30}});
    await sendAll(h.port);
    await h.refresh();
    const s = await h.waitFor(/◎ README/);
    capture('recap-110', s);
    expect(s).not.toMatch(/│ Goal/);
    expect(s).toMatch(/◎ ログイン画面の二重送信を直す/);
  });

  it('82: --recap なしでは、まとめが届いても今までどおり', async () => {
    h = new Harness();
    const app = h.repo('app');
    const demo = h.repo('demo');
    h.agents(rows(app, demo));
    talk(h);
    await h.start({size: {cols: 150, rows: 30}});
    await sendAll(h.port);
    const s = await h.refresh();
    expect(s).not.toMatch(/◎|│ Goal|o links/);
  });

  it('83: n で起動するセッションに --recap のときだけ mod が付く', async () => {
    h = new Harness();
    const app = h.repo('app');
    await h.start({cwd: app, args: '--recap'});
    await h.keys('n', 'Enter');
    await h.waitFor(/fake claude attached/, 10000);
    const call = h.calls().find(c => c.args[0] === '--bg');
    const i = call?.args.indexOf('--plugin-dir') ?? -1;
    expect(i).toBeGreaterThan(0);
    expect(call?.args[i + 1]).toBe(join(REPO, 'mod'));
    const settings = JSON.parse(call?.args[(call?.args.indexOf('--settings') ?? 0) + 1] ?? '{}');
    expect(settings.env.WHATNEXT_RECAP_PORT).toBe(String(h.port));
  });

  it('83: --recap なしの n には mod が付かない', async () => {
    h = new Harness();
    const app = h.repo('app');
    await h.start({cwd: app});
    await h.keys('n', 'Enter');
    await h.waitFor(/fake claude attached/, 10000);
    const call = h.calls().find(c => c.args[0] === '--bg');
    expect(call?.args).not.toContain('--plugin-dir');
  });

  it('84: o でカーソルの行のリンクを選んで開く。リンクのない行では、ないことを示す', async () => {
    h = new Harness();
    const app = h.repo('app');
    const demo = h.repo('demo');
    h.agents(rows(app, demo));
    await h.start({args: '--recap', size: {cols: 150, rows: 30}});
    await sendAll(h.port);
    await h.refresh();
    await h.select('fix-login');
    await h.keys('o');
    const s = await h.waitFor(/Links of fix-login:/);
    capture('recap-links-menu', s);
    expect(s).toMatch(/^> PR #58 +│\n {2}acme\/app#412 +│$/m);
    await h.keys('Down', 'Enter');
    await h.waitFor(/Opened acme\/app#412\./);
    expect(h.file('open.log').trim()).toBe('https://github.com/acme/app/issues/412');
    await h.select('demo readme');
    await h.keys('o');
    await h.waitFor(/No links for demo readme\./);
  });

  it('85: 消えたセッションのまとめは捨てる。制御文字は落とす', async () => {
    h = new Harness();
    const app = h.repo('app');
    const demo = h.repo('demo');
    h.agents(rows(app, demo));
    await h.start({args: '--recap', size: {cols: 150, rows: 30}});
    await post(h.port, recap('fixlogin', {goal: 'evil\x1b[2Jgoal\nx', now: 'n', next: 'x'}));
    let s = await h.refresh();
    expect(s).toMatch(/◎ evil\[2Jgoal x/);
    h.remove(sid('fixlogin').slice(0, 8));
    await h.refresh();
    h.agents(rows(app, demo));
    s = await h.refresh();
    expect(s).not.toMatch(/◎ evil/);
  });

  it('86: --recap なしで動いている一覧に whatnext --recap でつなぐと、そのことが示される', async () => {
    h = new Harness();
    h.agents([bg('a', {name: 'alpha'})]);
    await h.start();
    h.open('second', `${h.envLine()} node ${CLI} --recap`);
    await sleep(1500);
    const s = await h.waitFor(
      /whatnext is running without --recap\. Quit it, then run "whatnext --recap" to see recaps\./,
      8000,
      'second',
    );
    expect(s).toMatch(/alpha/);
  });
});

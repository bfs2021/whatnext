import {type ChildProcess, spawn} from 'node:child_process';
import {mkdirSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {afterEach, describe, expect, it} from 'vitest';
import {bg, CLI, escapeRe, Harness, REPO, sid, sleep, tty} from './harness.js';

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

  describe('84: o のメニューを開いている間に更新でリンクが替わっても、Enter は画面で選んでいたリンクを開く', () => {
    const L58: [string, string] = ['PR #58', 'https://github.com/acme/app/pull/58'];
    const L412: [string, string] = ['acme/app#412', 'https://github.com/acme/app/issues/412'];
    const L60: [string, string] = ['PR #60', 'https://github.com/acme/app/pull/60'];
    const links = (ls: [string, string][]) => recap('fixlogin', {goal: 'g', now: 'n', next: 'x'}, ls);

    async function openMenuOn412(): Promise<void> {
      const app = h.repo('app');
      h.agents([bg('fixlogin', {name: 'fix-login', cwd: app}), bg('other', {name: 'other', cwd: app})]);
      await h.start({args: '--recap', size: {cols: 150, rows: 30}});
      await post(h.port, links([L58, L412]));
      await h.refresh();
      await h.select('fix-login');
      // 更新の直後に開く(次の更新は 60 秒後)
      await h.refresh();
      await h.keys('o', 'Down');
      await h.waitFor(/^> acme\/app#412/m);
    }

    it('新しいまとめが届いたとき', async () => {
      h = new Harness();
      await openMenuOn412();
      await post(h.port, links([L60, L58, L412]));
      await sleep(65000); // 60 秒ごとの更新を待つ
      expect(h.screen()).toMatch(/^> acme\/app#412/m);
      await h.keys('Enter');
      await h.waitFor(/Opened acme\/app#412\./);
      expect(h.file('open.log').trim()).toBe(L412[1]);
    }, 120000);

    it('セッションが消えたとき', async () => {
      h = new Harness();
      await openMenuOn412();
      h.remove(sid('fixlogin').slice(0, 8));
      await sleep(65000);
      await h.keys('Enter');
      await h.waitFor(/Opened acme\/app#412\./);
      expect(h.file('open.log').trim()).toBe(L412[1]);
    }, 120000);
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

  it('81: 右の欄のリンクは、埋め込みのリンク(OSC 8)で端末に届く', async () => {
    // 外側の tmux が端末の代わり。中の tmux は、外側が tmux だと問い合わせの応答で知り、hyperlinks を付ける
    h = new Harness();
    const app = h.repo('app');
    const demo = h.repo('demo');
    h.agents(rows(app, demo));
    await h.start({args: '--recap', size: {cols: 150, rows: 30}, env: {TERM: 'xterm-256color'}});
    await sendAll(h.port);
    await h.refresh();
    await h.select('fix-login');
    await h.waitFor(/│ {3}PR #58/);
    const s = h.screenWithEscapes();
    capture('recap-links-osc8', s);
    // tmux は外側の端末に送るとき、リンクに id を足す(`8;id=tmux1;<URL>`)
    const osc8 = (href: string) => new RegExp(`\x1b\\]8;[^;\x1b]*;${escapeRe(href)}\x1b\\\\(.*?)\x1b\\]8;;\x1b\\\\`);
    expect(s).toMatch(osc8('https://github.com/acme/app/pull/58'));
    expect(osc8('https://github.com/acme/app/pull/58').exec(s)?.[1]).toBe('PR #58');
    expect(osc8('https://github.com/acme/app/issues/412').exec(s)?.[1]).toBe('acme/app#412');
    // 見た目は今までと同じ(リンクの列は幅を取らない)
    expect(h.screen()).toMatch(/│ Links\n.*│ {3}PR #58\n.*│ {3}acme\/app#412/);
  });

  describe('41 の例外: 受け口のポートをほかのプログラムが使っているとき', () => {
    let py: ChildProcess | undefined;
    afterEach(() => {
      py?.kill();
      py = undefined;
    });

    it('--recap では mod を付けず、右の欄に、まとめが届かない理由を出す', async () => {
      h = new Harness();
      h.port = 15000 + Math.floor(Math.random() * 900);
      py = spawn('python3', ['-m', 'http.server', String(h.port), '--bind', '127.0.0.1'], {
        stdio: 'ignore',
        cwd: h.dir,
      });
      await sleep(1500);
      const app = h.repo('app');
      h.agents([bg('alpha', {name: 'alpha', cwd: app})]);
      await h.start({cwd: app, args: '--recap', size: {cols: 150, rows: 30}});
      await h.keys('n', 'Enter');
      await h.waitFor(/fake claude attached/, 10000);
      const call = h.calls().find(c => c.args[0] === '--bg');
      expect(h.log()).toMatch(/occupant=other receiver=none recap=true/);
      expect(call?.args).not.toContain('--plugin-dir');
      await h.keys('C-q', 'C-l');
      await h.select('alpha');
      const s = await h.waitFor(/│ alpha/);
      capture('recap-port-used', s);
      expect(s).not.toMatch(/Recaps come from sessions/);
      expect(s).toMatch(new RegExp(`│ Recaps are off: port ${h.port} is used by another\\s*\\n.*│ program\\.`));
      // ◎ の行と右の欄はそのまま(o links もキーの説明に残る)
      expect(s).toMatch(/o links/);
    });
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

const WIDE_NAME = 'refactor the auth middleware';
const WIDE = {cols: 120, rows: 30};

describe('81: 右の欄を出していても、一覧の下の確認の問い・入力欄・知らせとメモの入力欄は、端末の幅に収まる限り末尾まで見える', () => {
  it('作業台で2つ動いている行の削除の確認が、[y/N] まで見える', async () => {
    h = new Harness();
    const app = h.repo('app');
    h.agents([
      bg('a', {name: WIDE_NAME, cwd: app, state: 'stopped', pid: undefined, status: undefined}),
      bg('b', {name: 'fix-login', cwd: app}),
    ]);
    await h.start({args: '--recap', size: WIDE});
    await h.select(WIDE_NAME);
    await h.keys('w');
    await sleep(800);
    h.inner('split-window', '-t', '=sh-a0000000:');
    await sleep(300);
    const panes = h.inner('list-panes', '-t', '=sh-a0000000:', '-F', '#{pane_id}').trim().split('\n');
    h.inner('send-keys', '-t', panes[0] as string, 'tail -f /dev/null', 'Enter');
    h.inner('send-keys', '-t', panes[1] as string, 'sleep 1004', 'Enter');
    await sleep(800);
    await h.keys('C-x');
    await h.waitFor(/Press Ctrl\+X again within 2s to delete\./);
    await h.keys('C-x');
    const s = await h.waitFor(/Delete refactor the auth middleware and stop/);
    capture('recap-wide-confirm', s);
    expect(s).toMatch(/Delete refactor the auth middleware and stop .*\[y\/N\]/);
    await h.keys('n');
  });

  it('知らせが末尾まで見える', async () => {
    h = new Harness();
    const app = h.repo('app');
    h.agents([tty('t', {name: WIDE_NAME, cwd: app}), bg('b', {name: 'fix-login', cwd: app})]);
    await h.start({args: '--recap', size: WIDE});
    await h.select(WIDE_NAME);
    await h.keys('t');
    const s = await h.waitFor(/is an interactive session/);
    capture('recap-wide-notice', s);
    expect(s).toContain(`${WIDE_NAME} is an interactive session. It has no workbench.`);
  });

  it('n の Other... の入力欄が、打った文字の末尾(カーソル)まで見える', async () => {
    h = new Harness();
    const app = h.repo('app');
    h.agents([bg('b', {name: 'fix-login', cwd: app})]);
    await h.start({args: '--recap', size: WIDE, cwd: app});
    await h.keys('n');
    await h.waitFor(/New session in:/);
    await h.type('zzzz');
    await h.keys('Enter');
    await h.waitFor(/Directory:/);
    const path = '~/ghq/github.com/example-org/some-long-repository-name/packages/backend-api';
    await h.type(path);
    const s = await h.waitFor(/Directory: /);
    capture('recap-wide-input', s);
    expect(s).toContain(`Directory: zzzz${path}█`);
  });

  it('メモの入力欄が、打った文字の末尾(カーソル)まで見える', async () => {
    h = new Harness();
    const app = h.repo('app');
    h.agents([bg('a', {name: WIDE_NAME, cwd: app}), bg('b', {name: 'fix-login', cwd: app})]);
    await h.start({args: '--recap', size: WIDE});
    await h.select(WIDE_NAME);
    await h.keys('e');
    await h.waitFor(/Note for /);
    const note = 'wait for the review of PR #58 before merging';
    await h.type(note);
    const s = await h.waitFor(/Note for /);
    capture('recap-wide-note', s);
    expect(s).toContain(`Note for ${WIDE_NAME}: ${note}█`);
  });
});

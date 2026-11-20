import type {On, SessionMessage} from 'claude-code';
import type {Engine} from 'claude-code/testing';
import {expect, test} from 'claude-code/testing';

import {addLinks, linkOf, urlsIn} from '../hooks/links';
import {parseRecap, RECAP_SYSTEM, recapPrompt} from '../hooks/recap';

// Run with `npm run test:mod` (`claude plugin test mod`). The engine's hooks below stand for Claude Code.

const PANE = {
  plugin: 'whatnext-recap',
  component: 'Pane',
  requestId: 'whatnext-recap',
  props: {
    title: 'Recap',
    isFocused: false,
    bodyColumns: 44,
    placement: 'dock',
    scroll: {offset: 0, bodyRows: 40},
    view: {},
  },
} as const;

declare function setTimeout(fn: () => void, ms: number): unknown;
const settle = () => new Promise<void>(r => setTimeout(r, 300));
const usage = {input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0};

interface Posted {
  url: string;
  body: Record<string, unknown>;
}

/** The engine beneath the mod: `history` the conversation, `answer` what Haiku says, posts kept in `posted`. */
function engine(
  on: On,
  opts: {history?: () => readonly SessionMessage[]; answer?: string; port?: string; asks?: string[]} = {},
): Posted[] {
  const posted: Posted[] = [];
  on('session.messages', () => ({value: (opts.history?.() ?? []) as SessionMessage[]}));
  on('session.id', () => ({value: 'sid-1'}));
  on('env.get', (_, e) => ({value: e.name === 'WHATNEXT_RECAP_PORT' ? opts.port : undefined}));
  on('model.complete', (_, e) => {
    opts.asks?.push(String(e.prompt));
    if (opts.answer === undefined || e.system !== RECAP_SYSTEM) {
      return {value: {isAnswered: false, reason: 'aborted', usage}};
    }
    return {value: {isAnswered: true, text: opts.answer, usage}};
  });
  on('http.fetch', (_, e) => {
    posted.push({url: e.url, body: JSON.parse(String(e.init?.body ?? '{}'))});
    return {value: {status: 204, ok: true, headers: {}, text: ''}};
  });
  on('ui.open', () => ({value: {isPlaced: true}}));
  on('command.register', () => ({value: {command: 'wn-recap'}}));
  on('session.start', (_, e) => ({cwd: e.cwd}));
  on('turn.start', (_, e) => ({turnId: e.turnId}));
  on('turn.complete', () => ({text: ''}));
  return posted;
}

async function turn($: Engine, prompt: string, answer: string, id = 't1'): Promise<void> {
  await $.turn.start({text: prompt, turnId: id});
  await $.turn.complete({answer, durationMs: 10, isAborted: false, turnId: id, reason: 'answer'} as never);
  await settle();
}

test('at a turn end the recap and the links go to whatnext, on the port whatnext gave', async ($, on) => {
  const prompts: SessionMessage[] = [{role: 'user', text: 'ログイン画面の二重送信を直して', toolUses: []}];
  const posted = engine(on, {
    history: () => prompts,
    port: '14555',
    answer: '{"goal": "ログイン画面の二重送信を直す", "now": "ボタンを無効にした", "next": "レビューを待つ"}',
  });
  await $.session.start({cwd: '/', surface: 'terminal', isInteractive: true});
  await turn($, 'ログイン画面の二重送信を直して', '直しました。[PR #58](https://github.com/acme/app/pull/58)');
  const last = posted.at(-1);
  expect(last?.url).toBe('http://127.0.0.1:14555/v1/hooks');
  expect(last?.body).toEqual({
    hook_event_name: 'WhatnextRecap',
    session_id: 'sid-1',
    recap: {goal: 'ログイン画面の二重送信を直す', now: 'ボタンを無効にした', next: 'レビューを待つ'},
    links: [{label: 'PR #58', href: 'https://github.com/acme/app/pull/58'}],
  });
});

test('with no port given it posts to 14318; a failed model call still sends the links', async ($, on) => {
  const posted = engine(on, {history: () => [{role: 'user', text: 'x', toolUses: []}]});
  await $.session.start({cwd: '/', surface: 'terminal', isInteractive: true});
  await turn($, 'see https://github.com/acme/app/issues/412', 'ok');
  expect(posted.at(-1)?.url).toBe('http://127.0.0.1:14318/v1/hooks');
  expect(posted.at(-1)?.body.recap).toBe(null);
  expect(posted.at(-1)?.body.links).toEqual([{label: 'acme/app#412', href: 'https://github.com/acme/app/issues/412'}]);
});

test('the next recap reads the previous one, the instructions and the last answer', async ($, on) => {
  const asks: string[] = [];
  const history: SessionMessage[] = [
    {role: 'user', text: '認証をトークン方式へ移して', toolUses: []},
    {role: 'assistant', text: '半分移しました', toolUses: []},
  ];
  engine(on, {history: () => history, asks, answer: '{"goal": "認証を移す", "now": "半分", "next": "admin"}'});
  await $.session.start({cwd: '/', surface: 'terminal', isInteractive: true});
  await turn($, '認証をトークン方式へ移して', '半分移しました');
  history.push({role: 'user', text: 'admin 配下も', toolUses: []});
  await turn($, 'admin 配下も', '移しました', 't2');
  expect(asks.at(-1)).toContain('## Previous recap');
  expect(asks.at(-1)).toContain('"goal":"認証を移す"');
  expect(asks.at(-1)).toContain('- admin 配下も');
  expect(asks.at(-1)).toContain('移しました');
});

test('the pane draws Goal, Now, Next and the links under the same headings as the list', async ($, on) => {
  engine(on, {
    history: () => [{role: 'user', text: 'x', toolUses: []}],
    answer: '{"goal": "G", "now": "N", "next": "X"}',
  });
  await $.session.start({cwd: '/', surface: 'terminal', isInteractive: true});
  await turn($, 'x', 'https://github.com/acme/app/commit/3f2a91c0aa');
  const ui = await $.ui.mount({...PANE, surface: 'terminal'});
  for (const t of [/^Goal$/, /^Now$/, /^Next$/, /^Links$/, /^G$/, /^N$/, /^X$/]) {
    expect(await ui.find({type: 'Text', text: t})).toBeTruthy();
  }
  expect((await ui.findAll({type: 'Link'})).map(l => l.props.href)).toEqual([
    'https://github.com/acme/app/commit/3f2a91c0aa',
  ]);
  await ui.unmount();
});

test('before the first turn ends the pane says no recap yet', async ($, on) => {
  engine(on);
  await $.session.start({cwd: '/', surface: 'terminal', isInteractive: true});
  const ui = await $.ui.mount({...PANE, surface: 'terminal'});
  expect(await ui.find({type: 'Text', text: /No recap yet/})).toBeTruthy();
  await ui.unmount();
});

test('the recap is parsed from JSON, cut to its lengths, and none when it is empty or not JSON', () => {
  expect(parseRecap('```json\n{"goal": "a", "now": "b", "next": ""}\n```')).toEqual({goal: 'a', now: 'b', next: ''});
  expect(parseRecap('no json')).toBe(null);
  expect(parseRecap('{"goal": "", "now": "", "next": ""}')).toBe(null);
  expect(parseRecap(`{"goal": "${'x'.repeat(200)}"}`)?.goal.length).toBe(80);
  expect(recapPrompt(null, ['a'], '')).not.toContain('Previous recap');
});

// The link rules, moved with links.ts from session-timeline.

test('URLs are cut where the text around them begins', () => {
  expect(urlsIn('PR は https://github.com/o/r/pull/51 です。')).toEqual(['https://github.com/o/r/pull/51']);
  expect(urlsIn('see [#44](https://github.com/o/r/issues/44).')).toEqual(['https://github.com/o/r/issues/44']);
  expect(urlsIn('(https://example.com/a_(b))')).toEqual(['https://example.com/a_(b)']);
  expect(urlsIn('"https://example.com/x",')).toEqual(['https://example.com/x']);
  expect(urlsIn('http://localhost:3000/ok')).toEqual(['http://localhost:3000/ok']);
  // biome-ignore lint/suspicious/noTemplateCurlyInString: a template a text holds, not a page to open
  expect(urlsIn('https://${host}/x and https://foo')).toEqual([]);
  expect(urlsIn('https://docs.example.com/a(下書き)')).toEqual(['https://docs.example.com/a']);
});

test('GitHub issues, PRs and commits are named by number however the URL goes on', () => {
  expect(linkOf('https://github.com/o/r/pull/51/files#diff-1')?.label).toBe('o/r#51');
  expect(linkOf('https://github.com/o/r/issues/44#issuecomment-1')?.kind).toBe('Issue');
  expect(linkOf('https://github.com/o/r/commit/e26d750abc')?.label).toBe('o/r@e26d750');
  expect(linkOf('https://github.com/o/r')?.kind).toBe('URL');
});

test('a link said again moves to the front; a Markdown link names it', () => {
  const one = addLinks(
    [],
    ['https://github.com/o/r/issues/1 と https://docs.example.com/a', 'https://github.com/o/r/pull/2'],
  );
  expect(one.map(l => l.label)).toEqual(['o/r#2', 'docs.example.com/a', 'o/r#1']);
  const two = addLinks(one, ['[the issue](https://github.com/o/r/issues/1)']);
  expect(two.map(l => l.text ?? l.label)).toEqual(['the issue', 'o/r#2', 'docs.example.com/a']);
});

test("a tool call's output is not listed; its URL argument is", async ($, on) => {
  const posted = engine(on, {history: () => [{role: 'user', text: 'x', toolUses: []}]});
  on('tool.call', (_, e) => ({text: e.tool === 'Bash' ? 'https://noise.example.com/z' : '', result: {}}));
  await $.session.start({cwd: '/', surface: 'terminal', isInteractive: true});
  await $.turn.start({text: 'x', turnId: 't1'});
  await $.tool.call({tool: 'Bash', command: 'gh pr list', tool_use_id: 'b1'});
  await $.tool.call({tool: 'WebFetch', url: 'https://docs.example.com/mods', prompt: 'read', tool_use_id: 'w1'});
  await $.turn.complete({answer: 'ok', durationMs: 1, isAborted: false, turnId: 't1', reason: 'answer'} as never);
  await settle();
  expect(posted.at(-1)?.body.links).toEqual([{label: 'docs.example.com/mods', href: 'https://docs.example.com/mods'}]);
});

import type {EngineInterface, Register} from 'claude-code';
import {atom, read, update} from 'claude-code';

import type {FoundLink, Recap} from '../types';
import type {Mention} from './links';
import {addLinks, mentionsOf, NOT_ARGUMENTS, toolMentions} from './links';
import {nameOf, parseRecap, promptsOf, RECAP_SYSTEM, recapBody, recapPrompt} from './recap';

// The mod whatnext gives the sessions it starts with `n` while it runs with `--recap` (docs/DESIGN.md "まとめの mod").
// At each turn end it recaps the session (goal, now, next) with Haiku, keeps the links said in the conversation,
// draws both in a pane and posts them to whatnext's receiver. Sending fails silently.

const PANE = 'whatnext-recap';
const COMMAND = 'wn-recap';
/** How many links the pane draws; the rest are counted. */
const SHOWN_LINKS = 8;
const DEFAULT_PORT = '14318';

const recap = atom({plugin: 'whatnext-recap', key: 'recap'} as const, null as Recap, {shape: 'recap-1'});
const links = atom({plugin: 'whatnext-recap', key: 'links'} as const, [] as FoundLink[], {shape: 'links-1'});

/** The newest recap asked for: an older answer that comes back later is dropped. */
let asked = 0;

async function receiverUrl($: EngineInterface): Promise<string> {
  const port = (await $.env.get('WHATNEXT_RECAP_PORT').catch(() => undefined)) || DEFAULT_PORT;
  return `http://127.0.0.1:${/^\d+$/.test(port) ? port : DEFAULT_PORT}/v1/hooks`;
}

async function send($: EngineInterface): Promise<void> {
  const sid = await $.session.id().catch(() => '');
  if (!sid) return;
  const body = recapBody(sid, await read($, recap), await read($, links));
  await $.http
    .fetch(await receiverUrl($), {
      method: 'POST',
      headers: {'content-type': 'application/json'},
      body: JSON.stringify(body),
    })
    .catch(() => undefined);
}

async function noteLinks($: EngineInterface, mentions: readonly Mention[]): Promise<void> {
  if (mentions.length === 0) return;
  await update($, links, known => addLinks(known, mentions));
}

async function writeRecap($: EngineInterface, answer: string): Promise<void> {
  const mine = ++asked;
  const messages = await $.session.messages().catch(() => undefined);
  const prompts = Array.isArray(messages) ? promptsOf(messages) : [];
  const prev = await read($, recap);
  if (prompts.length > 0 || answer) {
    const r = await $.model.complete({
      model: 'haiku',
      system: RECAP_SYSTEM,
      prompt: recapPrompt(prev, prompts, answer),
      maxTokens: 400,
      effort: 'low',
      timeoutMs: 45000,
    });
    if (mine !== asked) return;
    const next = r.isAnswered ? parseRecap(r.text) : null;
    if (next) await update($, recap, () => next);
  }
  await send($);
}

async function openPane($: EngineInterface): Promise<void> {
  await $.ui.open({id: PANE, title: 'Recap', columns: 46});
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({name: COMMAND, description: 'Open the recap pane (goal, now, next and links)'});
    // The history the session resumed: its links, read again.
    const messages = await $.session.messages().catch(() => undefined);
    if (Array.isArray(messages)) await update($, links, () => addLinks([], mentionsOf(messages)));
    void openPane($).catch(() => undefined);
    return next(e);
  });

  on('command.run', {command: COMMAND}, async $ => {
    await openPane($);
    return {text: 'Recap pane opened.'};
  }).catch(() => ({text: 'Could not open the recap pane.'}));

  on('turn.start', async ($, e, next) => {
    if (!e.agentId) await noteLinks($, [e.text]).catch(() => undefined);
    return next(e);
  });

  // What Claude writes mid-turn, before a tool call: the turn's last words are not all of it.
  on('turn.step', async function* ($, e, next) {
    const r = yield* next(e);
    if (!e.agentId && r.answer) await noteLinks($, [r.answer]).catch(() => undefined);
    return r;
  });

  on('tool.call', async ($, e, next) => {
    const ran = await next(e);
    if (!e.agentId) {
      const args = Object.fromEntries(Object.entries(e).filter(([k]) => !NOT_ARGUMENTS.includes(k)));
      await noteLinks($, toolMentions(e.tool, args)).catch(() => undefined);
    }
    return ran;
    // The mod only watches: what it fails at never stops the call (`next(e)` replays a call already made).
  }).catch((_$, e, next) => next(e));

  on('turn.complete', async ($, e, next) => {
    const done = await next(e);
    if (!e.agentId) {
      await noteLinks($, [e.answer]).catch(() => undefined);
      // Not awaited: the turn's end is not held for the model call.
      void writeRecap($, e.reason === 'answer' ? e.answer : '').catch(() => send($).catch(() => undefined));
    }
    return done;
  });

  on('ui.render', {component: 'Pane', requestId: PANE}, async ($, e) => {
    const {Box, Text, Link} = $.ui.resolve(e);
    const r = await read($, recap);
    const found = await read($, links);
    const field = (label: string, value: string) => (
      <Box flexDirection="row">
        <Box width={6} flexShrink={0}>
          <Text bold>{label}</Text>
        </Box>
        <Box flexGrow={1}>
          <Text>{value || '-'}</Text>
        </Box>
      </Box>
    );
    return (
      <Box flexDirection="column">
        {r ? (
          <Box flexDirection="column">
            {field('Goal', r.goal)}
            {field('Now', r.now)}
            {field('Next', r.next)}
          </Box>
        ) : (
          <Text dimColor>No recap yet. It comes when a turn ends.</Text>
        )}
        {found.length > 0 ? (
          <Box flexDirection="column" marginTop={1}>
            <Text bold>Links</Text>
            {found.slice(0, SHOWN_LINKS).map(l => (
              <Box key={`link-${l.key}`} flexDirection="row" paddingLeft={2}>
                <Link href={l.href} label={nameOf(l)} />
              </Box>
            ))}
            {found.length > SHOWN_LINKS ? <Text dimColor>{`  +${found.length - SHOWN_LINKS} more`}</Text> : null}
          </Box>
        ) : null}
      </Box>
    );
  });
};

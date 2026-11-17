import {describe, expect, it} from 'vitest';
import type {Run} from '../input/exec.js';
import {focusHiddenTerminal, splitWorkbench, tabWorkbench} from './ghostty.js';

describe('見えていない端末へ移る', () => {
  it('tty を引数で渡し、選ばれたタブにある端末は除いて探す。移ったときだけ focused を返す', async () => {
    let args: string[] = [];
    let out = 'focused\n';
    const fake: Run = async (_cmd, a) => {
      args = a;
      return {code: 0, stdout: out, stderr: ''};
    };
    expect(await focusHiddenTerminal(fake, '/dev/ttys012')).toBe('focused');
    expect(args[2]).toBe('/dev/ttys012');
    expect(args[1]).toMatch(/terminals of selected tab of front window[\s\S]*return "none"[\s\S]*focus t/);
    out = 'none\n';
    expect(await focusHiddenTerminal(fake, '/dev/ttys012')).toBe('none');
    expect(await focusHiddenTerminal(async () => ({code: 1, stdout: '', stderr: 'x'}), '/dev/ttys012')).toBe('failed');
  });
});

describe('Ghostty の分割とタブに打ち込む文字列', () => {
  it.each([
    ['split', splitWorkbench],
    ['tab', tabWorkbench],
  ] as const)('%s: 先頭の空白と exec を1つ付け、改行で終える', async (done, open) => {
    let input = '';
    let script = '';
    const fake: Run = async (_cmd, args) => {
      input = args[2] ?? '';
      script = args[1] ?? '';
      return {code: 0, stdout: `${done}\n`, stderr: ''};
    };
    expect(await open(fake, "'/bin/echo' hi", {A: 'b'})).toBe(done);
    expect(input).toBe(" exec '/bin/echo' hi\n");
    // 分割とタブのスクリプトを取り違えていない
    expect(script).toMatch(done === 'tab' ? /new tab in front window/ : /split ft direction right/);
    expect(script).not.toMatch(done === 'tab' ? /direction right/ : /new tab/);
  });
});

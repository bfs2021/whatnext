import {describe, expect, it} from 'vitest';
import type {Run} from '../input/exec.js';
import {splitWorkbench, tabWorkbench} from './ghostty.js';

describe('Ghostty の分割とタブに打ち込む文字列', () => {
  it.each([
    ['split', splitWorkbench],
    ['tab', tabWorkbench],
  ] as const)('%s: 先頭の空白と exec を1つ付け、改行で終える', async (done, open) => {
    let input = '';
    const fake: Run = async (_cmd, args) => {
      input = args[2] ?? '';
      return {code: 0, stdout: `${done}\n`, stderr: ''};
    };
    expect(await open(fake, "'/bin/echo' hi", {A: 'b'})).toBe(done);
    expect(input).toBe(" exec '/bin/echo' hi\n");
  });
});

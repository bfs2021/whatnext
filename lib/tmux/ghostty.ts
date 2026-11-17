// tmux: Ghostty で、作業台の画面の分割かタブを作る、またはそこへ移る(ADR-0015)。

import type {Run} from '../input/exec.js';

const FOCUS = `on run argv
  tell application "Ghostty"
    repeat with t in terminals
      if name of t is "whatnext workbench" then
        focus t
        return "focused"
      end if
    end repeat
  end tell
  return "none"
end run`;

const SPLIT = `on run argv
  tell application "Ghostty"
    if not frontmost then return "notfront"
    set cfg to new surface configuration
    set initial input of cfg to (item 1 of argv)
    set environment variables of cfg to rest of argv
    set ft to focused terminal of selected tab of front window
    set nt to split ft direction right with configuration cfg
    focus nt
  end tell
  return "split"
end run`;

const TAB = `on run argv
  tell application "Ghostty"
    if not frontmost then return "notfront"
    set cfg to new surface configuration
    set initial input of cfg to (item 1 of argv)
    set environment variables of cfg to rest of argv
    set nt to new tab in front window with configuration cfg
    focus (focused terminal of nt)
  end tell
  return "tab"
end run`;

export type GhosttyResult = 'focused' | 'split' | 'tab' | 'none' | 'notfront' | 'failed';

/** 名前が `whatnext workbench` の端末へフォーカスを移す(別のタブにあれば、そのタブに切り替わる)。 */
export async function focusWorkbench(run: Run): Promise<GhosttyResult> {
  const r = await run('osascript', ['-e', FOCUS], {timeout: 10000});
  if (r.code !== 0) return 'failed';
  return r.stdout.trim() === 'focused' ? 'focused' : 'none';
}

async function open(
  run: Run,
  script: string,
  done: 'split' | 'tab',
  command: string,
  env: Record<string, string>,
): Promise<GhosttyResult> {
  const args = ['-e', script, ` exec ${command}\n`, ...Object.entries(env).map(([k, v]) => `${k}=${v}`)];
  const r = await run('osascript', args, {timeout: 10000});
  if (r.code !== 0) return 'failed';
  const out = r.stdout.trim();
  return out === done ? done : out === 'notfront' ? 'notfront' : 'failed';
}

/** 押した分割を右に分割し、`whatnext workbench` を打ち込む。 */
export function splitWorkbench(run: Run, command: string, env: Record<string, string>): Promise<GhosttyResult> {
  return open(run, SPLIT, 'split', command, env);
}

/** 押したウィンドウに新しいタブを開き、`whatnext workbench` を打ち込む。 */
export function tabWorkbench(run: Run, command: string, env: Record<string, string>): Promise<GhosttyResult> {
  return open(run, TAB, 'tab', command, env);
}

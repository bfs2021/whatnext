// tmux: Ghostty で押した `ctrl+q ctrl+w` と一覧の `w` で、作業台の画面のタブを作る、またはそこへ移る(ADR-0015)。

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

export type GhosttyResult = 'focused' | 'tab' | 'none' | 'notfront' | 'failed';

/** 名前が `whatnext workbench` の端末へフォーカスを移す(別のタブにあれば、そのタブに切り替わる)。 */
export async function focusWorkbench(run: Run): Promise<GhosttyResult> {
  const r = await run('osascript', ['-e', FOCUS], {timeout: 10000});
  if (r.code !== 0) return 'failed';
  return r.stdout.trim() === 'focused' ? 'focused' : 'none';
}

/** 押したウィンドウに新しいタブを開き、`whatnext workbench` を打ち込む。 */
export async function tabWorkbench(run: Run, command: string, env: Record<string, string>): Promise<GhosttyResult> {
  const args = ['-e', TAB, ` exec ${command}\n`, ...Object.entries(env).map(([k, v]) => `${k}=${v}`)];
  const r = await run('osascript', args, {timeout: 10000});
  if (r.code !== 0) return 'failed';
  const out = r.stdout.trim();
  return out === 'tab' ? 'tab' : out === 'notfront' ? 'notfront' : 'failed';
}

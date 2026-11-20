// 起動の引数(PRODUCT.md「全体」)。

export const USAGE = `Usage: whatnext [--recap | --help]
       whatnext workbench

A terminal list of your parallel Claude Code sessions, grouped by repository.

  whatnext            Open the list (or come back to the one that is running)
  whatnext --recap    Open the list with recaps (goal, now, next, links) of the sessions started with n.
                      Each turn end of those sessions makes one Haiku call.
  whatnext workbench  Show the workbench shell of the session you are looking at (run it in a split)
  --help              Show this help
`;

/** 引数を振り分ける。`--help` は先頭の引数にあるときだけ。`--recap` は一覧を開くときだけ(ほかの引数と組まない)。 */
export function parseArgs(
  args: readonly string[],
): {cmd: 'help'} | {cmd: 'workbench'} | {cmd: 'list'; recap: boolean} | {cmd: 'bad'; arg: string} {
  if (args[0] === '--help') return {cmd: 'help'};
  if (args.length === 0) return {cmd: 'list', recap: false};
  if (args[0] === '--recap' && args.length === 1) return {cmd: 'list', recap: true};
  if (args[0] === 'workbench' && args.length === 1) return {cmd: 'workbench'};
  const bad = args[0] === 'workbench' || args[0] === '--recap' ? args[1] : args[0];
  return {cmd: 'bad', arg: bad};
}

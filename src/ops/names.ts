// 一覧と起動の口(cli)が共有する、専用サーバのオプションの名前と案内の中身。依存は cli → 操作の向きだけにする。

/** whatnext の画面のクライアントの tty(`whatnext` が置く)。 */
export const MAIN_TTY = '@wn_main_tty';
/** 作業台の画面のクライアントの tty(`whatnext workbench` が置く)。 */
export const WB_TTY = '@wn_wb_tty';
/** 動いている一覧と違う版で起動したときの、起動した版。 */
export const NEWER = '@wn_newer';
/** 一覧が `--digest` で動いているか(`1`。一覧が置く)。 */
export const DIGEST_ON = '@wn_digest';
/**
 * ダイジェストを受けている受け口のポート(一覧が `--digest` で受け口を開けたときだけ置く)。mod はターンの終わりに
 * これを読み、自分の送り先のポートと同じときだけ Haiku を呼ぶ(DESIGN.md「ダイジェストの mod」)。
 */
export const DIGEST_LIVE = '@wn_digest_port';
/** `--digest` で起動したが、動いている一覧は `--digest` なしだった(`whatnext --digest` が置き、一覧が知らせる)。 */
export const DIGEST_WANTED = '@wn_digest_wanted';
/** 作業台の画面の案内に出すもの(JSON の GuideState)。 */
export const GUIDE_OPTION = '@wn_guide';

export type GuideState =
  | {kind: 'none'; name: string; path: string; closed?: boolean}
  | {kind: 'tty'; name: string}
  | {kind: 'empty'};

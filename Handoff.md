# Handoff.md

## Current Goal

KOO Phase4までの状態を前提に、次はGitHub Actions手動実行で短時間observe loopを実環境確認する。

## Current Status

- TypeScript + Node.js 22 CLI基盤は実装済み。
- Firebase Admin SDKでFirestoreへ書き込み可能。
- `localgvg/latest` 実APIは `https://api.mentemori.icu/{worldId}/localgvg/latest` を使用。
- Phase4で `phase4-observe-loop` modeを追加済み。
- 保存先は引き続き `koObserverViews/phase1_scope_test` 固定。
- 直近コミット: `a15f35a feat(koo): step4 add observe loop workflow`

## Architecture

- `src/app/main.ts`: mode分岐。
- `src/app/config.ts`: env読み込み。`phase0-smoke-test`, `phase1-scope-test`, `phase4-observe-loop` 対応。
- `src/app/phase1ScopeTest.ts`: 単発取得、activeGuilds生成、Phase3差分、保存判定、必要時Firestore保存。
- `src/app/observeLoop.ts`: duration内で `runPhase1ScopeTest` を繰り返す。
- `src/mentemori/apiClient.ts`: `localgvg/latest` 取得。
- `src/koo/*`: 開催判定、activeGuilds抽出、城単位差分、保存判定。
- `src/firestore/koObserverViewRepository.ts`: `phase1_scope_test` 読み書き。

## Decisions

- `KOO_WORLD_ID` は `1001` 形式のAPI world_idを指定する。
- world変換機能は未実装。
- `LastWinPartyKnockOutCount` は城単位のraw観測値として保存し、ギルド単位へ合算しない。
- count増加のみではFirestore保存しない。
- 保存条件は count reset / state changed / defender changed / attacker changed / checkpoint elapsed。
- checkpointは固定30秒。
- observe loop duration初期値は120秒、最大3600秒。
- observe interval初期値は1秒。
- iteration内API失敗はログ出力後に次loop継続。
- cron、WebSocket、KO確定、履歴collection、保存先ID変更は未実装。

## Important Files

- `Handoff.md`
- `README.md`
- `.env.example`
- `.github/workflows/phase4-observe-loop.yml`
- `src/app/config.ts`
- `src/app/main.ts`
- `src/app/observeLoop.ts`
- `src/app/phase1ScopeTest.ts`
- `src/koo/castleObservationDiff.ts`
- `src/koo/persistDecision.ts`
- `src/koo/activeGuildExtractor.ts`

## Remaining Tasks

1. Phase4 workflowをGitHub Actionsで手動実行する。
2. Actionsログで複数iteration、skip/saveログ、duration到達終了を確認する。
3. Firestore `koObserverViews/phase1_scope_test` の `phase3`, `activeGuilds`, `updatedAt` を確認する。
4. 必要ならdurationを300秒で再確認する。
5. 次Phaseで本番寄りIDや長時間運用方針を検討する。

## Known Issues

- GitHub Actions上のPhase4実行は未確認。
- Firestore実環境でのPhase4連続更新挙動は未確認。
- リポジトリ内にFirebaseサービスアカウントJSONらしきファイルが存在するため扱い注意。

## Validation Status

- `npm.cmd run test`: 成功
- `npm.cmd run typecheck`: 成功
- `npm.cmd run build`: 成功
- `git diff --check`: 問題なし
- `git status --short`: クリーン（Phase4コミット直後）

## Next Session Start

1. `git status --short` を確認する。
2. 必要なら最新コミット `a15f35a` の差分を確認する。
3. GitHubへpushされていなければpush方針を確認する。
4. Phase4 workflowを手動実行し、ActionsログとFirestore保存結果を確認する。

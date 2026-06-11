# Handoff.md

## Current Goal

KOOを本番定刻運用に寄せる。Phase5 KO監視は手動env指定を残しつつ、本番workflowではFirestore `guildShares` から監視対象を解決する。

## Current Status

- `phase5-ko-observe-loop` は `KOO_WORLD_ID` があれば手動検証入力を優先する。
- `KOO_WORLD_ID` がない場合、`guildShares/{guildId}` を1件だけ読み、`guildId`, `guildName`, `world` から監視対象を解決する。
- `world` は1〜999のワールド番号として扱い、KOOの `worldId` は `1000 + world`。
- `guildShares` が0件なら `No guild configuration found.`、複数件なら `Multiple guild configurations found.` をログ出力して停止する。
- 解決後のGuild Battle / Grand Battle scope判定、購読、KO推定、Firestore保存は既存Phase5.5処理を再利用する。
- Grand Battle時は参加4ギルドを `guildKoTotals` に0件KOで初期投入する。
- 本番workflow `.github/workflows/koo-daily-observe.yml` を追加済み。毎日20:40 JST相当の `40 11 * * *` と `workflow_dispatch` で起動する。
- 既存 `.github/workflows/phase5-ko-observe-loop.yml` は手動検証用として維持する。

## Architecture

- 本番監視対象解決: `src/firestore/guildShareRepository.ts`
- Phase5 loop: `src/app/phase5KoObserveLoop.ts`
- scope解決: `src/koo/battleScopeResolver.ts`
- Grand Battle REST: `src/mentemori/grandBattleApiClient.ts`
- streamId/payload: `src/mentemori/streamId.ts`
- 本番workflow: `.github/workflows/koo-daily-observe.yml`
- 手動workflow: `.github/workflows/phase5-ko-observe-loop.yml`

## Decisions

- 初期実装は `guildShares` 1件のみ対応。複数監視は後続拡張。
- 本番workflowでは `KOO_WORLD_ID` / `KOO_GUILD_ID` を渡さない。
- 手動workflowでは引き続き `world_id` / `guild_id` を入力できる。
- `guildShares` 未解決時はFirestore初期化やWebSocket購読を行わず停止する。

## Important Files

- `src/app/config.ts`
- `src/app/phase5KoObserveLoop.ts`
- `src/firestore/guildShareRepository.ts`
- `src/koo/battleScopeResolver.ts`
- `src/firestore/koObserverKoRepository.ts`
- `.github/workflows/koo-daily-observe.yml`
- `.github/workflows/phase5-ko-observe-loop.yml`
- `README.md`

## Remaining Tasks

1. Firestore本番projectに `guildShares/{guildId}` が1件だけ存在することを確認する。
2. `KOO Daily Observe` を `workflow_dispatch` で短時間ではなく3000秒設定のまま手動実行し、20:40〜21:30相当のログを確認する。
3. summaryログで監視対象、battleType、subscriptionType、message/parse/write countersを確認する。
4. Firestoreで `koObserverRuns/meta`, `koObserverRuns/castleKoDetails`, `koObserverViews/guildKoTotals` を確認する。

## Known Issues

- 本番workflowの実Actions実行は未確認。
- `guildShares` 複数監視は未対応。
- Grand Battle実WebSocketでcastle statusが流れること、他world所属guildIdのrealtime guild name補正は実ログ確認が必要。
- `unknownVictimKo` 救済、`suspiciousSwitch` 補正、heartbeat、日跨ぎ履歴、GBM表示は未実装。

## Validation Status

- `npm.cmd run test`: 成功
- `npm.cmd run typecheck`: 成功
- `npm.cmd run build`: 成功
- `git diff --check`: 成功
- `git status --short`: KOO Daily Observe変更ファイルのみ

## Next Session Start

1. `git status --short`
2. `npm.cmd run test`
3. `npm.cmd run typecheck`
4. `npm.cmd run build`
5. `git diff --check`
6. Actions `KOO Daily Observe` を手動実行

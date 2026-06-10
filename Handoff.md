# Handoff.md

## Current Goal

KOO Phase5のWebSocket入力KO推定observerを実装済み。次は手動実行で実WebSocketログとFirestore保存結果を確認する。
Phase6のGBM連携確認用に、dummy guild KO totals投入modeと手動workflowを追加済み。

## Current Status

- TypeScript + Node.js 22 CLI基盤は実装済み。
- 既存 `phase4-observe-loop` は維持済み。Phase5では置換していない。
- Phase5用に `phase5-ko-observe-loop` modeを追加済み。
- Phase5は `wss://api.mentemori.icu/gvg` WebSocketを入力にする。
- GBMの既存WebSocket parser / streamId設計をKOO向けに移植済み。
- Node 22標準の `WebSocket` を使うため、追加npm依存はなし。
- Phase5 smoke test用GitHub Actions workflowを追加済み。`workflow_dispatch` のみで、scheduleは未追加。
- Phase6 dummy seed用GitHub Actions workflowを追加済み。`workflow_dispatch` のみで、scheduleは未追加。

## Completed

- `phase5-ko-observe-loop` mode追加。
- `/gvg` WebSocket接続、guild battle購読payload送信、binary payload parseを追加。
- castle status messageから以下を取得:
  - castleId
  - defenderGuildId
  - attackerGuildId
  - defensePartyCount
  - attackPartyCount
  - lastWinPartyKnockOutCount
- KO推定状態機械を追加。
  - `attributionMode`
  - `unknownVictimKo`
  - `pendingUnknownInitialKo`
  - `suspiciousSwitch`
  - 30秒checkpoint slot
- mode確定条件は「推定被KO累計が6を超えた時点」。
- `unknownVictimKo` と `suspiciousSwitch` は内部メモリのみ。Firestoreには保存しない。
- 起動時処理を追加。
  - `koObserverRuns/castleKoDetails` をクリア
  - `koObserverViews/guildKoTotals` をクリア
  - `koObserverRuns/meta` に `lastStartedAt` を保存
- Firestore保存処理を追加。
  - KOO内部管理: `koObserverRuns/castleKoDetails/{castleId}`
  - GBM参照用: `koObserverViews/guildKoTotals/{guildId}`
  - 起動情報: `koObserverRuns/meta`
- `koObserverViews/guildKoTotals/{guildId}` はドキュメントIDをguildIdとして使い、本文に `guildId` フィールドを保存しない。
- READMEと `.env.example` をPhase5手動実行前提で更新。
- Phase5 smoke test用workflow `.github/workflows/phase5-ko-observe-loop.yml` を追加。
  - `KOO_MODE=phase5-ko-observe-loop`
  - `world_id` inputを `KOO_WORLD_ID` に渡す
  - `duration_seconds` inputを `KOO_OBSERVE_DURATION_SECONDS` に渡す
  - default `world_id=1001`
  - default `duration_seconds=60`
  - scheduleなし
- Phase6 dummy seed mode `phase6-seed-dummy-guild-ko-totals` を追加。
  - `KOO_WORLD_ID` の `localgvg/latest` を実行時に取得
  - 実在するguildId / guildNameから最大5件を選ぶ
  - KO数のみダミー値
  - `koObserverViews/guildKoTotals/{guildId}` に保存
  - 保存フィールドは `guildName`, `totalVictimKoCount`, `updatedAt`
  - `koObserverRuns/meta.lastStartedAt` も更新
  - `KOO_SEED_CLEAR=true` の場合は `koObserverViews/guildKoTotals` をクリア
  - `koObserverRuns/castleKoDetails` は触らない
- Phase6 dummy seed用workflow `.github/workflows/phase6-seed-dummy-guild-ko-totals.yml` を追加。
  - default `world_id=1037`
  - default `clear=true`
  - scheduleなし

## Known Issues

- Phase5は実WebSocket接続でのGitHub Actions手動実行が未確認。
- Firestore実環境での起動時クリア、`lastStartedAt` 保存、castle detail / guild total保存は未確認。
- Phase6 dummy seedのGitHub Actions手動実行とFirestore保存結果は未確認。
- 攻守切り替わり時に防衛数/侵攻数が入れ替わるかは未確認。
- KO数が0へ戻るか、2〜5など中途半端に下がるかは未確認。
- 21:15〜21:30頃のpartyCount追加とKO同時発生頻度は未確認。
- `unknownVictimKo` と `suspiciousSwitch` の発生頻度は実ログ確認が必要。
- `suspiciousSwitch` 補正、unknown救済、heartbeat、日跨ぎ履歴、GBM表示は未実装。

## Next Recommended Actions

1. `git status --short` を確認する。
2. 以下の品質確認を再実行する。
   - `npm.cmd run test`
   - `npm.cmd run typecheck`
   - `npm.cmd run build`
3. Phase5をGitHub Actionsから短時間で手動実行する。
   - workflow: `.github/workflows/phase5-ko-observe-loop.yml`
   - `world_id`: `1001`
   - `duration_seconds`: `60`
4. ローカルで手動実行する場合は以下を使う。
   ```powershell
   $env:KOO_MODE = "phase5-ko-observe-loop"
   $env:KOO_WORLD_ID = "1001"
   $env:KOO_OBSERVE_DURATION_SECONDS = "120"
   npm.cmd run start
   ```
5. Firestoreで以下を確認する。
   - `koObserverRuns/meta.lastStartedAt`
   - `koObserverRuns/castleKoDetails`
   - `koObserverViews/guildKoTotals`
6. 実ログで以下を確認する。
   - WebSocket接続とpayload受信
   - castle saveログ
   - guild totals saveログ
   - unknown / suspicious の発生傾向
7. Phase6ではGBM側表示、heartbeat、実ログに基づく補正要否を検討する。
8. Phase6 dummy seed workflowを手動実行し、GBM側から `koObserverViews/guildKoTotals` を購読・表示できるか確認する。

## Files of Interest

- `src/app/config.ts`
- `src/app/main.ts`
- `src/app/phase5KoObserveLoop.ts`
- `src/mentemori/realtimeClient.ts`
- `src/mentemori/realtimeParser.ts`
- `src/mentemori/streamId.ts`
- `src/koo/koAttribution.ts`
- `src/firestore/koObserverKoRepository.ts`
- `src/koo/koAttribution.test.ts`
- `src/mentemori/realtimeParser.test.ts`
- `src/firestore/koObserverKoRepository.test.ts`
- `.github/workflows/phase5-ko-observe-loop.yml`
- `src/app/phase6SeedDummyGuildKoTotals.ts`
- `src/app/phase6SeedDummyGuildKoTotals.test.ts`
- `.github/workflows/phase6-seed-dummy-guild-ko-totals.yml`
- `README.md`
- `.env.example`

## Validation Status

- `npm.cmd run test`: 成功
- `npm.cmd run typecheck`: 成功
- `npm.cmd run build`: 成功
- `git diff --check`: 成功
- `git status --short`: Phase6 dummy seed変更ファイルのみ

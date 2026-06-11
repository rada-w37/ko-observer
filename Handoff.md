# Handoff.md

## Current Goal

KOO Phase5.5で、Phase5 KO監視をGuild Battle / Grand Battle両対応にする。実装は完了。次は実WebSocketとFirestore保存結果を手動確認する。

## Current Status

- `phase5-ko-observe-loop` は起動時にbattle scopeを解決する。
- Guild Battle開催中は既存の `worldId` ベース `/gvg` 購読を使う。
- Guild Battle非開催時は `KOO_GUILD_ID` を使い、Grand Battleのclass/blockを探索する。
- Grand Battle探索は `wgroups` で `worldGroupId` を解決し、class `1,2,3` × block `0,1,2,3` の `globalgvg/latest` から所属guildIdを探す。
- Grand Battle購読は `worldGroupId / classId / blockId` ベースで、`worldId=0` のstreamIdを送る。
- どちらも解決できない場合、Guild Battle streamへフォールバックせず明示ログで終了する。
- Phase4、Phase6 dummy seed、KO推定、Firestore保存形式は既存維持。

## Architecture

- scope解決: `src/koo/battleScopeResolver.ts`
- Grand Battle REST: `src/mentemori/grandBattleApiClient.ts`
- streamId/payload: `src/mentemori/streamId.ts`
- WebSocket接続: `src/mentemori/realtimeClient.ts`
- Phase5 loop: `src/app/phase5KoObserveLoop.ts`
- GitHub Actions: `.github/workflows/phase5-ko-observe-loop.yml`

## Decisions

- `KOO_GUILD_ID` はGrand Battle探索時のみ必須。Guild Battle開催中は未指定でも既存挙動を維持する。
- Grand Battle候補は `data.guilds` のキー、または `data.castles[].GuildId / AttackerGuildId` に所属guildIdが含まれるかで判定する。
- 未解決時はFirestore初期化やWebSocket購読を行わず終了する。
- summaryログにbattle scope、購読状態、message/parse/write countersをまとめる。

## Important Files

- `src/app/config.ts`
- `src/app/phase5KoObserveLoop.ts`
- `src/koo/battleScopeResolver.ts`
- `src/mentemori/grandBattleApiClient.ts`
- `src/mentemori/streamId.ts`
- `src/mentemori/realtimeClient.ts`
- `src/koo/koAttribution.ts`
- `src/firestore/koObserverKoRepository.ts`
- `.github/workflows/phase5-ko-observe-loop.yml`
- `README.md`
- `.env.example`

## Remaining Tasks

1. Grand Battle開催日にActionsから `world_id` + `guild_id` で短時間実行する。
2. summaryログで `battleType=grandBattle`, `subscriptionType=grandBattle`, `worldGroupId`, `classId`, `blockId` を確認する。
3. WebSocket payload受信、castle status数、guild message数、parse error数を確認する。
4. Firestoreで `koObserverRuns/meta.lastStartedAt`, `koObserverRuns/castleKoDetails`, `koObserverViews/guildKoTotals` を確認する。

## Known Issues

- Grand Battle実WebSocketでcastle statusが流れることは未確認。
- Grand Battle実環境でのFirestore保存結果は未確認。
- 他world所属guildIdのrealtime guild name補正は実ログで確認が必要。
- `unknownVictimKo` 救済、`suspiciousSwitch` 補正、heartbeat、日跨ぎ履歴、GBM表示は未実装。

## Validation Status

- `npm.cmd run test`: 成功
- `npm.cmd run typecheck`: 成功
- `npm.cmd run build`: 成功
- `git diff --check`: 成功
- `git status --short`: Phase5.5変更ファイルのみ

## Next Session Start

1. `git status --short`
2. `npm.cmd run test`
3. `npm.cmd run typecheck`
4. `npm.cmd run build`
5. Actions `Phase5 KO Observe Loop` を `world_id` + `guild_id` で手動実行

# KOO

KOO（KO-Observer）は、めんてもりもりWebSocketからKO推定値を集計し、Firestore共有ビューへ保存するための TypeScript + Node.js CLI アプリです。

## Phase0

Phase0の目的は、KOOの実行基盤とFirebase Admin SDK接続を確認し、Firestoreへ共有ビューの仮データを書き込める状態にすることです。

Phase0では以下を実装しています。

- TypeScript + Node.js CLIの起動基盤
- Firebase Admin SDKによるFirestore接続
- `koObserverViews/phase0_smoke_test` への仮データ書き込み
- GitHub Actionsからの手動実行

## Phase1 / Phase2 / Phase3 / Phase4 / Phase5

Phase1の目的は、ギルドバトルの開催判定、監視scope決定、`activeGuilds` 抽出の土台を作ることです。

Phase2では、`localgvg/latest` の各城データから、ギルドごとの防衛拠点・侵攻拠点の raw 観測材料を `activeGuilds` に保存します。

Phase3では、前回保存済みの `koObserverViews/phase1_scope_test` と最新 `localgvg/latest` を比較し、城単位の raw 観測差分とFirestore保存判定を行います。

Phase4では、1回のNode process内で短時間の監視ループを実行します。GitHub Actionsを1秒ごとに起動する方式ではありません。

保存先IDは引き続き暫定的に `phase1_scope_test` のままです。本番寄りの `world_1001_current` などのID設計は後続Phaseで扱います。

Phase5では、`/gvg` WebSocketを入力として、城ごとの `Current party K.O. count` と防衛/侵攻パーティ数から被KO側を推定します。Phase5は既存Phase4を置換せず、独立した `phase5-ko-observe-loop` modeとして実装しています。

Phase5.5では、起動時にbattle scopeを解決します。手動検証ではGuild Battle開催中は `KOO_WORLD_ID` だけで既存のworldIdベース購読を使います。Guild Battleが開催中でない場合はGrand Battle候補として `wgroups` からworldGroupIdを解決し、class `1,2,3` × block `0,1,2,3` の `globalgvg/latest` を探索します。Grand Battle時は `KOO_WORLD_ID` と `KOO_GUILD_ID` が必要です。所属guildIdが `data.guilds`、または `data.castles[].GuildId / AttackerGuildId` に含まれるclass/blockを採用します。

本番用の `KOO Daily Observe` workflowでは `KOO_WORLD_ID` / `KOO_GUILD_ID` を指定せず、Firestore `guildShares/{guildId}` から監視対象を1件だけ解決します。`guildId` はdocument ID、`guildName` はfield、`world` は1〜999のワールド番号として扱い、KOOの `worldId` は `1000 + world` で計算します。複数docがある場合は自動で複数監視せず、明示ログを出して停止します。

`KOO_WORLD_ID` は mentemori API の4桁 `world_id` を指定します。`1` や `w1` ではありません。

- Japan W1 = `1001`
- Japan W10 = `1010`
- Korea W4 = `2004`

### Modes

`phase1-scope-test` は単発実行です。

```bash
KOO_MODE=phase1-scope-test KOO_WORLD_ID=1001 npm run start
```

`phase4-observe-loop` は短時間監視ループです。

```bash
KOO_MODE=phase4-observe-loop KOO_WORLD_ID=1001 KOO_OBSERVE_DURATION_SECONDS=120 KOO_OBSERVE_INTERVAL_SECONDS=1 npm run start
```

`phase5-ko-observe-loop` はWebSocket入力のKO推定監視ループです。

```bash
KOO_MODE=phase5-ko-observe-loop KOO_WORLD_ID=1001 KOO_OBSERVE_DURATION_SECONDS=120 npm run start
```

Grand Battle開催日にPhase5を実行する場合は、所属ギルドIDも指定します。

```bash
KOO_MODE=phase5-ko-observe-loop KOO_WORLD_ID=1050 KOO_GUILD_ID=111111111050 KOO_OBSERVE_DURATION_SECONDS=120 npm run start
```

`phase6-seed-dummy-guild-ko-totals` はGBM連携確認用のダミーデータ投入modeです。

```bash
KOO_MODE=phase6-seed-dummy-guild-ko-totals KOO_WORLD_ID=1037 KOO_SEED_CLEAR=true npm run start
```

`KOO_OBSERVE_DURATION_SECONDS` のデフォルトは `120`、最大値は `3600` です。`KOO_OBSERVE_INTERVAL_SECONDS` のデフォルトは `1` です。

### GitHub Actions

本番用workflowは `.github/workflows/koo-daily-observe.yml` の `KOO Daily Observe` です。現時点では `workflow_dispatch` のみで手動実行でき、schedule / cron は設定していません。cron復元は今回の通知接続Planの対象外です。実行時間は `KOO_OBSERVE_DURATION_SECONDS=3000` で、20:40〜21:30の監視を想定しています。

`KOO Daily Observe` はFirestore `guildShares` から監視対象を解決し、Guild Battle / Grand Battle両方のscope解決を行います。既存の `.github/workflows/phase5-ko-observe-loop.yml` はデバッグ、別ワールド確認、Grand Battle確認、本番障害切り分け用の手動workflowとして残しています。

### Production notification requests

KOOの通知連携は、KOOがDiscordへ直接送信するのではなく、Firestoreの `notificationRequests/{requestId}` を作成することで行います。`notificationRequests/{requestId}` 作成後のDiscord送信、status更新、失敗処理は、同一Firebase projectの `asia-northeast1` にdeploy済みのGBM側 `dispatchNotificationRequest` が担当します。

本番通知を有効にするには、`KOO Daily Observe` workflowで以下を設定します。

- `KOO_NOTIFICATIONS_ENABLED=true`
- `KOO_NOTIFICATIONS_DRY_RUN=false`

デフォルト運用では通知は無効、またはdry-runを有効にします。本番通知には以下が必要です。

- `guildShares/{guildId}/notificationRules` に有効な通知ルールが存在する
- `guildShares/{guildId}/notificationDestinations/discord` にDiscord送信先が存在する
- `dispatchNotificationRequest` が同一Firebase projectの `asia-northeast1` にdeploy済みである

### Observations

`GvgCastleState` は以下のように扱います。

- `0`: 非開催相当
- `1`: declared / in battle
- `2`: fallen
- `3`: counterattack
- `4`: counterattack successful

`activeGuilds` は `GuildId` と `AttackerGuildId` から抽出し、ギルド名は `guilds` map から解決します。ギルド名が解決できない場合は、暫定対応として `Guild {guildId}` を使います。

各ギルドには `castles.defending` と `castles.attacking` を保存します。各城には `castleId`, `gvgCastleState`, `rawLastWinPartyKnockOutCount`, `lastWinPartyDefeatedCount` を保存し、Phase3以降では必要に応じて `observationDiff` も保存します。

`LastWinPartyKnockOutCount` はギルド全体のKO数ではありません。現在その拠点で勝ち残っている1パーティが連勝中に倒した相手パーティ数です。KOOでは城単位の観測値として保存し、ギルド単位に合算しません。

Phase3以降では以下のいずれかの場合だけFirestoreへ保存します。

- count reset
- state changed
- defender changed
- attacker changed
- checkpoint elapsed（固定30秒）

count増加のみでは保存しません。

### Phase5 KO推定

Phase5では、拠点ごとに内部メモリ上で `attributionMode` を管理します。

- `unknown`: 防衛側被KOか侵攻側被KOか未確定
- `defenseVictim`: KO増加分を防衛側の被KOとして扱う
- `attackVictim`: KO増加分を侵攻側の被KOとして扱う

防衛側または侵攻側だけが明確に減った場合、その側の推定被KO累計へ加算します。推定被KO累計が6を超えた時点でmodeを確定します。判定不能KOと `suspiciousSwitch` は内部メモリのみで扱い、Firestoreへは保存しません。

Phase5起動時の購読分岐は以下です。

- Guild Battle開催中: `worldId` ベースのGuild Battle streamを購読
- Guild Battle非開催かつ `KOO_GUILD_ID` がGrand Battle候補内にある: `worldGroupId / classId / blockId` ベースのGrand Battle streamを購読
- どちらも解決できない: 明示ログを出して終了し、Guild Battle streamへフォールバックしない

Phase5のFirestore保存先は以下です。

- KOO内部管理: `koObserverRuns/castleKoDetails/{castleId}`
- GBM参照用: `koObserverViews/guildKoTotals/{guildId}`
- 起動情報: `koObserverRuns/meta`

`koObserverViews/guildKoTotals/{guildId}` はドキュメントIDをguildIdとして扱うため、本文に `guildId` フィールドは保存しません。

### Phase6 Dummy Seed

Phase6のGBM表示・購読・Firestore連携確認用に、`phase6-seed-dummy-guild-ko-totals` modeを用意しています。

- `KOO_WORLD_ID` の `localgvg/latest` を実行時に取得する
- 取得できた実在guildId / guildNameから最大5件を選ぶ
- KO数のみダミー値を使う
- `KOO_SEED_CLEAR=true` の場合、`koObserverViews/guildKoTotals` をクリアしてから保存する
- `koObserverRuns/castleKoDetails` は触らない

保存例:

```ts
{
  guildName: "Guild Name",
  totalVictimKoCount: 12,
  updatedAt: Timestamp
}
```

起動情報として `koObserverRuns/meta.lastStartedAt` も更新します。

## 未実装

以下は現時点では未実装です。

- KO確定推定の高精度化
- defeatedCount合算
- ギルド単位KOランキング
- KOO単体でのDiscord直接送信
- KOO Daily Observe cron復元
- 50分固定化
- 常時稼働
- Cloud Run移行
- 履歴保存
- Firestore schema最適化
- GBM DB参照
- ownGuildベースscope最適化
- grandBattle判定本実装
- UI / viewer追加
- heartbeat
- 日跨ぎ履歴保存

## ローカル実行

Node.js 22を使用します。

```bash
npm ci
npm run test
npm run typecheck
npm run build
```

PowerShellでは以下のように環境変数を設定します。

```powershell
$env:KOO_MODE = "phase4-observe-loop"
$env:KOO_WORLD_ID = "1001"
$env:KOO_OBSERVE_DURATION_SECONDS = "120"
$env:KOO_OBSERVE_INTERVAL_SECONDS = "1"
npm.cmd run start
```

Phase5を手動実行する場合は以下のように設定します。

```powershell
$env:KOO_MODE = "phase5-ko-observe-loop"
$env:KOO_WORLD_ID = "1001"
$env:KOO_OBSERVE_DURATION_SECONDS = "120"
npm.cmd run start
```

本番相当のローカル確認では `KOO_WORLD_ID` / `KOO_GUILD_ID` を設定せず、Firestore `guildShares` から監視対象を解決します。

```powershell
$env:KOO_MODE = "phase5-ko-observe-loop"
$env:KOO_OBSERVE_DURATION_SECONDS = "3000"
npm.cmd run start
```

Grand Battle開催日にPhase5を手動実行する場合は `KOO_GUILD_ID` も設定します。

```powershell
$env:KOO_MODE = "phase5-ko-observe-loop"
$env:KOO_WORLD_ID = "1050"
$env:KOO_GUILD_ID = "111111111050"
$env:KOO_OBSERVE_DURATION_SECONDS = "120"
npm.cmd run start
```

Phase6 dummy seedを手動実行する場合は以下のように設定します。

```powershell
$env:KOO_MODE = "phase6-seed-dummy-guild-ko-totals"
$env:KOO_WORLD_ID = "1037"
$env:KOO_SEED_CLEAR = "true"
npm.cmd run start
```

Firestoreへ書き込む場合は、以下のFirebase Admin SDK用環境変数も必要です。

- `FIREBASE_PROJECT_ID`
- `FIREBASE_CLIENT_EMAIL`
- `FIREBASE_PRIVATE_KEY`

`FIREBASE_PRIVATE_KEY` は `\n` 形式の改行を実際の改行へ復元して使用します。

## GitHub Actions

以下のworkflowは `workflow_dispatch` で手動実行できます。

- `.github/workflows/phase0-smoke-test.yml`
- `.github/workflows/phase1-scope-test.yml`
- `.github/workflows/phase4-observe-loop.yml`
- `.github/workflows/koo-daily-observe.yml`
- `.github/workflows/phase5-ko-observe-loop.yml`
- `.github/workflows/phase6-seed-dummy-guild-ko-totals.yml`

`KOO Daily Observe` は現時点では `workflow_dispatch` のみで、schedule / cron はありません。cron復元は今回の通知接続Planの対象外です。Firestore `guildShares` から監視対象を解決し、通知を有効にする場合は `notificationRequests/{requestId}` を作成します。

Phase5 workflowは `workflow_dispatch` のみで、scheduleはありません。手動実行時に以下のinputを指定できます。

- `world_id`: デフォルト `1001`
- `duration_seconds`: デフォルト `60`

実行後はFirestoreで以下を確認します。

- `koObserverRuns/meta.lastStartedAt`
- `koObserverRuns/castleKoDetails`
- `koObserverViews/guildKoTotals`

Phase6 dummy seed workflowも `workflow_dispatch` のみで、scheduleはありません。手動実行時に以下のinputを指定できます。

- `world_id`: デフォルト `1037`
- `clear`: デフォルト `true`

実行後はFirestoreで以下を確認します。

- `koObserverRuns/meta.lastStartedAt`
- `koObserverViews/guildKoTotals`

GitHub Secretsには以下を設定します。

- `FIREBASE_PROJECT_ID`
- `FIREBASE_CLIENT_EMAIL`
- `FIREBASE_PRIVATE_KEY`

既存のPhase0 workflowでは `KOO_MODE` 未指定のため、デフォルトの `phase0-smoke-test` として動作します。

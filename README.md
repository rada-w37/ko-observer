# KOO

KOO（KO-Observer）は、めんてもりもりWebSocketからKO推定値を集計し、Firestore共有ビューへ保存するための TypeScript + Node.js CLI アプリです。

## Phase0

Phase0の目的は、KOOの実行基盤とFirebase Admin SDK接続を確認し、Firestoreへ共有ビューの仮データを書き込める状態にすることです。

Phase0では以下を実装しています。

- TypeScript + Node.js CLIの起動基盤
- Firebase Admin SDKによるFirestore接続
- `koObserverViews/phase0_smoke_test` への仮データ書き込み
- GitHub Actionsからの手動実行

## Phase1 / Phase2 / Phase3

Phase1の目的は、ギルドバトルの開催判定、監視scope決定、`activeGuilds` 抽出の土台を作ることです。

Phase2では、`localgvg/latest` の各城データから、ギルドごとの防衛拠点・侵攻拠点の raw 観測材料を `activeGuilds` に保存します。

Phase3では、前回保存済みの `koObserverViews/phase1_scope_test` と最新 `localgvg/latest` を比較し、城単位の raw 観測差分とFirestore保存判定を行います。保存先IDは引き続き暫定的に `phase1_scope_test` のままです。本番寄りの `world_1001_current` などのID設計は後続Phaseで扱います。

`KOO_MODE=phase1-scope-test` で起動すると、指定した `KOO_WORLD_ID` の `localgvg/latest` を取得し、必要な場合のみFirestore `koObserverViews/phase1_scope_test` へ固定IDで上書き保存します。

`KOO_WORLD_ID` は mentemori API の4桁 `world_id` を指定します。`1` や `w1` ではありません。

- Japan W1 = `1001`
- Japan W10 = `1010`
- Korea W4 = `2004`

Phase1時点では、`KOO_WORLD=1` から `KOO_WORLD_ID=1001` への変換機能は未実装です。

`GvgCastleState` は以下のように扱います。

- `0`: 非開催相当
- `1`: declared / in battle
- `2`: fallen
- `3`: counterattack
- `4`: counterattack successful

`activeGuilds` は `GuildId` と `AttackerGuildId` から抽出し、ギルド名は `guilds` map から解決します。ギルド名が解決できない場合は、暫定対応として `Guild {guildId}` を使います。

各ギルドには `castles.defending` と `castles.attacking` を保存します。各城には `castleId`, `gvgCastleState`, `rawLastWinPartyKnockOutCount`, `lastWinPartyDefeatedCount` を保存し、Phase3では必要に応じて `observationDiff` も保存します。

`LastWinPartyKnockOutCount` はギルド全体のKO数ではありません。現在その拠点で勝ち残っている1パーティが連勝中に倒した相手パーティ数です。KOOでは城単位の観測値として保存し、ギルド単位に合算しません。

Phase3では以下のいずれかの場合だけFirestoreへ保存します。

- count reset
- state changed
- defender changed
- attacker changed
- checkpoint elapsed（固定30秒）

count増加のみでは保存しません。

## 未実装

以下はPhase3では未実装です。

- WebSocket接続
- KO確定推定
- defeatedCount合算
- ギルド単位KOランキング
- Discord通知
- 1秒ループ
- 定周期 polling / scheduler
- GitHub Actions cron
- 履歴保存
- Firestore schema最適化
- GBM DB参照
- ownGuildベースscope最適化
- grandBattle判定本実装
- UI / viewer追加

## ローカル実行

Node.js 22を使用します。

```bash
npm ci
npm run test
npm run typecheck
npm run build
```

Phase0 smoke test:

```bash
npm run start
```

Phase1 / Phase2 / Phase3 scope test:

```bash
KOO_MODE=phase1-scope-test KOO_WORLD_ID=1001 npm run start
```

PowerShellでは以下のように環境変数を設定します。

```powershell
$env:KOO_MODE = "phase1-scope-test"
$env:KOO_WORLD_ID = "1001"
npm.cmd run start
```

Firestoreへ書き込む場合は、以下のFirebase Admin SDK用環境変数も必要です。

- `FIREBASE_PROJECT_ID`
- `FIREBASE_CLIENT_EMAIL`
- `FIREBASE_PRIVATE_KEY`

`FIREBASE_PRIVATE_KEY` は `\n` 形式の改行を実際の改行へ復元して使用します。

## GitHub Actions

`.github/workflows/phase0-smoke-test.yml` と `.github/workflows/phase1-scope-test.yml` は `workflow_dispatch` で手動実行できます。

GitHub Secretsには以下を設定します。

- `FIREBASE_PROJECT_ID`
- `FIREBASE_CLIENT_EMAIL`
- `FIREBASE_PRIVATE_KEY`

既存のPhase0 workflowでは `KOO_MODE` 未指定のため、デフォルトの `phase0-smoke-test` として動作します。

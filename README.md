# KOO

KOO（KO-Observer）は、めんてもりもりWebSocketからKO推定値を集計し、Firestore共有ビューへ保存するための TypeScript + Node.js CLI アプリです。

## Phase0

Phase0の目的は、KOOの実行基盤とFirebase Admin SDK接続を確認し、Firestoreへ共有ビューの仮データを書き込める状態にすることです。

Phase0では以下を実装しています。

- TypeScript + Node.js CLIの起動基盤
- Firebase Admin SDKによるFirestore接続
- `koObserverViews/phase0_smoke_test` への仮データ書き込み
- GitHub Actionsからの手動実行

## Phase1

Phase1の目的は、ギルドバトルの開催判定、監視scope決定、`activeGuilds` 抽出の土台を作ることです。

`KOO_MODE=phase1-scope-test` で起動すると、指定した `KOO_WORLD_ID` の `localgvg/latest` を取得し、Firestore `koObserverViews/phase1_scope_test` へ固定IDで上書き保存します。

`KOO_WORLD_ID` は mentemori API の4桁 `world_id` を指定します。`1` や `w1` ではありません。

- Japan W1 = `1001`
- Japan W10 = `1010`
- Korea W4 = `2004`

Phase1時点では、`KOO_WORLD=1` から `KOO_WORLD_ID=1001` への変換機能は未実装です。

Phase1では `GvgCastleState` を以下のように扱います。

- `0`: 非開催相当
- `1`: declared / in battle
- `2`: fallen
- `3`: counterattack
- `4`: counterattack successful

`activeGuilds` は `GuildId` と `AttackerGuildId` から抽出し、ギルド名は `guilds` map から解決します。ギルド名が解決できない場合は、Phase1の暫定対応として `Guild {guildId}` を使います。

## 未実装

以下はPhase1では未実装です。

- WebSocket接続
- KO推定ロジック
- 定周期 polling / scheduler
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

Phase1 scope test:

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

`.github/workflows/phase0-smoke-test.yml` は `workflow_dispatch` で手動実行できます。

GitHub Secretsには以下を設定します。

- `FIREBASE_PROJECT_ID`
- `FIREBASE_CLIENT_EMAIL`
- `FIREBASE_PRIVATE_KEY`

既存workflowでは `KOO_MODE` 未指定のため、デフォルトの `phase0-smoke-test` として動作します。

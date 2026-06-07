# KOO

KOO（KO-Observer）は、めんてもりもりWebSocketからKO推定値を集計し、Firestore共有ビューへ保存するためのTypeScript + Node.js CLIアプリです。

## Phase0

Phase0の目的は、KOOの実行基盤とFirebase Admin SDK接続を確認し、Firestoreへ共有ビューの仮データを書き込める状態にすることです。

Phase0では以下のみを実装しています。

- TypeScript + Node.js CLIの起動基盤
- Firebase Admin SDKによるFirestore接続
- `koObserverViews/phase0_smoke_test` への仮データ書き込み
- GitHub Actionsからの手動実行

以下はPhase0では未実装です。

- WebSocket接続
- KO推定ロジック
- GBM側DB参照
- 定期スケジュール実行

## ローカル実行

Node.js 22を使用します。

```bash
npm ci
npm run typecheck
npm run build
```

Firestoreへの仮書き込みを行う場合は、以下の環境変数を設定してから実行します。

```bash
npm run start
```

必要な環境変数は `.env.example` を参照してください。`FIREBASE_PRIVATE_KEY` は `\n` 形式の改行を実際の改行へ復元して使用します。

## GitHub Actions

`.github/workflows/phase0-smoke-test.yml` は `workflow_dispatch` で手動実行できます。

GitHub Secretsには以下を設定します。

- `FIREBASE_PROJECT_ID`
- `FIREBASE_CLIENT_EMAIL`
- `FIREBASE_PRIVATE_KEY`

workflowでは `npm ci`、`npm run typecheck`、`npm run build`、`npm run start` を実行します。

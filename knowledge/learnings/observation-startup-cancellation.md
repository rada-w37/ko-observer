---
id: koo-observation-startup-cancellation
status: verified
scope: KOO ObservationRuntime.initialize / ObservationRunRepository.resume
observed_at: 2026-11-03
evidence:
  - ../../src/app/observationRuntime.ts
  - ../../src/app/observationRuntime.test.ts
  - ../../src/firestore/observationRunRepository.ts
hypothesis: []
unverified:
  - 本番WF停止のタイミングでの検証は未実施
reproduced: yes
fix_tested: yes
promotion_candidate: no
promoted_to: ""
---

## 観測事実

起動前のsignal確認だけでは、acquire待機中の停止後にもresumeが呼ばれた。KOOのresumeはcheckpointと公開viewを再構築し、別バトルでは初期化するため、購読開始前の処理にも保存データへの影響がある。メモリstoreの取得待ちを制御して再現した。

## 解釈・対策

acquireとresumeの各await後、および監視開始前に停止要求を確認する。取得済みleaseはruntimeの終了処理へ引き渡して解放する。確認前に発行済みのRPCを取り消せるという保証ではない。

## 再現性・対策確認

`stopping during ownership acquisition releases the lease without rebuilding views` は手動キャンセルと監視期限終了の両方でresume未実行・lease解放を確認する。`stopping during resume does not open a socket or publish more data` は既に発行済みのresume完了後に購読・追加保存へ進まないことを確認する。修正前は取得中の停止後にもresumeが呼ばれ、修正後はこれらの回帰テストが成功した。

## 未確認事項

本番書き込みや本番WFの停止は行っていない。停止後に既に発行済みのSDK処理が完了する可能性は残る。今回の修正は、その後に新しい初期化・購読を開始しないことを保証する。

---
id: koo-checkpoint-projection-snapshot
status: verified
scope: KOO ObservationRunRepository.commit
observed_at: 2026-11-03
evidence:
  - ../../src/firestore/observationRunRepository.ts
  - ../../integration/observationRunRepository.test.ts
hypothesis: []
unverified:
  - Linuxでの同じ統合テストはCI実行待ち
reproduced: yes
fix_tested: yes
promotion_candidate: no
promoted_to: ""
---

## 観測事実

commit開始時にcheckpointをencodeし、トランザクションの表示用データを呼び出し元の元オブジェクトから生成すると、待機中の外部変更によってcheckpoint=7 KO、公開view=99 KOが同時に保存された。WindowsのFirestore Emulatorで独立検証担当が再現した。

## 解釈

トランザクションが保証する一括確定と、確定する入力状態の一致は別の条件。KOOではcheckpointと公開viewの両方を、同じ確定済みスナップショットから作る必要がある。

## 再現性

`mutating a caller snapshot during commit cannot split its checkpoint and public totals` を参照。commitを開始した直後に元snapshotのside累計とguild別ledgerを変更し、checkpointと2種類の公開データを読み戻す。

## 対策確認

encodeした内容をdecodeして安定snapshotを作り、そのsnapshotを世代比較と公開view生成にも使う。城IDの集合も開始時にコピーする。修正後、元のオブジェクトを99 KOへ変更しても、保存結果はすべて7 KOで一致した。所有権・世代・同revision再構築を含む統合18件が成功した。

## 未確認事項

本番書き込みは実施していない。LinuxのCI実行は未確認。根拠のない一般化や共通知識への昇格は行っていない。

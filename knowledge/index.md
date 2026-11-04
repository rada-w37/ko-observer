# Knowledge Index

| topic | keywords | current | evidence | notes |
| --- | --- | --- | --- | --- |
| KO checkpointと公開viewの整合性 | checkpoint, immutable snapshot, transaction, alias | [学び](learnings/checkpoint-projection-snapshot.md) | [統合テスト](../integration/observationRunRepository.test.ts) | 同一の確定snapshotから両方を作る |
| KO監視初期化中の停止境界 | cancellation, acquire, resume, lease | [学び](learnings/observation-startup-cancellation.md) | [回帰テスト](../src/app/observationRuntime.test.ts) | await後に停止を確認し、取得済みleaseを解放する |
| KO帰属候補の範囲圧縮 | attribution, pending KO, bounds, checkpoint validation | [学び](learnings/ko-attribution-range-compression.md) | [独立参照テスト](../src/koo/koAttributionCandidates.test.ts) | 確実な分だけ加算し、保存時は攻防と合計の上下限を検証する |
| 通常戦の初戦KOの観測根拠 | first battle, KO0, 20:45, state 1 | [学び](learnings/ko-first-battle-evidence.md) | [回帰テスト](../src/app/koObservationProcessor.test.ts) | 状態1のまま20:45をまたぐ連続KO0でも根拠を保持する |

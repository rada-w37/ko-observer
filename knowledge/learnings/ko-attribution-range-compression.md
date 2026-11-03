---
id: koo-attribution-range-compression
status: verified
scope: KOO v2の単戦観測モデル内の帰属候補
observed_at: 2026-11-04
evidence:
  - ../../docs/ko-attribution-spec.md
  - ../../src/koo/koAttributionCandidates.ts
  - ../../src/koo/koAttributionCandidates.test.ts
hypothesis: []
unverified:
  - 実運用の全戦闘受信保証
  - 修正版の本番長時間稼働
reproduced: yes
fix_tested: yes
promotion_candidate: no
promoted_to: ""
---

城の参加ギルドと直近の観測値が同じ区間では、次の戦闘候補は現在の被KO側で決まり、過去の未加算数には依存しない。同じ被KO側で終わる履歴を、防衛・侵攻・合計の未加算範囲にまとめても、次の観測で確実になる量を求められる。

全候補で共通する最小加算数を反映し、その量を全候補から除く。候補が一つになっても、同じ側に合流した履歴の未確定量がすべて確定したとは限らない。合計範囲は攻防の範囲から推測せず、履歴の合計に対する最小・最大として別に保持する。

教会・城/神殿の両条件で独立の履歴列挙と固定seedの4,800観測を比較し、候補の側・加算数・範囲が一致した。候補は城ごとに最大2つ。これは単戦モデル内の検証であり、受信欠落がないことを示すものではない。

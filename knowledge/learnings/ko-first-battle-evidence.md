---
id: koo-first-battle-evidence
status: verified
scope: KO帰属v2の通常戦における初戦の観測条件
observed_at: 2026-11-04
evidence:
  - ../../README.md
  - ../../docs/ko-attribution-spec.md
  - ../../src/app/koObservationProcessor.test.ts
hypothesis: []
unverified:
  - 実運用のWebSocketが全戦闘結果を配信するか
  - 陥落・反撃時の部隊数とギルドIDの対応
reproduced: yes
fix_tested: yes
promotion_candidate: no
promoted_to: ""
---

状態1は布告と通常戦の両方を表す。状態1のまま20:45前のKO0、20:45以降のKO0、KO3、KO6を受信したとき、直近の観測時刻だけで戦闘前かを判定すると最初の3KOを取りこぼした。模擬バイナリ入力で、防衛被KOの期待値6に対し3となることを再現した。以前のテストでは最初のKOで状態2に変えており、このケースを検出できなかった。状態2は陥落を表す。

戦闘前に確認したKO0の根拠を、同じ対戦・接続区間の連続したKO0で保持する。部隊の追加があっても初戦を数えられ、部隊減少・ギルド交代・再接続で根拠が失われた場合は次の正値を基準にする。状態1を維持した入力で防衛に6KO入ることと、根拠を失った入力ではその次の戦闘から加算されることを確認した。

# app-wire（送金コリドー）— itonami（dapp）上の分散型設計

状態: 第 1 スライス実装（2026-10-20）。正本はこの文書。
追跡: Linear JUN-128（親 JUN-116）。

## 位置づけ

app-wire は国際送金コリドー —— レート（corridorRate）・統計（corridorStat）・
転送状態。**転送台帳とセキュアメッセージは E2E 暗号封筒の inner-type**
（送金先・金額・文面はトランスポートで平文にしない）。

## このスライス: コリドー判定コア

| 層 | 実体 | 状態 |
|---|---|---|
| 判定コア guest | `aiueos/wire_corridor.cljk` — transfer-status-ok（**pending / confirmed / settled / failed の閉じた 4**）/ rate-admission（corridor + currencyPair 必須 / **ratePermille は非負整数**）/ stat-admission（corridor + period + currency 必須 / **transferCount・totalMinorUnits は非負整数**）/ upsert-take（既存は updated、新規は recorded） | **実装済み・実測** |
| 記述子 | `aiueos/wire-corridor.edn` | **実装済み** |
| parity | `kotoba/test/wire/corridor_parity_test.cljk` — 正本（registry.ts / types.ts）の閉じた集合・拒否名・E2E inner-type と一致 | **実装済み・実測** |

実測: `amu test aiueos/wire_corridor.cljk` → **15/15**（jvm-kir / js / wasm）。
parity → 13 assertions / 0 failures。

## 正本の正確な規則（guest はこれに追従）

- **TransferStatus** = pending / confirmed / settled / failed（4 つ）。
- corridorRate: corridor + currencyPair 必須、ratePermille は isUint
  （invalidRatePermille）。**upsert**（wasPresent ? updated : recorded）。
- corridorStat: corridor + period + currency 必須、transferCount と
  totalMinorUnits は isUint（invalidAggregate）。
- **E2E inner-type**: transferLedger / secureMessage —— watashi の audit と
  同じ「暗号封筒の中だけ」の原則。

## 実測メモ

- parity の文字列ピンに引用符を含めると kbb reader が壊れる（今回 3 度目）。
  ピンは引用符無しの部分一致に統一する方針を docs で再確認。

## 未実装境界

- 送金実行の判定（TransferStatus の遷移、pending → confirmed → settled）。
- 為替計算（ratePermille の適用）と手数料。
- mon（DNA）化、aiueos session 載せ（fleet 共通）。

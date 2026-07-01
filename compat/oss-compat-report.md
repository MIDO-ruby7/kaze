# kaze OSS 互換性レポート

生成日: 2026-07-01

---

## 1. 進捗サマリー (v1 → v2 → v3)

| Run | ラベル | 合格 | 合計 | 合格率 |
|-----|--------|------|------|--------|
| v1 | 初回（修正前） | 9 | 26 | 34.6% |
| v2 | locator.first()追加後 | 14 | 26 | 53.8% |
| v3 | Epic #43 完了後 | 16 | 26 | 61.5% |

---

## 2. OSS 別結果 (v3)

| OSS | 合格 / 合計 | 状態 | 実行時間 |
|-----|------------|------|----------|
| playwright-todomvc | 2 / 3 | ⚠️ | 16151ms |
| the-internet | 3 / 3 | ✅ | 12967ms |
| playwright-dev | 2 / 3 | ⚠️ | 11173ms |
| demoqa | 0 / 2 | ❌ | 11046ms |
| automationintesting | 2 / 2 | ✅ | 23800ms |
| saucedemo | 1 / 3 | ❌ | 19268ms |
| github-login | 2 / 2 | ✅ | 2637ms |
| wikipedia | 0 / 2 | ❌ | 30008ms |
| jsonplaceholder | 1 / 2 | ⚠️ | 1979ms |
| runteq-studio | 3 / 4 | ⚠️ | — (pre-built) |

Legend: ✅ all passed  ⚠️ partial  ❌ all failed

---

## 3. 残存課題

- **saucedemo**: ログイン後に `/inventory/` へ遷移せず認証フローが未完了（`.inventory_item` も 0 件）
- **wikipedia**: 2テスト共に 30000ms タイムアウト（ネットワーク遅延 or ページ読み込み待機不足）
- **demoqa**: `#submit` がビューポート外でクリック不可 + `.rct-node` が非表示のまま
- **playwright-todomvc**: `.todo-list li` カウントが期待値 1 に対し 2 を返す（状態リセット漏れの可能性）
- **jsonplaceholder**: `fetch via evaluate` で `fetch failed: {}` — `evaluate` コンテキスト内の fetch 未対応

---

## 4. 過去バージョン詳細

v1→v2 での改善 (+5): `locator.first` / `locator.last` / `locator.nth` 実装による automationintesting, github-login, playwright-dev, jsonplaceholder のアンブロック

v2→v3 での改善 (+2): Epic #43 による the-internet 完全合格 + playwright-todomvc 1→2

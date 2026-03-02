# Classic Duels コードレビュー (v6)

> レビュー日: 2026-03-02  
> 対象: リポジトリ全体（25 ファイル、約 4,700 行）  
> 前回比の主要変更: ゲームロジック・UIコンポーネントのファイル分割リファクタリング

---

## v5 残存指摘の対応状況

| v5 ID | タイトル | 状態 |
|---|---|---|
| m-V5-1 | WS origin 無しの許可 | ⚠️ 据え置き（設計判断として妥当） |
| m-V5-2 | `normalizeRoomSettings` の guard 欠落 | ⚠️ 据え置き（サーバー側で到達不可能パス） |

---

## 今回の変更概要

### Worker 側: `worker/games.ts` → `worker/games/` ディレクトリ分割

| ファイル | 内容 | 行数 |
|---|---|---|
| `index.ts` | オーケストレータ（dispatch + ライフサイクル管理） | 211 |
| `common.ts` | 共通ユーティリティ（`formatWinnerMessage`） | 9 |
| `janken.ts` | じゃんけんロジック + ビュー | 112 |
| `old-maid.ts` | ババ抜きロジック + ビュー + bot 自動行動 | 356 |
| `board.ts` | 五目並べ・オセロ・四目並べロジック + ビュー | 390 |

### Frontend 側: `GameSurface.tsx` → `src/components/games/` ディレクトリ分割

| ファイル | 内容 | 行数 |
|---|---|---|
| `GameSurface.tsx` | dispatch ハブ（view.kind で振り分け） | 34 |
| `WaitingSurface.tsx` | 待機画面 | 27 |
| `PlannedSurface.tsx` | 未実装ゲーム画面 | 11 |
| `JankenSurface.tsx` | じゃんけん UI + フォーマッタ | 63 |
| `OldMaidSurface.tsx` | ババ抜き UI + カード表示 | 79 |
| `BoardSurface.tsx` | 盤面ゲーム UI（五目・オセロ・四目） | 101 |

### その他の改善

- **マジックナンバー定数化**: `CONNECT4_WIN_LENGTH = 4`, `GOMOKU_WIN_LENGTH = 5` (board.ts:10-11)
- **`OldMaidResolution` 型エイリアス**: `resolveOldMaidWinner` の戻り値を名前付き型に (old-maid.ts:12)
- **`finalizeByDisconnect` の N 人対応改善**: `remainingSeats[0] ?? null` (index.ts:199)
- **`buildBoardView` の型ガード**: `gomoku`/`othello` 以外で `AppError` throw (board.ts:72-73)

---

## 新規レビュー結果

### 🔴 Critical

なし。

### 🟠 Major

なし。

### 🟡 Minor

#### m-V6-1. `room.ts` の import パスが `worker/games/index.ts` ではなく `./games` を参照

- **ファイル**: `worker/room.ts`
- `import { ... } from "./games"` で自動的に `./games/index.ts` に解決されるため問題なし。✅ TypeScript と Wrangler のモジュール解決は正しく機能する。

#### m-V6-2. `old-maid.ts` の `shuffle` が `board.ts` と重複しない独立定義

- `shuffle<T>` は `old-maid.ts` にのみ存在し、`board.ts` では使用されていない。現時点で重複はないが、将来カード系ゲーム（七並べ等）を追加する際は `common.ts` に移動を検討すべき。

#### m-V6-3. `BoardSurface.tsx` の `snapshot` prop が gomoku/othello 用の `view.kind` 判定には不要

- `BoardSurface` は `snapshot.gameId` をタイトル表示にのみ使用 (L60)。`view` に必要な情報がすべて含まれているため、`gameTitle: string` prop に置き換えれば `snapshot` 依存を解消できる。
- 機能的な問題はなく、コンポーネント設計の好みの範囲。

---

## ✅ 全体評価

リファクタリングは**極めてクリーン**に実行されています。

- **ロジック保持**: 分割前後でゲームロジック・ビュー構築の挙動に差異なし
- **責務の明確化**: 各ファイルが単一ゲーム or 共通機能に特化しており、将来のゲーム追加時に触るファイルが明確
- **import グラフが健全**: 循環依存なし、`common.ts` → 各ゲーム → `index.ts` の一方向
- **前回までの全修正が保持**: v1〜v5 で対処した全ての指摘事項がそのまま維持されている

**実用上のバグや脆弱性は確認されませんでした。** 指摘は将来の拡張に向けた軽微な設計提案（3件）のみです。

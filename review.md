# Classic Duels コードレビュー (v7)

> レビュー日: 2026-03-02  
> 対象: リポジトリ全体（29 ファイル、約 6,000 行）  
> 前回比の主要変更: 七並べ・スペード新規実装、共通カードユーティリティ抽出

---

## 過去レビュー残存指摘の対応状況

| ID | タイトル | 状態 |
|---|---|---|
| m-V5-1 | WS origin 無し許可 | ⚠️ 据え置き（設計判断） |
| m-V5-2 | `normalizeRoomSettings` guard 欠落 | ✅ `as ... \| undefined` + fallback 追加 (games.ts:132-138) |
| m-V6-2 | `shuffle` の共通化 | ✅ `src/shared/cards.ts` に移動 (cards.ts:27-36) |

---

## 今回の変更概要

### 新規ゲーム実装

| ゲーム | ファイル | 行数 | 内容 |
|---|---|---|---|
| 七並べ | `worker/games/sevens.ts` | 270 | スートレンジ管理、パス制御、bot戦略（7から遠いカード優先） |
| スペード | `worker/games/spades.ts` | 434 | ビッド→プレイ→スコア計算、チーム制、トランプルール、bot AI |

### 共通カードユーティリティ

| ファイル | 行数 | 内容 |
|---|---|---|
| `src/shared/cards.ts` | 110 | デッキ生成、シャッフル、ソート（aceHigh/suitOrder対応）、表示ユーティリティ |

### UI コンポーネント

| ファイル | 行数 |
|---|---|
| `SevensSurface.tsx` | 96 |
| `SpadesSurface.tsx` | 99 |

### その他
- `OldMaidSurface.tsx` が `cards.ts` の `formatCardLabel`/`isRedCard` を使用するようリファクタ (-240B)
- `old-maid.ts` が `cards.ts` の共通関数を使用するようリファクタ (-1372B)
- `common.ts` に `formatPlayerLabel` を移動 (七並べ・スペードからも参照)
- `normalizeRoomSettings` に undefined guard 追加
- スペード用に `getNextHumanSeat` で対角席優先配置、`resolveTeam` で `seat % 2` チーム割当
- CSS に七並べテーブル、スペードチームグリッド、playing-card 共通スタイル追加 (+2252B)
- ヘルプページに七並べ・スペードのルール説明追加
- GAME_CATALOG で七並べ・スペードが `active` に

---

## 新規レビュー結果

### 🔴 Critical

なし。

### 🟠 Major

#### M-V7-1. `spades-trick` に `display: grid` が欠落

- **ファイル**: `src/styles.css` L659-661
```css
.spades-trick {
  grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
}
```
- `display: grid` が宣言されていない。親の `.sevens-player-grid, .spades-team-grid, .spades-trick` (L580-585) で `display: grid` が設定されているため**動作はする**が、`.spades-trick` を単独で使う場合にレイアウトが崩れる。
- L580-585 のグループ宣言に依存しているため直接の問題はないが、`grid-template-columns` のオーバーライドだけの宣言は意図が分かりにくい。

#### M-V7-2. 七並べの「パスのみ可能な状態」が永続化するとゲームが進行不能になる

- **ファイル**: `worker/games/sevens.ts` L108-116
- 出せるカードがない場合はパスになるが、**全プレイヤーがパスしかできない膠着状態**の検出がない。正常なゲームでは 52 枚を配り切るため理論上起きないが、`seatCount` が手札に対して不均等な場合に可能性がある。
- `moveToNextSevensTurn` は `getNextSevensSeat` で手札が 0 のプレイヤーしか見ないため、全員手札持ちだが出せるカードなしの場合は無限パスループになる。bot がいる場合は `MAX_BOT_ITERATIONS` で保護されるが、人間のみの場合は永遠にパスし続ける。
- **修正案**: 全プレイヤーが連続パスした場合（例: 連続パス数 = 残りプレイヤー数）にゲーム終了とする。

#### M-V7-3. スペードのスコア計算が 1 ハンド完結で累積しない

- **ファイル**: `worker/games/spades.ts` L326-343
- `finishSpadesHand` で `teamScores` を計算し即座に `finished` にする。通常のスペードは複数ハンドを跨いで目標点（例: 500点）まで プレイするが、現実装は **1 ハンド完結**。
- SPEC.md を確認すると「1 ハンドの得点で勝敗を決めます」とあるため仕様通り。ヘルプ (App.tsx:557) にも「1 ハンドの得点で勝敗を決めます」と明記。
- **問題なし**。仕様と実装が一致している。✅

### 🟡 Minor

#### m-V7-1. `pickSevensBotCard` で `sortCards` を比較に使用

- **ファイル**: `worker/games/sevens.ts` L267
```typescript
return sortCards([left, right])[0] === left ? -1 : 1;
```
- `compareCards` を直接使う方が効率的。`sortCards` は配列をコピーしてソートするため余分なアロケーションが発生する。

#### m-V7-2. `SevensSurface` と `SpadesSurface` で `playingCardClass` が重複定義

- **ファイル**: `SevensSurface.tsx` L93-95, `SpadesSurface.tsx` L96-98
- 同一の関数が 2 ファイルに存在。`cards.ts` か共通コンポーネントに抽出すべき。

#### m-V7-3. `SpadesSurface` で `old-maid-panel` クラスを流用

- **ファイル**: `SpadesSurface.tsx` L51, `SevensSurface.tsx` L60
- ババ抜き用のクラス名を七並べ・スペードでも使用。機能的には問題ないが、汎用名（例: `card-hand-panel`）にリネームするとセマンティクスが改善する。

#### m-V7-4. `sevens-hand` クラスの CSS 定義がない

- **ファイル**: `SevensSurface.tsx` L65, `SpadesSurface.tsx` L74
- `.sevens-hand` クラスが CSS に定義されていない。`old-maid-hand` と同様の `display: flex; flex-wrap: wrap; gap: 10px` を意図していると思われるが、`old-maid-hand` の定義に `sevens-hand` を追加するか、新規に定義が必要。

#### m-V7-5. `playing-card` クラスの CSS 定義がない

- **ファイル**: `SevensSurface.tsx` L93, `SpadesSurface.tsx` L96
- `.playing-card`, `.playing-card--red`, `.playing-card--black` が CSS に定義されていない。七並べ・スペードの手札カードのスタイルが未適用の可能性がある。

---

## ✅ 良い点

- **`cards.ts` の設計**: `aceHigh` / `suitOrder` オプションでスペードの A ハイ・スート順を自然に表現。`createStandardDeck({ includeJoker: true })` でババ抜き用デッキも生成可能。
- **スペードのルール実装が正確**: リードスートのフォロー義務、スペード未解禁時のリード制限、トリック勝者判定（スペードトランプ）、チームスコア計算。
- **bot AI の品質**: スペード bot は手札強度に基づくビッド推定、パートナー勝ちかどうかの判定、最小勝ちカード戦略を実装。七並べ bot は 7 から最も遠いカードを優先。
- **`getNextHumanSeat` のスペード対角配置**: 人間プレイヤーを seats 0,2（対角）に優先配置し、bot を seats 1,3 にしてチームバランスを保つ。
- **一貫したパターン**: 全ゲームが `create*State` / `apply*Action` / `build*View` / `advance*BotTurns` の統一パターンに従う。

---

## 推奨アクション（優先度順）

1. **m-V7-4 + m-V7-5** — `.sevens-hand` と `.playing-card` の CSS 定義追加（**表示崩れの可能性大**）
2. **M-V7-2** — 七並べの全員パス膠着検出を追加
3. **M-V7-1** — `.spades-trick` の `display: grid` 依存を明確化
4. **m-V7-2** — `playingCardClass` の共通化
5. **m-V7-3** — `old-maid-panel` → 汎用クラス名にリネーム

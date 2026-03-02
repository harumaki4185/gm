# Mahjong Progress

## Current Goal
- `majang` ブランチ上で、4 人打ちリーチ麻雀の実装を段階的に進める。
- まずは `配牌 / 自摸 / 打牌 / bot / 河表示 / ドラ表示` の土台を作る。

## Completed In This Pass
- 麻雀用の共有牌ヘルパーを追加した。
  - `src/shared/mahjong.ts`
- ゲームカタログと共有型に `mahjong` を追加した。
  - `src/shared/types.ts`
  - `src/shared/games.ts`
- Worker 側に麻雀の Phase 1 ロジックを追加した。
  - 4 人固定卓
  - 配牌
  - 親の初手 14 枚
  - 自摸打牌の進行
  - 流局終了
  - bot の簡易打牌
  - `worker/games/mahjong.ts`
- フロント側に麻雀の試作 UI を追加した。
  - 手牌表示
  - 河表示
  - 手牌枚数と親表示
  - `src/components/games/MahjongSurface.tsx`
- ルール文言とヘルプに麻雀の現状を追記した。
  - `src/App.tsx`

## Current Scope
- 対応済み
  - 4 人卓
  - 1 人以上 + bot 補充
  - 配牌
  - 自摸
  - 打牌
  - 河表示
  - ドラ表示
  - 観戦時の手牌秘匿
- 未対応
  - 和了判定
  - 鳴き
  - 立直
  - フリテン
  - 槓
  - 点数計算
  - 局進行
  - 本場 / 供託
  - 東風戦 / 半荘戦
  - 本格 bot

## Next Steps
1. 手牌から `和了判定` を行えるようにする。
2. `ツモ / ロン` の勝敗処理を入れる。
3. `チー / ポン / カン` の割り込み処理を足す。
4. `立直 / フリテン / 点数計算` を入れる。
5. 局進行と通算スコアを実装する。

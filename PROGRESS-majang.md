# Mahjong Progress

## Current Goal
- `majang` ブランチ上で、4 人打ちリーチ麻雀の実装を段階的に進める。
- 現在は `和了判定 / ツモ / ロン / 鳴き / 点数表示` を含む 1 局分の土台を固める。

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
- Worker 側に Phase 2 ロジックを追加した。
  - 標準形 + 七対子の和了判定
  - ツモ / ロン
  - チー / ポン / 大明槓
  - 簡易役判定
  - 簡易点数計算
  - 副露公開
  - `worker/games/mahjong.ts`
- review 指摘を受けてロン競合処理を拡張した。
  - ダブロン対応
  - 三家和は流局
  - ロン待ちと通常の鳴き待ちを state 上で分離
  - 複数和了結果の表示
  - `worker/games/mahjong.ts`
  - `src/components/games/MahjongSurface.tsx`
- フロント側に麻雀のアクション UI を追加した。
  - ツモボタン
  - ロン / チー / ポン / カン / 見送り
  - 和了結果と点数差分
  - `src/components/games/MahjongSurface.tsx`

## Current Scope
- 対応済み
  - 4 人卓
  - 1 人以上 + bot 補充
  - 配牌
  - 自摸
  - 打牌
  - ツモ
  - ロン
  - チー
  - ポン
  - 大明槓
  - ダブロン
  - 三家和流局
  - 河表示
  - 副露表示
  - ドラ表示
  - 標準形 + 七対子の和了判定
  - 簡易役判定
  - 簡易点数計算
  - 観戦時の手牌秘匿
- 未対応
  - 立直
  - フリテン
  - 暗槓
  - 加槓
  - 正式な点数計算
  - 正式な符計算
  - 多面待ち込みの厳密判定
  - 局進行
  - 本場 / 供託
  - 東風戦 / 半荘戦
  - 本格 bot

## Next Steps
1. `立直 / フリテン / 暗槓 / 加槓` を入れる。
2. `正式な役・符計算` と待ち形判定へ寄せる。
3. `親流れ / 連荘 / 本場 / 供託 / 局進行` を実装する。
4. `bot の和了判断と鳴き判断` を強化する。

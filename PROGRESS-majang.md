# Mahjong Progress

## Current Goal
- `majang` ブランチ上で、4 人打ちリーチ麻雀の実装を段階的に進める。
- 現在は `立直 / 槓 / 局進行 / 役と符 / bot 判断` を広げながら、1 半荘を最後まで進められる状態へ寄せる。

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
- Worker 側で Phase 3 相当のロジックを追加した。
  - 立直
  - フリテン
  - 暗槓
  - 加槓
  - 嶺上牌と複数ドラ表示
  - 海底 / 河底 / 槍槓 / 嶺上開花
  - 本場 / 供託
  - 局結果から次局への進行
  - `worker/games/mahjong.ts`
- 役と符を主要役ベースで拡張した。
  - 一盃口 / 二盃口
  - 三色同順 / 三色同刻
  - 一気通貫
  - 混全帯么九 / 純全帯么九 / 混老頭
  - 小三元 / 三暗刻 / 三槓子
  - 待ち形による符加算
  - 本場込みの支払い計算
  - `worker/games/mahjong.ts`
- UI を局進行対応へ更新した。
  - 本場 / 供託表示
  - 複数ドラ表示
  - 立直 / フリテン badge
  - 立直 / 暗槓 / 加槓 / 次局進行ボタン
  - `src/components/games/MahjongSurface.tsx`
- bot 判断を強化した。
  - 立直候補の待ち枚数で判断
  - 暗槓 / 加槓前に手の進み具合を比較
  - 打牌時に待ちとドラを加味
  - `worker/games/mahjong.ts`

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
  - 暗槓
  - 加槓
  - 立直
  - フリテン
  - ダブロン
  - 三家和流局
  - 河表示
  - 副露表示
  - ドラ表示
  - 標準形 + 七対子の和了判定
  - 本場 / 供託
  - 親流れ / 連荘
  - 東場の局進行
  - 複数和了結果表示
  - 主要役判定
  - 待ち形を含む符計算
  - bot の立直 / 槓 / 打牌判断
  - 観戦時の手牌秘匿
- 未対応
  - 国士無双など役満全般
  - ダブル立直
  - 裏ドラ / 赤ドラ
  - 立直後暗槓の厳密可否
  - 九種九牌 / 四風連打 / 四家立直 / 四開槓
  - 南場まで含む半荘戦設定 UI
  - bot の守備判断とベータオリ

## Next Steps
1. `役満 / ダブル立直 / 裏ドラ / 赤ドラ` を足して役計算を広げる。
2. `流局イベント` と `立直後暗槓可否` を詰める。
3. `半荘戦設定 UI` と `matchType` 切り替えを待機画面へ出す。
4. `bot の守備判断` を入れて放銃率を下げる。

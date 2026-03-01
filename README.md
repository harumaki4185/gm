# Classic Duels

Cloudflare Workers と Durable Objects を前提にした、二人用オンライン古典ゲーム集の実装ベースです。

## 現在の実装範囲

- React + TypeScript のフロントエンド
- Cloudflare Workers の API エントリポイント
- Durable Object ベースのルーム管理
- 招待リンクによるルーム作成 / 参加 / 再接続 / 再戦
- WebSocket による状態同期
- 実装済みゲーム
  - オセロ
  - 五目並べ
  - 四目並べ
  - じゃんけん
  - ババ抜き
- カタログ定義のみ
  - 七並べ
  - スペード

## ファイル構成

- `src/`
  - React アプリ
- `src/shared/`
  - Worker / Client 共通の型とゲーム定義
- `worker/index.ts`
  - Worker エントリポイント
- `worker/router.ts`
  - API ルーティング
- `worker/room.ts`
  - Room Durable Object 本体
- `worker/games.ts`
  - ゲームロジック
- `worker/rate-limit.ts`
  - ルーム作成レート制限
- `SPEC.md`
  - 要件と仕様書
- `PROGRESS.md`
  - 進捗と次作業

## 開発メモ

- `wrangler.jsonc` で `RoomDurableObject` を束ねている
- 現段階では七並べ / スペード / bot 行動は未実装
- ログイン、ランキング、ランダムマッチングは意図的に入れていない

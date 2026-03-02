# Classic Duels

Cloudflare Workers と Durable Objects を前提にした、招待リンク型オンライン古典ゲーム集の実装ベースです。

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
    - 2-6 人対応
  - ババ抜き
    - 2-4 人対応
    - bot 補充対応
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
- `worker/games/`
  - ゲームロジック
  - `index.ts` が Worker から見える集約入口
- `worker/rate-limit.ts`
  - ルーム作成レート制限
- `src/components/games/`
  - ゲーム画面ごとの UI コンポーネント
- `SPEC.md`
  - 要件と仕様書
- `PROGRESS.md`
  - 進捗と次作業

## 開発メモ

- `wrangler.jsonc` で `RoomDurableObject` を束ねている
- 現段階では七並べ / スペードは未実装
- ゲーム詳細画面から可変人数ルームや bot 補充を指定できる
- ログイン、ランキング、ランダムマッチングは意図的に入れていない

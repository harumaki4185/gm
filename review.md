# Classic Duels コードレビュー

> レビュー日: 2026-03-01  
> 対象: リポジトリ全体（全 11 ソースファイル、約 2,500 行）

---

## 総合評価

初期 MVP としてはよく構成されており、shared 型の一貫性・Durable Object の設計・フロントエンドの簡潔さは好印象。  
以下、**重大度別**に改善点をまとめる。

---

## 🔴 Critical（バグ・セキュリティ）

### ~~C-1. `rematchVotes` に `sessionId` を公開している~~

- **ファイル**: `worker/index.ts` L510, `src/shared/types.ts` L118
- `RoomSnapshot.rematchVotes` は `sessionId` の配列をそのままクライアントに返している。`sessionId` はプレイヤー認証トークンに相当するため、**他プレイヤーのセッションを乗っ取れる**。
- **修正案**: `rematchVotes` を `playerId[]` に変換するか、単に投票済みの `seat` 番号のリストにする。

### ~~C-2. WebSocket 接続時にルーム参加チェックだけで `connected` を `true` にする~~

- **ファイル**: `worker/index.ts` L405
- `handleWebSocket` で参加者の存在を確認すると無条件で `connected = true` に設定しているが、`roomStatus === "finished"` や既に全員離脱後のルームでも再接続できてしまう。
- 参加者の `sessionId` をパスに持つ URL を知っていれば任意の WebSocket が接続可能。

### ~~C-3. `playerName` のサニタイズが不十分~~

- **ファイル**: `worker/index.ts` L1079-1084
- `sanitizePlayerName` は trim + 長さチェック + 20 文字切り詰めのみ。SPEC §8.3 で **禁止ワード制御** が求められているが未実装。
- HTML インジェクション対策はフロントが React なので JSX エスケープで概ね防げるが、WebSocket 経由でペイロードが直接送られるため、サーバー側でも制御文字（例: `\u0000`, ZWJ シーケンス）の除去が望ましい。

### ~~C-4. `roomId` が推測可能~~

- **ファイル**: `worker/index.ts` L1105-1107
- `makeRoomId()` は `crypto.randomUUID()` の先頭 8 文字のみ。SPEC §8.3 「推測されにくいランダム値」に対し、32 bit entropy しかない。ブルートフォースで他者のルームに到達できる可能性がある。
- **修正案**: UUID 全体を使うか、最低 16 文字以上にする。

### ~~C-5. API にレート制限がない~~

- **ファイル**: `worker/index.ts` — fetch ハンドラ全体
- SPEC §8.3 で要件となっているが未実装。ルーム作成 (`POST /api/rooms`) が連打可能で、Durable Object を大量に生成される恐れがある。

---

## 🟠 Major（設計・堅牢性）

### ~~M-1. `worker/index.ts` が 1,139 行の巨大ファイル~~

- API ルーティング・Durable Object クラス・全ゲームロジック（じゃんけん・五目並べ・四目並べ・オセロ）・ヘルパーが単一ファイルに凝縮されている。
- SPEC §8.4 に「ゲームロジックはゲームごとに分離する」「共通のルーム管理層と個別ゲームルール層を分ける」とあるが守られていない。
- **修正案**: 最低限、以下の分割を推奨。
  - `worker/routing.ts` — fetch handler
  - `worker/room.ts` — RoomDurableObject
  - `worker/games/janken.ts`, `worker/games/gomoku.ts`, `worker/games/othello.ts`, `worker/games/connect4.ts`

### ~~M-2. 放置ルームの自動破棄が未実装~~

- SPEC §10「一定時間参加者が揃わないルームは自動破棄」が対応されていない。
- Durable Object の alarm API (`state.storage.setAlarm`) を使ってタイムアウト破棄を実装すべき。

### ~~M-3. 切断時の勝敗処理がない~~

- SPEC §7.1「離脱時の勝敗処理」および §16「プレイヤーが手番中に切断した」のエッジケースが未対応。
- 現状、切断しても `connected: false` が設定されるだけで、手番が永遠に回ってこず対戦が停止する。

### ~~M-4. じゃんけんで「あいこ→再戦」の導線がない~~

- `resolveJanken` で引き分け時にも `room.roomStatus = "finished"` になる（L673）。
- じゃんけんの仕様は「連戦しやすいテンポを重視」なので、あいこ時は自動的に次ラウンドへ進む設計が望ましい。

### ~~M-5. `error` の throw が HTTP ステータスに一律 400 で返される~~

- **ファイル**: `worker/index.ts` L1130-1138
- `toErrorResponse` がすべての `Error` メッセージを 400 で返す（`ROOM_NOT_FOUND` だけ 404）。手番違反 (403 相当）やゲーム終了済み (409 相当) も 400 になり、フロントで原因の区別ができない。

### ~~M-6. `App.tsx` の `RoomPage` — `useEffect` の依存配列に `sessionId` が含まれており二重フェッチが発生する~~

- **ファイル**: `src/App.tsx` L134-172
- `joinRoom` 成功時に `setSessionId` を呼ぶと、この `useEffect` が再実行されて `/reconnect` リクエストが重複する。初回参加直後に不要な再接続 API が走る。

---

## 🟡 Minor（コード品質・保守性）

### ~~m-1. `.gitignore` が空~~

- `node_modules/`, `dist/`, `.wrangler/` などが除外されていない。

### ~~m-2. `index.html` に meta description がない~~

- SEO 要件上 `<meta name="description" ...>` を追加すべき。

### ~~m-3. フロントエンドにルーター不在~~

- 自前で `path` + `pushState` + `popstate` を使っている。規模が小さい現段階では問題ないが、ゲーム詳細ページやルール/ヘルプ画面の追加時にはルーターの導入を検討すべき。

### ~~m-4. `parseResponse` の型安全性~~

- **ファイル**: `src/App.tsx` L368-375
- `response.json()` の結果を `as T | ApiErrorBody` にキャストしているがランタイム検証がない。サーバーが予期しない JSON を返した場合にクラッシュする。
- 最低限 `error` プロパティの存在チェックで分岐する方が安全。

### ~~m-5. 定数の重複: ゲームタイトル~~

- `GameSurface.tsx` L116 で `snapshot.gameId === "gomoku" ? "五目並べ" : "オセロ"` とハードコードされているが、`GAME_CATALOG` から参照すべき。

### ~~m-6. `GameView` の `import` パス~~

- **ファイル**: `worker/index.ts` L786
- `buildView` の戻り値型 `GameView` がインポートされておらず、暗黙の any にならないのは TypeScript の推論に頼っているだけ。明示インポートを追加すべき。

### ~~m-7. `board[0].length` の null 安全アクセス~~

- **ファイル**: `worker/index.ts` L848, L862, L953, L963, L976
- `board[0]?.length ?? 0` と optional chaining している箇所と、`board[0].length` を直接参照している箇所が混在。空の board が来るとランタイムエラーになる。

### ~~m-8. WebSocket 再接続のバックオフがない~~

- **ファイル**: `src/App.tsx` L199-203
- 切断時に 1.2 秒固定で `socketRevision` をインクリメントして再接続しているが、指数バックオフや最大リトライ数の制御がない。サーバーダウン時に無限再接続ループになる。

### ~~m-9. `connect4-dropbar` のレスポンシブ問題~~

- 7 列を `repeat(3, ...)` や `repeat(2, ...)` で表示するレスポンシブ設定になっている。ドロップバーのボタン数が実際の列番号と一致しなくなるわけではないが、ボタンが折り返される際の視認性が悪い。
- 列を `repeat(7, ...)` 固定にしてボタンサイズを調整する方が操作性が良い。

### ~~m-10. `getNextHumanSeat` のフォールバックが不安全~~

- **ファイル**: `worker/index.ts` L1102
- `players.length` を返すが、これは `totalSeats` を超える可能性がある。空席がない場合の拒否処理が `handleJoin` 側の人数チェックに依存しており、一貫性のため `getNextHumanSeat` 内でも例外を投げるか `-1` を返してチェックすべき。

---

## 📋 SPEC との乖離まとめ

| SPEC 項目 | 状態 | 備考 |
|---|---|---|
| §7.1 離脱時の勝敗処理 | ~~✅ 対応~~ | 切断猶予後の不戦勝処理を追加 |
| §7.2 禁止ワード制御 | ~~✅ 対応~~ | 制御文字除去と禁止ワード判定を追加 |
| §8.3 推測されにくいランダム値 | ~~✅ 対応~~ | ルーム ID を UUID ベースへ変更 |
| §8.3 API レート制限 | ~~✅ 対応~~ | `POST /api/rooms` に DO ベースの制限を追加 |
| §8.4 ゲームロジック分離 | ~~✅ 対応~~ | `worker/` 配下を分割 |
| §9.2 ゲーム詳細ページ | ~~✅ 対応~~ | `/games/:id` を追加 |
| §9.5 結果画面 | ⚠️ 部分的 | ゲーム画面内に表示されるが専用画面なし |
| §9.6 ルール/ヘルプ画面 | ~~✅ 対応~~ | `/help` を追加 |
| §10 放置ルーム自動破棄 | ~~✅ 対応~~ | alarm で自動破棄 |
| §11.4 じゃんけん連戦テンポ | ~~✅ 対応~~ | あいこ時に次ラウンドへ継続 |
| §7.4 切断通知 | ⚠️ 部分的 | connected 状態は通知されるが UI が弱い |
| §7.7 管理機能 | ❌ 未実装 | 管理画面全般 |

---

## ✅ 良い点

- **shared 型が一元管理されている**: `src/shared/types.ts` と `src/shared/games.ts` をフロント・ワーカー双方からインポートしており型不一致のリスクが低い。
- **Durable Object 設計がシンプル**: 1 ルーム = 1 DO の原則が守られ、状態の save/broadcast が明快。
- **WebSocket + REST 併用のパターンが良い**: アクション送信は REST、リアルタイム更新は WebSocket と分離されており、デバッグしやすい。
- **ゲームロジックの正確性**: オセロの石返し・合法手判定、五目並べの勝利判定、四目並べの重力落下ロジックは正確に実装されている。
- **CSS デザインシステム**: CSS 変数ベースのデザイントークンが一貫して使われ、ビジュアルの統一感がある。
- **フォールバック routing**: `serveApp` で拡張子のないリクエストを `index.html` に返す SPA フォールバックが正しく動いている。

---

## 推奨アクション（優先度順）

1. ~~**C-1** — `rematchVotes` の `sessionId` 漏洩を修正（即時対応）~~
2. ~~**C-4** — `roomId` のエントロピーを増やす~~
3. ~~**C-5** — 最低限 `POST /api/rooms` にレート制限を追加~~
4. ~~**M-1** — Worker ファイルの分割に着手~~
5. ~~**M-2** — Durable Object alarm でルーム自動破棄を実装~~
6. ~~**M-3** — 切断タイムアウトと勝敗処理のフローを追加~~
7. ~~**m-1** — `.gitignore` を整備~~

# Classic Duels コードレビュー (v2)

> レビュー日: 2026-03-01  
> 対象: リポジトリ全体（20 ファイル、約 3,300 行）  
> 前回レビュー: 同日の初回レビューで 21 件（C-5 / M-6 / m-10）を指摘

---

## 前回指摘の修正確認

全 21 件について修正を確認した。以下は確認結果の要約。

| ID | タイトル | 状態 | 確認のポイント |
|---|---|---|---|
| C-1 | `rematchVotes` の `sessionId` 漏洩 | ✅ 修正済 | `room.ts` L456-458: `playerId` → seat 番号に変換して返却 |
| C-2 | WebSocket 接続時の無条件 `connected = true` | ✅ 修正済 | `room.ts` L297-298: `assert(participant.connected)` と `cleanup` 中のチェック追加 |
| C-3 | `playerName` のサニタイズ不十分 | ✅ 修正済 | `utils.ts` L9-23: 制御文字除去 + 禁止ワードチェック |
| C-4 | `roomId` が推測可能 | ✅ 修正済 | `utils.ts` L27: UUID 全体（ハイフン除去 = 32 hex = 128 bit） |
| C-5 | API レート制限なし | ✅ 修正済 | `rate-limit.ts`: DO ベースの IP 単位レート制限を実装 |
| M-1 | Worker 1,139 行の巨大ファイル | ✅ 修正済 | 9 ファイルに分割 |
| M-2 | 放置ルーム自動破棄なし | ✅ 修正済 | `room.ts` L81-122: alarm による `waiting_expire` / `cleanup` |
| M-3 | 切断時の勝敗処理なし | ✅ 修正済 | `games.ts` L167-224: `markDisconnectPending` / `finalizeByDisconnect` |
| M-4 | じゃんけんで あいこ→再戦 の導線なし | ✅ 修正済 | `games.ts` L285-291: あいこ時に `round` をインクリメントして継続 |
| M-5 | throw が一律 400 | ✅ 修正済 | `errors.ts`: `AppError(message, status)` パターン、全 throw に個別 status |
| M-6 | `useEffect` 依存で二重フェッチ | ✅ 修正済 | `App.tsx` L148,158-163,271: `skipNextReconnectRef` + `refreshRevision` で分離 |
| m-1 | `.gitignore` が空 | ✅ 修正済 | `node_modules/`, `dist/`, `.wrangler/`, `.DS_Store` 追加 |
| m-2 | meta description なし | ✅ 修正済 | `index.html` L9-12 |
| m-3 | ルーター不在 | ✅ 修正済 | `src/router.ts`: `Route` 型 + `parseRoute` / `toPath` |
| m-4 | `parseResponse` の型安全性 | ✅ 修正済 | `App.tsx` L490,504-506: `isApiErrorBody` ガード + `ApiRequestError` クラス |
| m-5 | ゲームタイトルのハードコード | ✅ 修正済 | `GameSurface.tsx` L118: `GAME_MAP[snapshot.gameId].title` |
| m-6 | `GameView` の明示インポートなし | ✅ 修正済 | `games.ts` L5: `GameView` をインポート |
| m-7 | `board[0].length` の null 安全 | ✅ 修正済 | `games.ts` L427-429: `getColumnCount` ヘルパーに統一 |
| m-8 | WebSocket 再接続のバックオフなし | ✅ 修正済 | `App.tsx` L235-236: 指数バックオフ（max 10 秒） |
| m-9 | `connect4-dropbar` のレスポンシブ | ✅ 修正済 | `GameSurface.tsx` L82: inline style で `repeat(cols, ...)` に動的設定 |
| m-10 | `getNextHumanSeat` のフォールバック | ✅ 修正済 | `utils.ts` L46: `throw new AppError("空席がありません", 409)` |

---

## 新規レビュー結果

### 🟠 Major

#### N-1. `RateLimiterDurableObject.alarm()` が全バケットを削除する

- **ファイル**: `worker/rate-limit.ts` L51-52
- `alarm()` で `deleteAll()` を呼んでいるため、複数キーのバケットが同時に存在する場合に未期限のバケットまで消える。現状は `create_room` のみなので実害は薄いが、将来キーを増やすと意図せずリセットされる。
- **修正案**: 期限切れキーのみ個別 delete するか、1 key = 1 DO に設計変更する。

#### N-2. `handleSocketClose` のエラーハンドリングがない

- **ファイル**: `worker/room.ts` L314-316
- `close` イベントハンドラから `handleSocketClose` を `async` で呼んでいるが、reject をキャッチしていない。storage アクセスに失敗すると uncaught promise rejection になり Workers ランタイムでログが流れるだけになる。
- **修正案**: `.catch()` でエラーログを追記するか、`try/catch` で囲む。

#### N-3. `rematchVotes` 内部ストレージに `playerId` を入れているが roomId 同様に推測リスクがある

- **ファイル**: `worker/room.ts` L270, L278
- `rematchVotes` は `player.id`（UUID）を格納しており、スナップショットでは seat 番号に変換している（C-1 修正済）。ただし `handleRematch` は `body.sessionId` を照合して `actor.id` を使う設計なので安全。
- ✅ 問題なし — コメントのみ。

#### N-4. `GameDetailPage` の「ルーム作成へ」ボタンがトップに戻されるだけ

- **ファイル**: `src/App.tsx` L453
- `navigate({ kind: "home" })` に遷移するので、該当ゲームのルーム作成へ直接進む導線にはなっていない。ゲーム詳細ページからそのゲームのルームを直接作成できると UX が向上する。

#### N-5. WebSocket 再接続の最大リトライ数が未設定

- **ファイル**: `src/App.tsx` L235-241
- 指数バックオフは実装されたが、最大リトライ数（例: 10 回）の上限がない。サーバー長時間ダウン時に永続的にリトライし続ける。
- 致命的ではないが、上限到達時に「サーバーに接続できません」とユーザーに明示すべき。

---

### 🟡 Minor

#### n-1. `router.ts` の `parseRoute` で `gameId` の存在チェックがない

- **ファイル**: `src/router.ts` L17
- `gameMatch[1] as GameId` は unsafe cast。`/games/invalid` が `GameDetailPage` に到達する。`GameDetailPage` 側で `GAME_MAP[gameId]` の null チェックがあるので表示は崩れないが、ルーター側でバリデーションすると型安全性が向上する。

#### n-2. `janken-actions` と `connect4-dropbar` の CSS `grid-template-columns` が style 属性と CSS クラスで二重定義される可能性

- **ファイル**: `src/styles.css` L365-369, `src/components/GameSurface.tsx` L82
- CSS では `.janken-actions, .connect4-dropbar { display: grid; gap: 10px; }` だけで `grid-template-columns` の初期値がないが、JSX 側で inline style を設定している。`janken-actions` は inline style なしのため CSS 側にも `grid-template-columns: repeat(3, minmax(0, 1fr))` を残すべき。

#### n-3. `rematchVotes` の型が `number[]` だがフロント側で未使用

- **ファイル**: `src/shared/types.ts` L118
- `RoomSnapshot.rematchVotes: number[]` は座席番号の配列だが、フロント側ではどこからも参照されていない。投票状態の UI 表示（「相手が再戦を希望しています」等）に使わないと、片方だけ投票した場合にフィードバックがない。

#### n-4. `alarm()` 内の日時比較に timezone リスク

- **ファイル**: `worker/room.ts` L88
- `new Date(room.lifecycleAlarm.at).getTime()` でパースしているが、`at` は `nowIso()` = `new Date().toISOString()` 由来なので UTC フォーマット。Workers ランタイムでは問題ないが、ローカルテスト時に注意。
- ✅ 既存コンテキストでは問題なし。

#### n-5. `detail-card` が glass morphism 系カードの共通定義 (L67-78) に含まれない

- **ファイル**: `src/styles.css` L67-78
- `.surface-card` は共通カード定義に含まれるが、`GameDetailPage` と `HelpPage` で `surface-card detail-card` クラスを使用しており `.detail-card` 自体は独自定義 (L456-458) が `max-width` のみ。`backdrop-filter` と `box-shadow` は `.surface-card` 経由で適用されるので見た目は問題ない。
- ✅ 既存コンテキストでは問題なし — セレクタの意図のコメント追加を推奨。

#### n-6. `README.md` が更新されていない

- README には「カタログ定義のみ: ババ抜き、七並べ、スペード」「現段階ではカードゲームのロジックと bot 行動は未実装」とあり正確だが、worker 分割やレート制限・ルーター追加などの構成変更が反映されていない。

---

## SPEC との乖離まとめ（更新版）

| SPEC 項目 | 状態 | 備考 |
|---|---|---|
| §7.1 離脱時の勝敗処理 | ✅ 対応 | 切断猶予後の不戦勝処理 |
| §7.2 禁止ワード制御 | ✅ 対応 | 制御文字除去 + 禁止ワード判定 |
| §7.4 切断通知 | ⚠️ 部分的 | connected 状態は通知されるが UI が弱い (n-3 関連) |
| §7.7 管理機能 | ❌ 未実装 | 管理画面全般 |
| §8.3 推測されにくいランダム値 | ✅ 対応 | UUID ベースへ変更 |
| §8.3 API レート制限 | ✅ 対応 | DO ベースの制限 |
| §8.4 ゲームロジック分離 | ✅ 対応 | worker/ 配下を分割 |
| §9.2 ゲーム詳細ページ | ✅ 対応 | `/games/:id` を追加 |
| §9.5 結果画面 | ⚠️ 部分的 | ゲーム画面内に表示されるが専用画面なし |
| §9.6 ルール/ヘルプ画面 | ✅ 対応 | `/help` を追加 |
| §10 放置ルーム自動破棄 | ✅ 対応 | alarm で自動破棄 |
| §11.4 じゃんけん連戦テンポ | ✅ 対応 | あいこ時に次ラウンドへ継続 |

---

## ✅ 良い点（追加分）

- **`AppError` + `assert` パターン**: 全 throw に HTTP status が紐づき、エラーレスポンスが正確。`assert` ヘルパーで guard clause が簡潔に書けている。
- **ライフサイクル alarm 設計**: `LifecycleAlarm` を `RoomRecord` に直接持たせることで、alarm のコンテキストを失わない設計になっている。
- **`skipNextReconnectRef` による join-fetch 分離**: React effect の依存をいじるのではなく ref で制御し、宣言的な effect 構造を維持している。
- **`getColumnCount` への統一**: null 安全共通ヘルパーを一箇所にまとめ、全関数から呼び出している。

---

## 推奨アクション（優先度順）

1. **N-2** — `handleSocketClose` のエラーハンドリングを追加
2. **N-1** — Rate limiter の `deleteAll()` を期限切れキーのみ削除に変更
3. **N-5** — WebSocket 再接続に最大リトライ数を設定
4. **N-4** — ゲーム詳細ページからのルーム作成ショートカットを追加
5. **n-3** — `rematchVotes` を UI に反映して再戦待ちフィードバックを改善
6. **n-6** — `README.md` を最新の構成に更新

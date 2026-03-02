# Classic Duels コードレビュー (v4)

> レビュー日: 2026-03-02  
> 対象: リポジトリ全体（20 ファイル、約 4,500 行）  
> 前回比の主要変更: 複数人対応 (じゃんけん 2-6人, ババ抜き 2-4人), bot 自動行動, 可変席数 UI, `RoomSettings.seatCount`

---

## v3 指摘の対応状況

| v3 → v4 | タイトル | 状態 |
|---|---|---|
| M-4 (v2 N-2) | `handleSocketClose` 未 catch | ✅ `.catch(() => {})` 追加済み (room.ts:323) |
| M-3 | スロット推測可能 | ✅ `shuffle()` で target slots シャッフル済み (games.ts:314) |
| M-5 | ヘルプにババ抜き未記載 | ✅ 追記済み (App.tsx:544) |
| M-1 | 両方手札 0 の安全弁 | ✅ `resolveOldMaidWinner` が `draw` ケースを処理 (games.ts:741-744) |
| m-5 | `janken-actions` columns 未指定 | ✅ `grid-template-columns: repeat(3, ...)` 追加 (styles.css:397-399) |
| m-1 | `selfSeat ?? 0` 不要 fallback | ✅ 削除済み（`buildOldMaidView` リファクタ) |
| m-6 | `README.md` worker 構成未記載 | ✅ 全ファイル記載済み (README.md:31-39) |
| v2 N-1 | Rate limiter `deleteAll()` | ⚠️ 未対応（`alarm()` は特定キーのみ削除） |
| v2 N-5 → 対応 | WS 再接続リトライ上限 | ✅ `MAX_SOCKET_RETRIES = 6` 追加済み (App.tsx:27,230) |
| v2 n-1 | `router.ts` `gameId` unsafe cast | ✅ `isGameId` type guard 追加済み (router.ts:41-43) |
| v2 n-3 | `rematchVotes` UI 未使用 | ✅ プレイヤーリストに「再戦投票済み」表示 (App.tsx:362) |
| v2 N-4 | ゲーム詳細→ルーム直接作成 | ✅ `GameDetailPage` で直接ルーム作成可能に (App.tsx:450-464) |

**残存**: rate limiter alarm の `delete(ROOM_CREATE_BUCKET_KEY)` のみ。動的キー名が `bucket:create_room` なので衝突しないが、将来キーを増やした場合に対応必要。

---

## 新規レビュー結果

### 🔴 Critical

なし。

### 🟠 Major

#### M-V4-1. `advanceAutomatedTurns` の while ループに上限がない

- **ファイル**: `worker/games.ts` L572-605
- bot ターンを `while (room.roomStatus === "playing")` で回しているが、`applyOldMaidAction` 内で `room.roomStatus` が `"playing"` のまま無限に回り続ける可能性がある（例: バグで `getNextOldMaidTurnSeat` が bot を返し続ける場合）。
- 53 枚デッキ ÷ 2 プレイヤー = 最大 27 ターンなので正常系では問題ないが、防御として上限を設けるべき。

```diff
+ const MAX_BOT_ITERATIONS = 100;
+ let iterations = 0;
  while (room.roomStatus === "playing") {
+   if (++iterations > MAX_BOT_ITERATIONS) break;
```

#### M-V4-2. `handleJoin` で `room.roomStatus === "waiting"` チェックが新規参加者のみに適用

- **ファイル**: `worker/room.ts` L192
- 既存プレイヤーの再参加 (L176-190) は `roomStatus` チェックなしで成功するが、新規参加にはステータスチェックがある。
- これ自体は正しい挙動（再接続は許可）だが、`playing` 状態でも既存セッションの `join` が reconnect 相当の動作をするため、**`/reconnect` エンドポイントとの責務の重複**が生じている。
- 直接のバグではないが、新規プレイヤーに `room.roomStatus !== "waiting"` 時に「参加締め切り」を返す UX は良い改善。✅

#### M-V4-3. `normalizeRoomSettings` で `fillWithBots` が `supportsBots` 依存だが不正値を受け入れる

- **ファイル**: `src/shared/games.ts` L125-136
- `supportsBots` が `false` のゲームで `fillWithBots: true` を送ると `false` に正規化される（正しい）。
- しかし `seatCount` はクランプされるものの、`fillWithBots` の型チェックがないため `fillWithBots: "yes"` のような truthy 文字列が `true` として扱われる。
- 実害は低いが、`typeof settings?.fillWithBots === "boolean"` のチェックを入れるとより堅牢。

---

### 🟡 Minor

#### m-V4-1. `resolveJanken` の 3 すくみ処理

- **ファイル**: `worker/games.ts` L608-620
- `presentChoices.size !== 2` のとき空配列（あいこ）を返す。これは 3 種全部出た場合と全員同一手の場合の両方を正しく処理している。✅ 問題なし。

#### m-V4-2. `getOldMaidSourceSeat` は「左隣」からカードを引く設計

- **ファイル**: `worker/games.ts` L766-777
- `(seat - offset + length) % length` で **反時計回りに隣の手札を探す**。これはルール的に正しい（ババ抜きは左隣から引く）。
- ただし 3 人以上で中間プレイヤーが上がった場合にスキップして正しく次の持ち札プレイヤーを見つけている。✅

#### m-V4-3. `OldMaidOpponentView.targetableSlots` のシャッフルに `toString()` → `Number()` 変換

- **ファイル**: `worker/games.ts` L314
```typescript
shuffle(hand.map((_, index) => index.toString())).map((value) => Number(value))
```
- `shuffle` 関数は `string[]` を受けるため、`number[]` を直接シャッフルできない。これは型制約によるワークアラウンドだが、`shuffleNumbers` ヘルパーを作るか `shuffle` をジェネリックにすると読みやすくなる。

#### m-V4-4. `GameDetailPage` で `game` が null の場合に hooks が先に呼ばれる

- **ファイル**: `src/App.tsx` L431-437
- `const [seatCount, setSeatCount] = useState(defaultSettings.seatCount)` がコンポーネント先頭で呼ばれ、その後に `if (!game)` で早期 return している。
- React の hooks ルール上、条件分岐の前に hooks を呼ぶのは必須なのでこれ自体は正しい。ただし `GAME_MAP[gameId]` が undefined の場合 `getDefaultRoomSettings(gameId)` が `GAME_MAP[gameId].defaultSeats` で crash する。
- `parseRoute` で `isGameId` のチェックが入っているため、`gameId` は常に有効な ID のはずだが、URL 直打ちで無効な `gameId` が渡されると crash の可能性がある。

**修正案**: `getDefaultRoomSettings` の先頭に guard を追加。
```typescript
export function getDefaultRoomSettings(gameId: GameId): RoomSettings {
  const game = GAME_MAP[gameId];
  if (!game) return { fillWithBots: false, seatCount: 2 };
  ...
}
```

#### m-V4-5. `LandingPage` でルーム作成前の表示名バリデーションが移動

- **ファイル**: `src/App.tsx` L68-80
- v3 では `createRoom` 内で `playerName.trim().length < 2` チェックがあったが、v4 では `createRoomOnServer` (L588) に移動。
- これ自体は正しいが、`LandingPage.createRoom` はバリデーション前に `setPendingGameId(gameId)` を呼ぶためボタンが一瞬 busy 状態になり、エラー時に戻る。表示名が短いことが明らかな場合にネットワークリクエストを省けない。
- 低優先度だが UX 改善の余地あり。

#### m-V4-6. rate limiter alarm がハードコードキーを削除

- **ファイル**: `worker/rate-limit.ts` L53
```typescript
await this.state.storage.delete(ROOM_CREATE_BUCKET_KEY);
```
- `ROOM_CREATE_BUCKET_KEY = "bucket:create_room"` だが、`fetch` 側では `bucketKey = "bucket:" + key` で動的生成。両者が一致するのは `key === "create_room"` のときのみ。
- 現在はこのキーしか使わないので問題ないが、将来 rate limit 対象を増やすと alarm でそのキーが消えない。
- **修正案**: alarm 時に `storage.list({ prefix: "bucket:" })` で全バケットをチェックするか、`resetAt` をバケットの `resetAt` と比較して期限切れ分のみ削除する。

---

## ✅ 良い点

- **`normalizeRoomSettings` のサーバーサイド検証**: クライアントから送られた `seatCount` を `Math.min(maxSeats, Math.max(minSeats, ...))` でクランプし、`fillWithBots` も `supportsBots` に基づいて正規化。入力改ざんに対して堅牢。
- **`advanceAutomatedTurns` の設計**: ゲームアクション後に呼ばれ、連続する bot ターンを同期的に処理。WebSocket broadcast は bot ターン完了後に一度だけ行われるため効率的。
- **`OldMaidOpponentView` の分離**: 各相手プレイヤーの情報を個別の構造体で返すことで、3人以上対応時の UI レンダリングが自然に。
- **`isGameId` type guard**: `router.ts` でフロントエンドルーティング時に `gameId` を型安全に検証。無効な ID は `home` にフォールバック。
- **`RoomPage` の非参加者向け UI 改善**: `waiting` 状態でのみ参加フォームを表示し、`playing`/`finished` 時には「締め切り」メッセージ。
- **`closeRoom` の try/catch**: 切断済みソケットへの `close()` 呼び出しで例外が出てもルーム削除処理が続行。
- **`sendSnapshot` の try/catch**: 壊れたソケットへの `send()` で例外が出ても他のソケットへの送信が止まらない。
- **`janken-slot--winner` の視覚フィードバック**: 勝者のじゃんけんスロットにゴールドの outline が表示される。

---

## 推奨アクション（優先度順）

1. **M-V4-1** — `advanceAutomatedTurns` に反復上限を追加（安全弁）
2. **m-V4-4** — `getDefaultRoomSettings` に guard 追加（URL 直打ち対策）
3. **m-V4-3** — `shuffle` をジェネリック化して `toString/Number` ワークアラウンド解消
4. **m-V4-6** — rate limiter alarm の動的キー削除対応
5. **M-V4-3** — `fillWithBots` に boolean 型チェック追加

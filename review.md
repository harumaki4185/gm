# Classic Duels コードレビュー (v3)

> レビュー日: 2026-03-02  
> 対象: リポジトリ全体（20 ファイル、約 3,800 行）  
> 前回比の差分: ババ抜き実装、`room.ts` の即時終了対応、ヘルプ画面ババ抜き未追記

---

## v2 で指摘した項目の確認

v1 の 21 件は全て修正済（前回確認済み）。v2 の新規指摘 (N-1〜N-5, n-1〜n-6) のうち引き続き未対応の項目は下記のとおり。

| v2 ID | タイトル | 状態 |
|---|---|---|
| N-1 | Rate limiter `deleteAll()` | ⚠️ 未対応（実害低） |
| N-2 | `handleSocketClose` エラーハンドリング | ⚠️ 未対応 |
| N-4 | ゲーム詳細→ルーム直接作成 | ⚠️ 未対応 |
| N-5 | WS 再接続リトライ上限 | ⚠️ 未対応 |
| n-1 | `router.ts` の `gameId` unsafe cast | ⚠️ 未対応 |
| n-2 | `janken-actions` の columns 定義漏れ | ⚠️ 未対応 |
| n-3 | `rematchVotes` UI 未使用 | ⚠️ 未対応 |
| n-6 | `README.md` 構成未更新 | ⚠️ 一部更新（ババ抜き追記あり、worker 分割の記述なし） |

---

## 新規レビュー結果

### 🔴 Critical

なし。

### 🟠 Major

#### M-NEW-1. ババ抜きで相手の手札が 0 枚かつ自分がジョーカーのみの場合にゲーム終了しない

- **ファイル**: `worker/games.ts` L623-631
- `resolveOldMaidWinner` は _片方の手札が 0 かつ他方が 1 以上_ の場合のみ勝者を判定する。しかし**両方とも 0 枚**になるケースが論理的に存在する（配札時にペア除去で全カードが消える可能性）。
- 53 枚（偶数ではない）のデッキなので数学的には片方の手札が残るはずだが、実装上 `resolveOldMaidWinner` が `null` を返すとゲームが永続的に `playing` 状態になりハングする。
- **修正案**: `both === 0` のケースを「引き分け」として `finished` に遷移させる。

```typescript
if (state.hands[0].length === 0 && state.hands[1].length === 0) {
  // 引き分け（通常発生しないが安全弁）
  return -1; // or handle as draw
}
```

#### M-NEW-2. ババ抜きの `collapsePairs` がカード文字列の一致に依存しており同一ランクが 3 枚以上のとき不安定

- **ファイル**: `worker/games.ts` L592-621
- 各ランクの `pairCount = Math.floor(cards.length / 2)` を算出し、`pairCount * 2` 枚を `toRemove` に追加する。これ自体は正しい。
  ただしペアを消した直後にさらにカードを引いて同ランクが 3 枚になった場合、`collapsePairs` は 1 ペアのみ消す（3 枚目は残る）。この動作は正しいが、**同じカードの識別に文字列 (`"AS"`, `"AH"` 等) を使っているため `toRemove` の `Set` は正しく動作する**。
- ✅ 問題なし — ロジック確認済み。

#### M-NEW-3. ババ抜きの `opponentCardCount` と `targetableOpponentSlots` がシャッフルされていない

- **ファイル**: `worker/games.ts` L307-318
- `targetableOpponentSlots` は `opponentHand.map((_, index) => index)` で生成される。相手の手札の _配列上の位置_ がそのままスロット番号として送信されるため、**連続する引き操作でカードの並び順が推測可能**になる。  
  例: 前のターンでインデックス 3 を引いた後、自分のターンが回ってきたとき相手の手札配列は `splice` で 1 要素減っている。元のインデックス 4 以降がすべてシフトするので、繰り返し引く側は「前回引いた付近のカードがどれか」を推測しやすくなる。
- **修正案**: `buildOldMaidView` で相手の手札をシャッフルしたインデックス配列を返す（または毎ターン相手の手札配列自体をシャッフルする）。

#### M-NEW-4. `handleSocketClose` の `async` コールバックが catch されない（v2 N-2 継続）

- **ファイル**: `worker/room.ts` L320-322
- `server.addEventListener("close", async () => { await this.handleSocketClose(...) })` — reject が catch されずランタイム警告が出る。

```diff
-    server.addEventListener("close", async () => {
-      await this.handleSocketClose(sessionId, server);
+    server.addEventListener("close", () => {
+      this.handleSocketClose(sessionId, server).catch(() => {});
     });
```

#### M-NEW-5. ヘルプ画面にババ抜きのルール説明がない

- **ファイル**: `src/App.tsx` L471-476
- ヘルプ画面には 4 ゲームのルールが記載されているが、新たに active になった「ババ抜き」の説明がない。

---

### 🟡 Minor

#### m-NEW-1. `buildOldMaidView` で `selfSeat` が `null` 判定直後に `selfSeat ?? 0` を使用

- **ファイル**: `worker/games.ts` L290-305

```typescript
if (selfSeat === null) {
  return { ... };  // selfSeat === null のケースはここで return
}

const seat = selfSeat ?? 0;  // ← ここは常に selfSeat !== null
```

- `?? 0` は不要（到達時点で `selfSeat` は必ず非 null）。デッドコード的で紛らわしい。

#### m-NEW-2. `GameSurface.tsx` のババ抜きカード key に配列 index を使用

- **ファイル**: `src/components/GameSurface.tsx` L103

```tsx
key={`${card}-${index}`}
```

- `card` は `"AS"` のようなユニーク文字列なのでそれだけで十分。ソート済みなので index との組み合わせは不要。ただし同じカードが手札に 2 枚存在しないため実害なし。
- ✅ 問題なし。

#### m-NEW-3. `old-maid` の `supportsBots: true` だが bot ロジック未実装

- **ファイル**: `src/shared/games.ts` L65
- カタログで `supportsBots: true` になっているが、bot の行動ロジックは未実装。`fillWithBots: true` のデフォルト設定と組み合わさると、将来 3 人以上対応時に bot 席が作られるが動かない。
- 現時点では 2 人専用なので実害なし。`PROGRESS.md` にも「ババ抜き bot 対応」は未完了と記載されているので意図的と思われる。

#### m-NEW-4. `createRoomRequest` に `sessionId` をオプショナルで送れるが Client 側で送っていない

- **ファイル**: `src/shared/types.ts` L145, `src/App.tsx` L74-77
- `CreateRoomRequest.sessionId?` は定義されているが、`LandingPage.createRoom` では送っていない。`router.ts` L28 で `body.sessionId ?? crypto.randomUUID()` によりサーバー側で生成される。
- 一貫性の問題はないが、使わないオプショナルフィールドを型に残すより明示的にサーバー生成のみにする方が型定義が明確になる。

#### m-NEW-5. `janken-actions` に CSS `grid-template-columns` が未指定

- **ファイル**: `src/styles.css` L365-369
- `.janken-actions` と `.connect4-dropbar` は `display: grid` だが `grid-template-columns` がない。`connect4-dropbar` は inline style で設定されるが、`janken-actions` は 3 ボタンが 1 列に並ぶ。
- `grid-template-columns: repeat(3, minmax(0, 1fr))` を追加すると 3 ボタン横並びになり UX 向上。

#### m-NEW-6. `README.md` に worker 分割の記述がまだない

- **ファイル**: `README.md` L28-29
- 「`worker/index.ts` — API ルーティングと Durable Object 実装」とあるが、実際には `router.ts`, `room.ts`, `games.ts`, `rate-limit.ts` 等に分割済。

---

## ✅ 良い点

- **`getRoomStatusFromState` の追加**: ババ抜きは配札直後にペアが全消えすると即 `finished` になり得る。この edge case を `maybeStartRoom` と `handleRematch` で正しく処理している。
- **ババ抜き view のプライバシー**: 相手のカードは枚数とスロット番号のみ返し、内容は一切見えない設計。
- **`collapsePairs` のペア除去アルゴリズム**: `Map` でランク → カード配列を構築し、`Math.floor(length / 2)` で正確にペア数を算出。`Set` + `filter` で in-place 除去も正確。
- **カード表示の絵文字変換**: `formatCard`, `cardClass` が正しくスート → Unicode 記号変換を行い、赤黒の色分けも CSS で適切に処理。
- **即時終了のアラーム処理**: 配札直後に終了する場合も `cleanup` アラームが正しくセットされる。

---

## 推奨アクション（優先度順）

1. **M-NEW-4** — `handleSocketClose` のエラーキャッチを追加（1 行修正）
2. **M-NEW-3** — 相手の手札スロットをシャッフルして位置推測を防止
3. **M-NEW-5** — ヘルプ画面にババ抜きルールを追記
4. **M-NEW-1** — 両手札 0 の安全弁を追加
5. **m-NEW-5** — `janken-actions` に `grid-template-columns` を追加
6. **m-NEW-1** — `selfSeat ?? 0` の不要な fallback を削除
7. **m-NEW-6** — `README.md` の worker 構成を更新

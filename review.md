# Classic Duels コードレビュー (v5)

> レビュー日: 2026-03-02  
> 対象: リポジトリ全体（20 ファイル、約 4,600 行）  
> 前回比の主要変更: v4 指摘修正 + WebSocket origin 検証 + localStorage 安全ラッパー

---

## v4 指摘の対応状況

| v4 ID | タイトル | 状態 |
|---|---|---|
| M-V4-1 | `advanceAutomatedTurns` の while 上限 | ✅ `MAX_BOT_ITERATIONS = 100` 追加 (games.ts:22,574-583) |
| M-V4-3 | `fillWithBots` に boolean 型チェック | ✅ `typeof settings?.fillWithBots === "boolean"` 追加 (games.ts:137-138) |
| m-V4-3 | `shuffle` ジェネリック化 | ✅ `shuffle<T>(items: readonly T[]): T[]` に変更 (games.ts:707) |
| m-V4-4 | `getDefaultRoomSettings` guard 追加 | ✅ `GAME_MAP[gameId] as ... \| undefined` + fallback 追加 (games.ts:117-124) |
| m-V4-5 | `LandingPage` 表示名の事前検証 | ✅ ネットワーク前に `playerName.trim().length < 2` チェック復活 (App.tsx:69-72) |
| m-V4-6 | rate limiter alarm の動的キー削除 | ✅ `storage.list({ prefix: BUCKET_PREFIX })` で全バケット走査、期限切れ分のみ削除 (rate-limit.ts:52-71) |

**全 6 件修正済み** 🎉

---

## v4 対応以外の新規改善（ユーザー独自追加）

以下は v4 レビューで指摘していなかったが、ユーザーが独自に追加した改善。

### WebSocket origin 検証
- **ファイル**: `worker/router.ts` L64-69, L100-116
- WebSocket 接続時に `Upgrade: websocket` ヘッダーの確認と、`isAllowedWebSocketOrigin` で origin ≠ host の場合を拒否。CSRF 的な攻撃を防ぐ。
- ✅ 良い追加。

### エラーログ出力
- **ファイル**: `worker/http.ts` L34
- `toErrorResponse` に `console.error("Unexpected worker error", error)` を追加。Cloudflare のログに予期しないエラーが記録される。
- ✅ 運用に有益。

### localStorage 安全ラッパー
- **ファイル**: `src/App.tsx` L626-648
- `readStorage` / `writeStorage` / `removeStorage` で try/catch ラップ。プライベートブラウジングや localStorage 無効環境での crash を防止。
- ✅ 良い追加。

---

## 新規レビュー結果

### 🔴 Critical

なし。

### 🟠 Major

なし。

### 🟡 Minor

#### m-V5-1. `isAllowedWebSocketOrigin` で origin 無しを許可

- **ファイル**: `worker/router.ts` L102-104
```typescript
if (!origin) {
  return true;
}
```
- `Origin` ヘッダーがない場合は `true` を返す。ブラウザの WebSocket は origin を付与するが、CLI ツール等では付与しない。これはリスク許容の設計判断として妥当だが、認識しておくべき。

#### m-V5-2. `normalizeRoomSettings` 内で `game` が undefined の場合の guard がない

- **ファイル**: `src/shared/games.ts` L131-144
- `getDefaultRoomSettings` には `GAME_MAP[gameId] as ... | undefined` ガードがあるが、`normalizeRoomSettings` にはない。`GAME_MAP[gameId]` の結果を直接 `.defaultSeats` / `.maxSeats` 等で参照している。
- サーバー側 `router.ts` で `GAME_MAP[body.gameId]` チェック (L20-21) が先行するため到達しないが、防御コーディング上は揃えるのが望ましい。

#### m-V5-3. `serveApp` の `isAssetRequest` 正規表現がクエリパラメータ付きパスにマッチしない

- **ファイル**: `worker/http.ts` L20
```typescript
const isAssetRequest = /\.[a-zA-Z0-9]+$/.test(url.pathname);
```
- `url.pathname` はクエリパラメータを含まないので `$` での終端マッチは正しい。✅ 問題なし。

---

## ✅ 全体評価

コードベースは v1 の初期レビュー以降、**5 ラウンドのレビューを通じて段階的に成熟**しており、現在は非常に高い品質に達しています。

**特筆すべき点**:

- **型安全性**: `isGameId` type guard、`normalizeRoomSettings` のクランプ、`resolveOldMaidWinner` のタグ付きユニオン戻り値
- **防御的設計**: `MAX_BOT_ITERATIONS`、localStorage try/catch、`closeRoom`/`sendSnapshot` の try/catch、WebSocket origin 検証
- **ゲームロジックの正確性**: じゃんけん N 人対応（3 すくみ判定）、ババ抜き N 人対応（反時計回りドロー、スキップ処理、即時終了ハンドリング）
- **リアルタイム通信**: WS 再接続に exponential backoff + 上限 6 回、切断時の不戦勝タイマー、reconnect 時のゲーム再開処理
- **コード構造**: Worker ファイルの適切な分割（router / room / games / rate-limit / errors / http / utils / types）

**残存指摘は Minor 2 件のみ**（m-V5-1 は意図的な設計判断、m-V5-2 は到達しないコードパスの防御）。実用上のバグや脆弱性は確認されませんでした。

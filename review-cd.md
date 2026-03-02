# Classic Duels コードレビュー

## 概要

Classic Duels は Cloudflare Workers + Durable Objects で構築されたオンライン対戦ゲームプラットフォームです。オセロ、五目並べ、四目並べ、じゃんけん、ババ抜きが実装されています。

---

## 全体構成

### アーキテクチャ

```
├── worker/          # Cloudflare Workers (バックエンド)
│   ├── index.ts     # エントリーポイント
│   ├── router.ts    # HTTP ルーティング
│   ├── room.ts      # RoomDurableObject (ゲーム状態管理)
│   ├── games.ts     # ゲームロジック実装
│   ├── types.ts     # サーバー側型定義
│   ├── errors.ts    # エラー処理
│   ├── http.ts      # HTTP ユーティリティ
│   ├── utils.ts     # 共通ユーティリティ
│   └── rate-limit.ts # レート制限
│
└── src/             # React フロントエンド
    ├── main.tsx     # エントリーポイント
    ├── App.tsx      # メインアプリケーション
    ├── router.ts    # クライアントサイドルーティング
    ├── shared/      # バックエンドと共有
    │   ├── types.ts # 共通型定義
    │   └── games.ts # ゲームカタログ
    └── components/  # UI コンポーネント
        ├── GameCard.tsx
        └── GameSurface.tsx
```

**評価**: 良好な関心分離。Durable Objects を使用したリアルタイムアーキテクチャが適切です。

---

## 1. セキュリティ

### 良い点

- **入力サニタイゼーション**: [utils.ts:7-23](worker/utils.ts#L7-L23) でプレイヤー名のバリデーションを実装
  - 制御文字の除去
  - 最小長チェック（2文字以上）
  - 管理者権限を連想する名前のブロック

- **レート制限**: [rate-limit.ts:57-75](worker/rate-limit.ts#L57-L75) でルーム作成回数を制限（1分間8回）

- **セッション管理**: UUID ベースのセッションIDで追跡

### 改善提案

1. **CSRF 保護**: WebSocket upgrade 時のオリジン検証がない
   ```typescript
   // worker/room.ts:301 で推奨
   const origin = request.headers.get("Origin");
   if (origin && !ALLOWED_ORIGINS.includes(origin)) {
     return new Response("Invalid origin", { status: 403 });
   }
   ```

2. **CORS 設定**: 現在の実装では明示的なCORSヘッダーがない

3. **WebSocket メッセージ検証**: [room.ts:316-320](worker/room.ts#L316-L320) で `"ping"` のみチェックしているが、不正メッセージへの耐性が弱い

---

## 2. エラー処理

### 良い点

- **統一されたエラー型**: [errors.ts:1-17](worker/errors.ts#L1-L17) で `AppError` クラスを定義
- **エラー変換**: [http.ts:30-38](worker/http.ts#L30-L38) で例外をHTTPレスポンスに変換
- **アサーション関数**: [errors.ts:12-16](worker/errors.ts#L12-L16) で型ガード付きアサーション

### 改善提案

1. **エラーロギング**: エラー発生時のログ出力がない
   ```typescript
   // worker/http.ts で推奨
   export function toErrorResponse(error: unknown): Response {
     if (!(error instanceof AppError)) {
       console.error("Unexpected error:", error);
     }
     // ...
   }
   ```

2. **クライアント側エラー**: [App.tsx:569-571](src/App.tsx#L569-L571) で汎用的なエラーメッセージのみ

---

## 3. 型安全性

### 良い点

- **共有型定義**: [shared/types.ts](src/shared/types.ts) でフロントエンドとバックエンドで型を共有
- **厳格な型ガード**: [router.ts:41-43](src/router.ts#L41-L43) で `isGameId` 型ガード
- **ディスクリミネートユニオン**: `GameView` 型で各ゲーム状態を型安全に処理

### 問題点

1. **any 使用なし**: 良好

2. **型アサーション**: [room.ts:375](worker/room.ts#L375) で型アサーションを使用
   ```typescript
   const winnerSeats = resolveJanken(state.selections as JankenChoice[]);
   ```
   このアサーションは直前のチェックで安全保証されているため妥当。

---

## 4. コードの品質

### 良い点

- **一貫性のある命名**: 日本語のコメントと英語の変数名が分離されている
- **関数の単一責任**: 各関数が明確な役割を持っている
- **DRY 原則**: [games.ts](worker/games.ts) でボードゲーム共通ロジックをうまく抽象化

### 改善提案

1. **magic number**: [games.ts:844](worker/games.ts#L844) などで `4` という数字が直接使われている
   ```typescript
   // 定数として定義を推奨
   const CONNECT4_WIN_LENGTH = 4;
   const GOMOKU_WIN_LENGTH = 5;
   ```

2. **長い関数**: [room.ts:481-521](worker/room.ts#L481-L521) の `maybeStartRoom` 関数が40行以上

3. **重複コード**: [games.ts:695-704](worker/games.ts#L695-L704) の `shuffle` と [games.ts:314](worker/games.ts#L314) で同様のロジック

---

## 5. パフォーマンス

### 良い点

- **WebSocket 接続プール**: [room.ts:372-387](worker/room.ts#L372-L387) で同一セッションの複数接続を管理
- **アルゴリズム**: オセロの合法手取得が効率的

### 改善提案

1. **不要な再レンダリング**: [App.tsx](src/App.tsx) で `useMemo` / `useCallback` の使用が少ない
   ```typescript
   // App.tsx:68 で推奨
   const createRoom = useCallback(async (gameId: GameId) => {
     // ...
   }, [playerName, navigate]);
   ```

2. **ボードコピー**: [games.ts:830-840](worker/games.ts#L830-L840) で毎回配列を生成している

---

## 6. テスト可能性

### 問題点

- **テストファイルなし**: プロジェクトにテストが存在しない
- **密結合**: ゲームロジックが RoomRecord に密接に依存

### 改善提案

1. **ゲームロジックの分離**: 純粋関数としてテスト可能にする
2. **モック可能な依存関係**: crypto.randomUUID の依存を注入可能にする

---

## 7. 具体的なバグ/問題

### 1. レート制限のバグ

[rate-limit.ts:52-54](worker/rate-limit.ts#L52-L54):
```typescript
async alarm(): Promise<void> {
  await this.state.storage.delete(ROOM_CREATE_BUCKET_KEY);
}
```

ここで固定キーを削除しているが、実際には `bucket:${key}` 形式のキーを削除すべきです。

### 2. タイムアウト処理

[App.tsx:226-242](src/App.tsx#L226-L242) で WebSocket 再接続時の指数バックオフ実装があるが、最大遅延が10秒に固定されている

### 3. ルーム状態の競合

[room.ts:332-370](worker/room.ts#L332-L370) で `handleSocketClose` がストレージから最新状態を取得しているが、その間に他の操作が入ると競合が発生する可能性

---

## 8. ドキュメンテーション

### 良い点

- [README.md](README.md) でプロジェクト概要を説明
- [SPEC.md](SPEC.md) で仕様を文書化
- コメントが日本語で書かれており読みやすい

### 改善提案

- API エンドポイントのドキュメント
- 各関数の JSDoc コメント

---

## 9. ベストプラクティス違反

### 1. console.log の残存

デバッグ用の console.log が残っている可能性

### 2. エラーハンドリングの一貫性

[App.tsx:221-223](src/App.tsx#L221-L223) でエラーを無視している:
```typescript
} catch {
  setError("リアルタイム同期メッセージの解析に失敗しました。");
}
```

### 3. ローカルストレージのエラーハンドリング

`localStorage.getItem` / `setItem` がプライベートブラウジングモード等で失敗する可能性を考慮していない

---

## 10. 全体的な評価

| 項目 | 評価 |
|------|------|
| アーキテクチャ | ★★★★☆ |
| セキュリティ | ★★★☆☆ |
| 型安全性 | ★★★★★ |
| コード品質 | ★★★★☆ |
| パフォーマンス | ★★★★☆ |
| テスト可能性 | ★★☆☆☆ |
| ドキュメント | ★★★☆☆ |

### 総評

Cloudflare Workers と Durable Objects を活用した良質なリアルタイムゲームプラットフォームです。型安全性とコードの品質は高く、ゲームロジックも適切に実装されています。

主な改善点は：
1. テストの追加
2. エラーハンドリングの強化
3. セキュリティ対策（CORS、CSRF）
4. パフォーマンス最適化（React memo化）

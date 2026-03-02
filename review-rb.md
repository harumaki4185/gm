# CodeRabbit レビュー結果

## レビューサマリー

```
Review completed: 1 finding ✔
```

---

## 検出された問題

### src/components/games/WaitingSurface.tsx:67-74

**タイプ**: potential_issue

**問題**: オプション生成ロジックで `view.joinedHumans > view.maxSeats` の場合に空配列が生成される可能性があります。

#### 問題箇所

```typescript
// WaitingSurface.tsx:67-74 (現在のコード)
{Array.from({ length: view.maxSeats - Math.max(view.minSeats, view.joinedHumans) + 1 }, (_, index) => {
  const value = Math.max(view.minSeats, view.joinedHumans) + index;
  return (
    <option key={value} value={value}>
      {value} 人
    </option>
  );
})}
```

#### 問題の詳細

- `view.joinedHumans > view.maxSeats` の場合、`length` が負の値または 0 になる
- これにより空のオプション配列が生成される
- ユーザーが席数を選択できなくなる

#### 修正提案

```typescript
// 修正案
const start = Math.min(view.maxSeats, Math.max(view.minSeats, view.joinedHumans));
const count = Math.max(0, view.maxSeats - start + 1);

{count > 0 ? (
  Array.from({ length: count }, (_, index) => {
    const value = start + index;
    return (
      <option key={value} value={value}>
        {value} 人
      </option>
    );
  })
) : (
  <option value={view.maxSeats}>{view.maxSeats} 人</option>
)}
```

または、より簡潔に:

```typescript
{Array.from({ length: Math.max(0, view.maxSeats - Math.max(view.minSeats, view.joinedHumans) + 1) }, (_, index) => {
  const value = Math.min(view.maxSeats, Math.max(view.minSeats, view.joinedHumans)) + index;
  return (
    <option key={value} value={value}>
      {value} 人
    </option>
  );
})}
```

#### 影響範囲

- 席数が可変なゲーム（じゃんけん、ババ抜き、七並べ）で発生する可能性
- 特に人間プレイヤーが最大席数を超えて参加した場合に問題になる

---

## 推奨アクション

1. **上**: オプション生成ロジックに `Math.max(0, ...)` を追加して負の length を防ぐ
2. **中**: バリデーションを追加して `joinedHumans` が `maxSeats` を超えないようにする
3. **下**: サーバー側で `joinedHumans > maxSeats` の状態を防ぐ

---

## その他のファイル

レビューされた他のファイルには問題は見つかりませんでした。

- [src/App.tsx](src/App.tsx) - 問題なし
- [src/components/games/WaitingSurface.tsx](src/components/games/WaitingSurface.tsx) - 1件の指摘

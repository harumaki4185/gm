import type { WaitingView } from "../../shared/types";

export function WaitingSurface({ view }: { view: WaitingView }) {
  return (
    <section className="surface-card">
      <h2>対戦待機中</h2>
      <p>{view.message}</p>
      <div className="waiting-stats">
        <div>
          <span>人間プレイヤー</span>
          <strong>
            {view.connectedHumans} / {view.requiredHumans}
          </strong>
        </div>
        <div>
          <span>総席数</span>
          <strong>{view.totalSeats}</strong>
        </div>
        <div>
          <span>bot 補充</span>
          <strong>{view.supportsBots ? "対応" : "なし"}</strong>
        </div>
      </div>
    </section>
  );
}

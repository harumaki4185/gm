import { formatCardLabel, isRedCard } from "../../shared/cards";
import type { ClientAction, OldMaidView } from "../../shared/types";

interface OldMaidSurfaceProps {
  view: OldMaidView;
  onAction: (action: ClientAction) => void;
}

export function OldMaidSurface({ view, onAction }: OldMaidSurfaceProps) {
  return (
    <section className="surface-card">
      <h2>ババ抜き</h2>
      <p className="surface-status">{view.statusMessage}</p>
      {view.lastAction ? <p className="surface-status">{view.lastAction}</p> : null}
      <div className="old-maid-layout">
        <div className="old-maid-opponents">
          {view.opponents.map((opponent) => (
            <div
              className={`old-maid-panel ${opponent.isCurrentTarget ? "old-maid-panel--target" : ""}`}
              key={opponent.seat}
            >
              <div className="old-maid-panel__meta">
                <span>{opponent.name}</span>
                <strong>{opponent.cardCount} 枚</strong>
              </div>
              {opponent.hasFinished ? <p className="surface-status">あがり</p> : null}
              {opponent.isCurrentTarget ? <p className="surface-status">この相手から 1 枚引きます</p> : null}
              <div className="old-maid-targets">
                {opponent.targetableSlots.map((slot) => (
                  <button
                    className="old-maid-card old-maid-card--hidden"
                    disabled={!view.canAct}
                    key={slot}
                    onClick={() => onAction({ type: "draw_old_maid", targetIndex: slot })}
                  >
                    ?
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
        <div className="old-maid-panel">
          <span>自分の手札</span>
          <strong>{view.selfHand.length} 枚</strong>
          <div className="old-maid-hand">
            {view.selfHand.map((card) => (
              <div className={cardClass(card)} key={card}>
                {formatCardLabel(card)}
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

function cardClass(card: string): string {
  if (card === "JOKER") {
    return "old-maid-card old-maid-card--joker";
  }
  const red = isRedCard(card);
  return `old-maid-card ${red ? "old-maid-card--red" : "old-maid-card--black"}`;
}

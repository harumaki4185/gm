import { formatCardLabel } from "../../shared/cards";
import type { ClientAction, SevensView } from "../../shared/types";
import { getPlayingCardClass } from "./cardUi";

const SEVENS_RANKS = ["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"];
const SUIT_LABELS: Record<SevensView["suits"][number]["suit"], string> = {
  S: "♠",
  H: "♥",
  D: "♦",
  C: "♣"
};

interface SevensSurfaceProps {
  view: SevensView;
  onAction: (action: ClientAction) => void;
  isSpectator: boolean;
}

export function SevensSurface({ view, onAction, isSpectator }: SevensSurfaceProps) {
  return (
    <section className="surface-card">
      <h2>七並べ</h2>
      <p className="surface-status">{view.statusMessage}</p>
      {view.lastAction ? <p className="surface-status">{view.lastAction}</p> : null}

      <div className="sevens-player-grid">
        {view.players.map((player) => (
          <div
            className={`sevens-player ${player.isCurrent ? "sevens-player--current" : ""} ${
              player.isWinner ? "sevens-player--winner" : ""
            }`}
            key={player.seat}
          >
            <strong>{player.name}</strong>
            {player.placement !== null ? <span>{player.placement} 位</span> : null}
            <span>{player.cardCount} 枚</span>
            <span>パス {player.passCount}</span>
          </div>
        ))}
      </div>

      <div className="sevens-table">
        {view.suits.map((suit) => (
          <div className="sevens-row" key={suit.suit}>
            <div className={`sevens-row__suit ${suit.suit === "H" || suit.suit === "D" ? "sevens-row__suit--red" : ""}`}>
              {SUIT_LABELS[suit.suit]}
            </div>
            <div className="sevens-row__cards">
              {SEVENS_RANKS.map((rankLabel, index) => {
                const rank = index + 1;
                const placed = rank >= suit.low && rank <= suit.high;
                return (
                  <div className={`sevens-slot ${placed ? "sevens-slot--placed" : ""}`} key={`${suit.suit}-${rank}`}>
                    {placed ? rankLabel : ""}
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      <div className="card-hand-panel">
        <div className="card-hand-panel__meta">
          <span>{isSpectator ? "観戦中" : "自分の手札"}</span>
          <strong>{isSpectator ? "Hidden" : `${view.selfHand.length} 枚`}</strong>
        </div>
        {isSpectator ? (
          <p className="surface-status">非公開の手札情報は表示されません。</p>
        ) : (
          <>
            <div className="sevens-hand">
              {view.selfHand.map((card) => {
                const legal = view.legalCards.includes(card);
                return (
                  <button
                    className={getPlayingCardClass(card)}
                    disabled={!view.canAct || !legal}
                    key={card}
                    onClick={() => onAction({ type: "play_card", card })}
                    title={legal ? "このカードを出す" : "まだ出せません"}
                  >
                    {formatCardLabel(card)}
                  </button>
                );
              })}
            </div>
            <button
              className="ghost-button"
              disabled={!view.canAct || view.legalCards.length > 0}
              onClick={() => onAction({ type: "pass_sevens" })}
            >
              パス
            </button>
          </>
        )}
      </div>
    </section>
  );
}

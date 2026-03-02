import { formatCardLabel, isRedCard } from "../../shared/cards";
import type { ClientAction, SpadesView } from "../../shared/types";

interface SpadesSurfaceProps {
  view: SpadesView;
  onAction: (action: ClientAction) => void;
}

export function SpadesSurface({ view, onAction }: SpadesSurfaceProps) {
  return (
    <section className="surface-card">
      <h2>スペード</h2>
      <p className="surface-status">{view.statusMessage}</p>
      {view.lastAction ? <p className="surface-status">{view.lastAction}</p> : null}

      <div className="spades-team-grid">
        {view.teams.map((team) => (
          <div className={`spades-team ${view.winnerSeats.some((seat) => team.members.includes(seat)) ? "spades-team--winner" : ""}`} key={team.team}>
            <strong>チーム {team.team + 1}</strong>
            <span>席: {team.members.map((seat) => seat + 1).join(" / ")}</span>
            <span>ビッド: {team.bid}</span>
            <span>獲得: {team.tricksWon}</span>
            <span>スコア: {team.score}</span>
          </div>
        ))}
      </div>

      <div className="sevens-player-grid">
        {view.players.map((player) => (
          <div className={`sevens-player ${player.isCurrent ? "sevens-player--current" : ""}`} key={player.seat}>
            <strong>{player.name}</strong>
            <span>Team {player.team === null ? "-" : player.team + 1}</span>
            <span>Bid {player.bid ?? "-"}</span>
            <span>Trick {player.tricksWon}</span>
            <span>{player.cardCount} 枚</span>
          </div>
        ))}
      </div>

      <div className="spades-trick">
        {view.currentTrick.map((entry) => (
          <div className="spades-trick__slot" key={entry.seat}>
            <span>席 {entry.seat + 1}</span>
            <strong className={entry.card ? playingCardClass(entry.card) : "spades-trick__empty"}>
              {entry.card ? formatCardLabel(entry.card) : "..." }
            </strong>
          </div>
        ))}
      </div>

      <div className="old-maid-panel">
        <div className="old-maid-panel__meta">
          <span>自分の手札</span>
          <strong>{view.selfHand.length} 枚</strong>
        </div>
        <p className="surface-status">
          完了トリック {view.completedTricks} / 13 {view.spadesBroken ? " / スペード解禁済み" : ""}
        </p>

        {view.stage === "bidding" ? (
          <div className="spades-bids">
            {view.bidOptions.map((bid) => (
              <button
                className="action-button"
                disabled={!view.canBid}
                key={bid}
                onClick={() => onAction({ type: "bid_spades", bid })}
              >
                {bid}
              </button>
            ))}
          </div>
        ) : (
          <div className="sevens-hand">
            {view.selfHand.map((card) => {
              const legal = view.legalCards.includes(card);
              return (
                <button
                  className={playingCardClass(card)}
                  disabled={!view.canPlay || !legal}
                  key={card}
                  onClick={() => onAction({ type: "play_card", card })}
                  title={legal ? "このカードを出す" : "出せません"}
                >
                  {formatCardLabel(card)}
                </button>
              );
            })}
          </div>
        )}
      </div>
    </section>
  );
}

function playingCardClass(card: string): string {
  return `playing-card ${isRedCard(card) ? "playing-card--red" : "playing-card--black"}`;
}

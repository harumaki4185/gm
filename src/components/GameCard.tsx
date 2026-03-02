import type { CSSProperties } from "react";
import type { GameCatalogEntry } from "../shared/types";

interface GameCardProps {
  game: GameCatalogEntry;
  busy: boolean;
  onCreate: (gameId: GameCatalogEntry["id"]) => void;
  onOpenDetails: (gameId: GameCatalogEntry["id"]) => void;
}

export function GameCard({ game, busy, onCreate, onOpenDetails }: GameCardProps) {
  return (
    <article className="game-card" style={{ "--accent": game.accent } as CSSProperties}>
      <div className="game-card__header">
        <span className={`game-card__badge game-card__badge--${game.availability}`}>
          {game.availability === "active" ? "Play" : "Planned"}
        </span>
        <span className="game-card__category">{game.category}</span>
      </div>
      <h3>{game.title}</h3>
      <p className="game-card__lead">{game.shortDescription}</p>
      <p className="game-card__description">{game.description}</p>
      <dl className="game-card__meta">
        <div>
          <dt>人数</dt>
          <dd>{formatSeatRange(game)}</dd>
        </div>
        <div>
          <dt>人間必要数</dt>
          <dd>{game.minHumanPlayers} 人</dd>
        </div>
        <div>
          <dt>bot</dt>
          <dd>{game.supportsBots ? "対応" : "不要"}</dd>
        </div>
      </dl>
      <div className="game-card__actions">
        <button className="ghost-button" onClick={() => onOpenDetails(game.id)}>
          詳細
        </button>
        <button
          className="primary-button"
          disabled={busy || game.availability !== "active"}
          onClick={() => onCreate(game.id)}
        >
          {game.availability === "active" ? "ルームを作成" : "実装待ち"}
        </button>
      </div>
    </article>
  );
}

function formatSeatRange(game: GameCatalogEntry): string {
  if (game.minSeats === game.maxSeats) {
    return `${game.maxSeats} 人`;
  }
  return `${game.minSeats}-${game.maxSeats} 人`;
}

import { GAME_MAP } from "../shared/games";
import type { BoardPosition, ClientAction, RoomSnapshot } from "../shared/types";

interface GameSurfaceProps {
  snapshot: RoomSnapshot;
  onAction: (action: ClientAction) => void;
}

export function GameSurface({ snapshot, onAction }: GameSurfaceProps) {
  const view = snapshot.gameView;

  if (view.kind === "waiting") {
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

  if (view.kind === "planned") {
    return (
      <section className="surface-card">
        <h2>{view.title}</h2>
        <p>{view.message}</p>
      </section>
    );
  }

  if (view.kind === "janken") {
    return (
      <section className="surface-card">
        <h2>じゃんけん</h2>
        <p className="surface-status">{view.resultMessage ?? "手を選んでください"}</p>
        <div className="janken-slots">
          {snapshot.players.map((player, index) => (
            <div className="janken-slot" key={player.id}>
              <span>{player.name}</span>
              <strong>{formatJankenSelection(view.selections[index])}</strong>
            </div>
          ))}
        </div>
        <div className="janken-actions">
          {view.choices.map((choice) => (
            <button
              className="action-button"
              disabled={!view.canAct}
              key={choice}
              onClick={() => onAction({ type: "choose_rps", choice })}
            >
              {formatChoice(choice)}
            </button>
          ))}
        </div>
      </section>
    );
  }

  if (view.kind === "old-maid") {
    return (
      <section className="surface-card">
        <h2>ババ抜き</h2>
        <p className="surface-status">{view.statusMessage}</p>
        {view.lastAction ? <p className="surface-status">{view.lastAction}</p> : null}
        <div className="old-maid-layout">
          <div className="old-maid-panel">
            <span>相手の手札</span>
            <strong>{view.opponentCardCount} 枚</strong>
            <div className="old-maid-targets">
              {view.targetableOpponentSlots.map((slot) => (
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
          <div className="old-maid-panel">
            <span>自分の手札</span>
            <strong>{view.selfHand.length} 枚</strong>
            <div className="old-maid-hand">
              {view.selfHand.map((card) => (
                <div className={cardClass(card)} key={card}>
                  {formatCard(card)}
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>
    );
  }

  if (view.kind === "connect4") {
    return (
      <section className="surface-card">
        <h2>四目並べ</h2>
        <p className="surface-status">{view.statusMessage}</p>
        <div
          className="connect4-dropbar"
          style={{ gridTemplateColumns: `repeat(${view.cols}, minmax(0, 1fr))` }}
        >
          {Array.from({ length: view.cols }, (_, col) => (
            <button
              className="drop-button"
              disabled={!view.canAct || !view.legalColumns.includes(col)}
              key={col}
              onClick={() => onAction({ type: "drop_disc", col })}
            >
              ↓
            </button>
          ))}
        </div>
        <div
          className="board board--connect4"
          style={{ gridTemplateColumns: `repeat(${view.cols}, minmax(0, 1fr))` }}
        >
          {view.board.flatMap((row, rowIndex) =>
            row.map((cell, colIndex) => (
              <div
                className={`board-cell board-cell--disc ${cellClass(cell)} ${
                  isHighlighted(view.winningLine, rowIndex, colIndex) ? "board-cell--win" : ""
                }`}
                key={`${rowIndex}-${colIndex}`}
              >
                <span />
              </div>
            ))
          )}
        </div>
      </section>
    );
  }

  return (
    <section className="surface-card">
      <h2>{GAME_MAP[snapshot.gameId].title}</h2>
      <p className="surface-status">{view.statusMessage}</p>
      <div
        className={`board board--${view.kind}`}
        style={{ gridTemplateColumns: `repeat(${view.cols}, minmax(0, 1fr))` }}
      >
        {view.board.flatMap((row, rowIndex) =>
          row.map((cell, colIndex) => {
            const legal = isHighlighted(view.legalMoves, rowIndex, colIndex);
            return (
              <button
                className={`board-cell board-cell--piece ${cellClass(cell)} ${
                  legal ? "board-cell--legal" : ""
                } ${isHighlighted(view.winningLine, rowIndex, colIndex) ? "board-cell--win" : ""}`}
                disabled={!view.canAct || !legal}
                key={`${rowIndex}-${colIndex}`}
                onClick={() => onAction({ type: "place_piece", row: rowIndex, col: colIndex })}
              >
                <span />
              </button>
            );
          })
        )}
      </div>
    </section>
  );
}

function formatChoice(choice: "rock" | "paper" | "scissors"): string {
  switch (choice) {
    case "rock":
      return "グー";
    case "paper":
      return "パー";
    case "scissors":
      return "チョキ";
  }
}

function formatJankenSelection(selection: "rock" | "paper" | "scissors" | "hidden" | null): string {
  if (selection === null) {
    return "未選択";
  }
  if (selection === "hidden") {
    return "選択済み";
  }
  return formatChoice(selection);
}

function cellClass(value: number | null): string {
  if (value === 0) {
    return "board-cell--p1";
  }
  if (value === 1) {
    return "board-cell--p2";
  }
  return "board-cell--empty";
}

function isHighlighted(line: BoardPosition[], row: number, col: number): boolean {
  return line.some((position) => position.row === row && position.col === col);
}

function formatCard(card: string): string {
  if (card === "JOKER") {
    return "JOKER";
  }
  const suitMap: Record<string, string> = {
    S: "♠",
    H: "♥",
    D: "♦",
    C: "♣"
  };
  return `${card.slice(0, -1)}${suitMap[card.slice(-1)] ?? ""}`;
}

function cardClass(card: string): string {
  if (card === "JOKER") {
    return "old-maid-card old-maid-card--joker";
  }
  const suit = card.slice(-1);
  const red = suit === "H" || suit === "D";
  return `old-maid-card ${red ? "old-maid-card--red" : "old-maid-card--black"}`;
}

import type {
  BoardPosition,
  ClientAction,
  Connect4View,
  PlacementBoardView
} from "../../shared/types";

interface BoardSurfaceProps {
  gameTitle: string;
  view: Connect4View | PlacementBoardView;
  onAction: (action: ClientAction) => void;
}

export function BoardSurface({ gameTitle, view, onAction }: BoardSurfaceProps) {
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
      <h2>{gameTitle}</h2>
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

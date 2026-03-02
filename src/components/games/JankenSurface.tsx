import type { ClientAction, JankenView, RoomSnapshot } from "../../shared/types";

interface JankenSurfaceProps {
  snapshot: RoomSnapshot;
  view: JankenView;
  onAction: (action: ClientAction) => void;
}

export function JankenSurface({ snapshot, view, onAction }: JankenSurfaceProps) {
  const jankenColumns = Math.min(Math.max(snapshot.players.length, 2), 3);

  return (
    <section className="surface-card">
      <h2>じゃんけん</h2>
      <p className="surface-status">{view.resultMessage ?? "手を選んでください"}</p>
      <div className="janken-slots" style={{ gridTemplateColumns: `repeat(${jankenColumns}, minmax(0, 1fr))` }}>
        {snapshot.players.map((player, index) => (
          <div
            className={`janken-slot ${view.winnerSeats.includes(player.seat) ? "janken-slot--winner" : ""}`}
            key={player.id}
          >
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

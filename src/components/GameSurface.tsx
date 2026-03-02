import { GAME_MAP } from "../shared/games";
import type { ClientAction, RoomSnapshot } from "../shared/types";
import { BoardSurface } from "./games/BoardSurface";
import { JankenSurface } from "./games/JankenSurface";
import { OldMaidSurface } from "./games/OldMaidSurface";
import { PlannedSurface } from "./games/PlannedSurface";
import { SevensSurface } from "./games/SevensSurface";
import { SpadesSurface } from "./games/SpadesSurface";
import { WaitingSurface } from "./games/WaitingSurface";

interface GameSurfaceProps {
  snapshot: RoomSnapshot;
  onAction: (action: ClientAction) => void;
}

export function GameSurface({ snapshot, onAction }: GameSurfaceProps) {
  const view = snapshot.gameView;

  if (view.kind === "waiting") {
    return <WaitingSurface view={view} />;
  }

  if (view.kind === "planned") {
    return <PlannedSurface view={view} />;
  }

  if (view.kind === "janken") {
    return <JankenSurface onAction={onAction} snapshot={snapshot} view={view} />;
  }

  if (view.kind === "old-maid") {
    return <OldMaidSurface onAction={onAction} view={view} />;
  }

  if (view.kind === "sevens") {
    return <SevensSurface onAction={onAction} view={view} />;
  }

  if (view.kind === "spades") {
    return <SpadesSurface onAction={onAction} view={view} />;
  }

  return <BoardSurface gameTitle={GAME_MAP[snapshot.gameId].title} onAction={onAction} view={view} />;
}

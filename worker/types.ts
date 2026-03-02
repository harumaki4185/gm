import type {
  BoardPosition,
  GameId,
  JankenChoice,
  ParticipantSummary,
  RoomSettings,
  RoomStatus
} from "../src/shared/types";

export interface Env {
  ASSETS: Fetcher;
  ROOMS: DurableObjectNamespace;
  RATE_LIMITER: DurableObjectNamespace;
}

export interface StoredParticipant extends ParticipantSummary {
  sessionId: string | null;
}

export interface LifecycleAlarm {
  kind: "waiting_expire" | "disconnect_forfeit" | "cleanup";
  at: string;
  playerId?: string;
}

export interface RoomRecord {
  roomId: string;
  gameId: GameId;
  roomStatus: RoomStatus;
  createdAt: string;
  updatedAt: string;
  settings: RoomSettings;
  players: StoredParticipant[];
  rematchVotes: string[];
  gameState: InternalGameState;
  lifecycleAlarm: LifecycleAlarm | null;
}

export interface JankenState {
  type: "janken";
  phase: "playing" | "finished";
  round: number;
  selections: Array<JankenChoice | null>;
  winnerSeats: number[];
  resultMessage: string | null;
}

export interface PlacementState {
  type: "gomoku" | "othello";
  board: Array<Array<number | null>>;
  currentSeat: number;
  winnerSeat: number | null;
  legalMoves: BoardPosition[];
  winningLine: BoardPosition[];
  statusMessage: string;
}

export interface Connect4State {
  type: "connect4";
  board: Array<Array<number | null>>;
  currentSeat: number;
  winnerSeat: number | null;
  winningLine: BoardPosition[];
  statusMessage: string;
}

export interface OldMaidState {
  type: "old-maid";
  hands: string[][];
  currentSeat: number;
  winnerSeats: number[];
  loserSeat: number | null;
  statusMessage: string;
  lastAction: string | null;
}

export interface PlannedState {
  type: "planned";
  title: string;
  message: string;
}

export type InternalGameState =
  | JankenState
  | PlacementState
  | Connect4State
  | OldMaidState
  | PlannedState;

export const WAITING_ROOM_TTL_MS = 15 * 60 * 1000;
export const FINISHED_ROOM_TTL_MS = 10 * 60 * 1000;
export const DISCONNECT_FORFEIT_MS = 45 * 1000;

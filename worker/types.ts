import type {
  BoardPosition,
  GameId,
  JankenChoice,
  ParticipantSummary,
  RoomSettings,
  RoomStatus
} from "../src/shared/types";
import type { CardSuit } from "../src/shared/cards";

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
  revealedSelections: Array<JankenChoice | null> | null;
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

export interface SevensState {
  type: "sevens";
  hands: string[][];
  currentSeat: number | null;
  winnerSeats: number[];
  placements: number[];
  suitRanges: Record<CardSuit, { low: number; high: number }>;
  passCounts: number[];
  statusMessage: string;
  lastAction: string | null;
}

export interface SpadesState {
  type: "spades";
  stage: "bidding" | "playing" | "finished";
  hands: string[][];
  currentSeat: number | null;
  dealerSeat: number;
  bids: Array<number | null>;
  tricksWon: number[];
  currentTrick: Array<{ seat: number; card: string }>;
  completedTricks: number;
  spadesBroken: boolean;
  winnerSeats: number[];
  teamScores: number[];
  statusMessage: string;
  lastAction: string | null;
}

export interface MahjongState {
  type: "mahjong";
  phase: "playing" | "round_result" | "finished";
  matchType: "tonpuu" | "hanchan";
  roundWind: "east" | "south";
  roundNumber: number;
  roundLabel: string;
  dealerSeat: number;
  currentSeat: number | null;
  honba: number;
  riichiSticks: number;
  scores: number[];
  hands: string[][];
  melds: MahjongMeld[][];
  discards: string[][];
  wall: string[];
  deadWall: string[];
  doraIndicators: string[];
  uraDoraIndicators: string[];
  lastDrawTile: string | null;
  lastDrawSeat: number | null;
  drawSource: "wall" | "rinshan" | null;
  riichiSeats: number[];
  ippatsuEligible: boolean[];
  sameTurnFuriten: boolean[];
  riichiFuriten: boolean[];
  winnerSeats: number[];
  tenpaiSeats: number[];
  statusMessage: string;
  lastAction: string | null;
  finishReason: string | null;
  pendingCall: MahjongPendingCall | null;
  results: MahjongResult[];
}

export interface MahjongMeld {
  type: "chi" | "pon" | "kan";
  tiles: string[];
  fromSeat: number | null;
  calledTile: string | null;
  open: boolean;
}

export interface MahjongRonPendingCall {
  stage: "ron";
  discardSeat: number;
  discardTile: string;
  source: "discard" | "kakan";
  eligibleSeats: number[];
  acceptedSeats: number[];
  passedSeats: number[];
  kakanSeat?: number;
  kakanTile?: string;
  kakanMeldIndex?: number;
}

export interface MahjongClaimPendingCall {
  stage: "call";
  seat: number;
  discardSeat: number;
  discardTile: string;
  chiOptions: string[][];
  ponOption: string[] | null;
  kanOption: string[] | null;
}

export type MahjongPendingCall = MahjongRonPendingCall | MahjongClaimPendingCall;

export interface MahjongResult {
  winnerSeat: number;
  sourceSeat: number | null;
  winType: "tsumo" | "ron";
  han: number;
  fu: number;
  total: number;
  yaku: string[];
  scoreDeltas: number[];
  summary: string;
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
  | SevensState
  | SpadesState
  | MahjongState
  | PlannedState;

export const WAITING_ROOM_TTL_MS = 15 * 60 * 1000;
export const FINISHED_ROOM_TTL_MS = 10 * 60 * 1000;
export const DISCONNECT_FORFEIT_MS = 45 * 1000;

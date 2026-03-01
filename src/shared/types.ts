export const GAME_IDS = [
  "othello",
  "gomoku",
  "connect4",
  "janken",
  "old-maid",
  "sevens",
  "spades"
] as const;

export type GameId = (typeof GAME_IDS)[number];
export type PlayerType = "human" | "bot";
export type Availability = "active" | "planned";
export type RoomStatus = "waiting" | "playing" | "finished";
export type JankenChoice = "rock" | "paper" | "scissors";

export interface GameCatalogEntry {
  id: GameId;
  title: string;
  shortDescription: string;
  description: string;
  category: "board" | "card" | "party";
  availability: Availability;
  totalSeats: number;
  minHumanPlayers: number;
  supportsBots: boolean;
  accent: string;
}

export interface RoomSettings {
  fillWithBots: boolean;
}

export interface ParticipantSummary {
  id: string;
  seat: number;
  name: string;
  playerType: PlayerType;
  connected: boolean;
  isHost: boolean;
  team: number | null;
}

export interface BoardPosition {
  row: number;
  col: number;
}

export interface WaitingView {
  kind: "waiting";
  message: string;
  requiredHumans: number;
  connectedHumans: number;
  totalSeats: number;
  supportsBots: boolean;
}

export interface PlannedView {
  kind: "planned";
  title: string;
  message: string;
}

export interface JankenView {
  kind: "janken";
  phase: "playing" | "finished";
  round: number;
  canAct: boolean;
  choices: JankenChoice[];
  selections: Array<JankenChoice | "hidden" | null>;
  resultMessage: string | null;
  currentSeat: number | null;
  winnerSeat: number | null;
}

export interface PlacementBoardView {
  kind: "gomoku" | "othello";
  rows: number;
  cols: number;
  canAct: boolean;
  currentSeat: number;
  winnerSeat: number | null;
  board: Array<Array<number | null>>;
  legalMoves: BoardPosition[];
  winningLine: BoardPosition[];
  statusMessage: string;
}

export interface Connect4View {
  kind: "connect4";
  rows: number;
  cols: number;
  canAct: boolean;
  currentSeat: number;
  winnerSeat: number | null;
  board: Array<Array<number | null>>;
  legalColumns: number[];
  winningLine: BoardPosition[];
  statusMessage: string;
}

export type GameView =
  | WaitingView
  | PlannedView
  | JankenView
  | PlacementBoardView
  | Connect4View;

export interface RoomSnapshot {
  roomId: string;
  gameId: GameId;
  roomStatus: RoomStatus;
  createdAt: string;
  updatedAt: string;
  players: ParticipantSummary[];
  selfSeat: number | null;
  selfPlayerId: string | null;
  rematchVotes: number[];
  gameView: GameView;
}

export interface RoomMutationResponse {
  sessionId: string;
  snapshot: RoomSnapshot;
}

export interface CreateRoomRequest {
  gameId: GameId;
  playerName: string;
  settings?: Partial<RoomSettings>;
  sessionId?: string;
}

export interface JoinRoomRequest {
  playerName: string;
  sessionId?: string;
}

export interface ReconnectRoomRequest {
  sessionId: string;
}

export type ClientAction =
  | {
      type: "choose_rps";
      choice: JankenChoice;
    }
  | {
      type: "place_piece";
      row: number;
      col: number;
    }
  | {
      type: "drop_disc";
      col: number;
    };

export interface ActionRequest {
  sessionId: string;
  action: ClientAction;
}

export interface RematchRequest {
  sessionId: string;
}

export interface ApiErrorBody {
  error: string;
  status?: number;
}

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
  defaultSeats: number;
  minSeats: number;
  maxSeats: number;
  minHumanPlayers: number;
  supportsBots: boolean;
  accent: string;
}

export interface RoomSettings {
  seatCount: number;
  botCount: number;
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
  joinedHumans: number;
  connectedHumans: number;
  totalSeats: number;
  botCount: number;
  supportsBots: boolean;
  minSeats: number;
  maxSeats: number;
  minHumanPlayers: number;
  startPlayerCount: number;
  canStart: boolean;
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
  winnerSeats: number[];
}

export interface OldMaidOpponentView {
  seat: number;
  name: string;
  cardCount: number;
  isCurrentTarget: boolean;
  hasFinished: boolean;
  targetableSlots: number[];
}

export interface OldMaidView {
  kind: "old-maid";
  canAct: boolean;
  currentSeat: number | null;
  winnerSeats: number[];
  loserSeat: number | null;
  statusMessage: string;
  selfHand: string[];
  opponents: OldMaidOpponentView[];
  lastAction: string | null;
}

export interface SevensSuitRangeView {
  suit: "S" | "H" | "D" | "C";
  low: number;
  high: number;
}

export interface SevensPlayerView {
  seat: number;
  name: string;
  cardCount: number;
  passCount: number;
  isCurrent: boolean;
  isWinner: boolean;
  placement: number | null;
}

export interface SevensView {
  kind: "sevens";
  canAct: boolean;
  currentSeat: number | null;
  winnerSeats: number[];
  statusMessage: string;
  lastAction: string | null;
  selfHand: string[];
  legalCards: string[];
  suits: SevensSuitRangeView[];
  players: SevensPlayerView[];
  placements: number[];
}

export interface SpadesPlayerView {
  seat: number;
  name: string;
  cardCount: number;
  bid: number | null;
  tricksWon: number;
  team: number | null;
  isCurrent: boolean;
}

export interface SpadesTeamView {
  team: number;
  bid: number;
  tricksWon: number;
  score: number;
  members: number[];
}

export interface SpadesTrickCardView {
  seat: number;
  card: string | null;
}

export interface SpadesView {
  kind: "spades";
  stage: "bidding" | "playing" | "finished";
  canBid: boolean;
  canPlay: boolean;
  currentSeat: number | null;
  dealerSeat: number;
  winnerSeats: number[];
  statusMessage: string;
  lastAction: string | null;
  selfHand: string[];
  legalCards: string[];
  bidOptions: number[];
  players: SpadesPlayerView[];
  teams: SpadesTeamView[];
  currentTrick: SpadesTrickCardView[];
  completedTricks: number;
  spadesBroken: boolean;
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
  | OldMaidView
  | SevensView
  | SpadesView
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
    }
  | {
      type: "draw_old_maid";
      targetIndex: number;
    }
  | {
      type: "play_card";
      card: string;
    }
  | {
      type: "pass_sevens";
    }
  | {
      type: "bid_spades";
      bid: number;
    };

export interface ActionRequest {
  sessionId: string;
  action: ClientAction;
}

export interface RematchRequest {
  sessionId: string;
}

export interface UpdateRoomSettingsRequest {
  sessionId: string;
  settings: Partial<RoomSettings>;
}

export interface StartRoomRequest {
  sessionId: string;
}

export interface ApiErrorBody {
  error: string;
  status?: number;
}

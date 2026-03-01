import { GAME_MAP } from "../src/shared/games";
import type {
  BoardPosition,
  ClientAction,
  GameView,
  JankenChoice,
  OldMaidView
} from "../src/shared/types";
import { AppError } from "./errors";
import type {
  Connect4State,
  InternalGameState,
  JankenState,
  OldMaidState,
  PlacementState,
  RoomRecord
} from "./types";

export function buildWaitingState(gameId: keyof typeof GAME_MAP): InternalGameState {
  return {
    type: "planned",
    title: GAME_MAP[gameId].title,
    message: "対戦相手の参加を待っています。"
  };
}

export function createInitialGameState(gameId: keyof typeof GAME_MAP): InternalGameState {
  const startingSeat = Math.random() >= 0.5 ? 1 : 0;

  if (gameId === "janken") {
    return {
      type: "janken",
      phase: "playing",
      round: 1,
      selections: [null, null],
      winnerSeat: null,
      resultMessage: "手を選んでください"
    };
  }

  if (gameId === "gomoku") {
    const board = createBoard(15, 15);
    return {
      type: "gomoku",
      board,
      currentSeat: startingSeat,
      winnerSeat: null,
      legalMoves: getEmptyCells(board),
      winningLine: [],
      statusMessage: `プレイヤー ${startingSeat + 1} の手番です`
    };
  }

  if (gameId === "connect4") {
    return {
      type: "connect4",
      board: createBoard(6, 7),
      currentSeat: startingSeat,
      winnerSeat: null,
      winningLine: [],
      statusMessage: `プレイヤー ${startingSeat + 1} の手番です`
    };
  }

  if (gameId === "othello") {
    const board = createBoard(8, 8);
    board[3][3] = 1;
    board[3][4] = 0;
    board[4][3] = 0;
    board[4][4] = 1;
    return {
      type: "othello",
      board,
      currentSeat: startingSeat,
      winnerSeat: null,
      legalMoves: getOthelloLegalMoves(board, startingSeat),
      winningLine: [],
      statusMessage: `プレイヤー ${startingSeat + 1} の手番です`
    };
  }

  if (gameId === "old-maid") {
    return createOldMaidState();
  }

  return {
    type: "planned",
    title: GAME_MAP[gameId].title,
    message: "このゲームロジックは現在実装中です。"
  };
}

export function applyGameAction(room: RoomRecord, seat: number, action: ClientAction): void {
  if (room.gameState.type === "planned") {
    throw new AppError("このゲームはまだ操作できません", 409);
  }

  if (room.gameState.type === "janken") {
    applyJankenAction(room, seat, action);
    return;
  }

  if (room.gameState.type === "old-maid") {
    applyOldMaidAction(room, seat, action);
    return;
  }

  if (room.gameState.type === "connect4") {
    applyConnect4Action(room, seat, action);
    return;
  }

  applyPlacementAction(room, seat, action);
}

export function buildView(room: RoomRecord, selfSeat: number | null): GameView {
  const game = GAME_MAP[room.gameId];
  const connectedHumans = room.players.filter(
    (player) => player.playerType === "human" && player.connected
  ).length;

  if (room.roomStatus === "waiting") {
    return {
      kind: "waiting",
      message: "対戦相手の参加を待っています。",
      requiredHumans: game.minHumanPlayers,
      connectedHumans,
      totalSeats: game.totalSeats,
      supportsBots: game.supportsBots
    };
  }

  const state = room.gameState;

  if (state.type === "planned") {
    return {
      kind: "planned",
      title: state.title,
      message: state.message
    };
  }

  if (state.type === "janken") {
    return buildJankenView(room, state, selfSeat);
  }

  if (state.type === "old-maid") {
    return buildOldMaidView(room, state, selfSeat);
  }

  if (state.type === "connect4") {
    const cols = getColumnCount(state.board);
    return {
      kind: "connect4",
      rows: state.board.length,
      cols,
      canAct: room.roomStatus === "playing" && selfSeat === state.currentSeat,
      currentSeat: state.currentSeat,
      winnerSeat: state.winnerSeat,
      board: state.board,
      legalColumns: getLegalColumns(state.board),
      winningLine: state.winningLine,
      statusMessage: state.statusMessage
    };
  }

  const cols = getColumnCount(state.board);
  return {
    kind: state.type,
    rows: state.board.length,
    cols,
    canAct: room.roomStatus === "playing" && selfSeat === state.currentSeat,
    currentSeat: state.currentSeat,
    winnerSeat: state.winnerSeat,
    board: state.board,
    legalMoves: state.legalMoves,
    winningLine: state.winningLine,
    statusMessage: state.statusMessage
  };
}

export function markDisconnectPending(room: RoomRecord, seat: number, disconnectedName: string): void {
  if (room.gameState.type === "planned") {
    room.gameState.message = `${disconnectedName} の再接続を待っています。`;
    return;
  }

  if (room.gameState.type === "janken") {
    room.gameState.resultMessage = `${disconnectedName} の再接続を待っています。`;
    return;
  }

  if (room.gameState.type === "old-maid") {
    room.gameState.statusMessage = `${disconnectedName} の再接続を待っています。`;
    return;
  }

  room.gameState.statusMessage = `${disconnectedName} の再接続を待っています。`;
  if ("currentSeat" in room.gameState) {
    room.gameState.currentSeat = seat;
  }
}

export function resumeGameAfterReconnect(room: RoomRecord): void {
  if (room.gameState.type === "planned") {
    room.gameState.message =
      room.roomStatus === "waiting" ? "対戦相手の参加を待っています。" : room.gameState.message;
    return;
  }

  if (room.gameState.type === "janken") {
    if (room.gameState.phase === "finished") {
      return;
    }
    room.gameState.resultMessage = room.gameState.resultMessage ?? "手を選んでください";
    return;
  }

  if (room.gameState.type === "old-maid") {
    room.gameState.statusMessage = `プレイヤー ${room.gameState.currentSeat + 1} がカードを引く番です`;
    return;
  }

  if (room.gameState.type === "connect4") {
    room.gameState.statusMessage = `プレイヤー ${room.gameState.currentSeat + 1} の手番です`;
    return;
  }

  room.gameState.statusMessage = `プレイヤー ${room.gameState.currentSeat + 1} の手番です`;
}

export function finalizeByDisconnect(room: RoomRecord, disconnectedSeat: number): void {
  room.roomStatus = "finished";

  if (room.gameState.type === "planned") {
    room.gameState.message = "対戦相手の切断によりルームを終了しました。";
    return;
  }

  if (room.gameState.type === "janken") {
    room.gameState.phase = "finished";
    room.gameState.winnerSeat = disconnectedSeat === 0 ? 1 : 0;
    room.gameState.resultMessage = `プレイヤー ${room.gameState.winnerSeat + 1} の不戦勝です`;
    return;
  }

  if (room.gameState.type === "old-maid") {
    room.gameState.winnerSeat = disconnectedSeat === 0 ? 1 : 0;
    room.gameState.loserSeat = disconnectedSeat;
    room.gameState.statusMessage = `プレイヤー ${room.gameState.winnerSeat + 1} の不戦勝です`;
    return;
  }

  room.gameState.winnerSeat = disconnectedSeat === 0 ? 1 : 0;
  room.gameState.statusMessage = `プレイヤー ${room.gameState.winnerSeat + 1} の不戦勝です`;
}

function buildJankenView(room: RoomRecord, state: JankenState, selfSeat: number | null): GameView {
  const selections = state.selections.map((choice, index) => {
    if (state.phase === "finished") {
      return choice;
    }
    if (choice === null) {
      return null;
    }
    if (index === selfSeat) {
      return choice;
    }
    return "hidden";
  });

  return {
    kind: "janken",
    phase: state.phase,
    round: state.round,
    canAct:
      room.roomStatus === "playing" &&
      selfSeat !== null &&
      selfSeat <= 1 &&
      state.selections[selfSeat] === null,
    choices: ["rock", "paper", "scissors"],
    selections,
    resultMessage: state.resultMessage,
    currentSeat: null,
    winnerSeat: state.winnerSeat
  };
}

function buildOldMaidView(room: RoomRecord, state: OldMaidState, selfSeat: number | null): OldMaidView {
  if (selfSeat === null) {
    return {
      kind: "old-maid",
      canAct: false,
      currentSeat: state.currentSeat,
      winnerSeat: state.winnerSeat,
      loserSeat: state.loserSeat,
      statusMessage: state.statusMessage,
      selfHand: [],
      opponentCardCount: 0,
      targetableOpponentSlots: [],
      lastAction: state.lastAction
    };
  }

  const seat = selfSeat;
  const opponentSeat = seat === 0 ? 1 : 0;
  const opponentHand = state.hands[opponentSeat] ?? [];
  const targetableOpponentSlots = shuffle(
    opponentHand.map((_, index) => index.toString())
  ).map((value) => Number(value));

  return {
    kind: "old-maid",
    canAct: room.roomStatus === "playing" && selfSeat === state.currentSeat && opponentHand.length > 0,
    currentSeat: state.currentSeat,
    winnerSeat: state.winnerSeat,
    loserSeat: state.loserSeat,
    statusMessage: state.statusMessage,
    selfHand: [...(state.hands[seat] ?? [])].sort(compareCardLabels),
    opponentCardCount: opponentHand.length,
    targetableOpponentSlots,
    lastAction: state.lastAction
  };
}

function applyJankenAction(room: RoomRecord, seat: number, action: ClientAction): void {
  const state = room.gameState;
  if (state.type !== "janken") {
    throw new AppError("janken state ではありません", 500);
  }
  if (action.type !== "choose_rps") {
    throw new AppError("この操作はじゃんけんでは無効です", 400);
  }
  if (seat > 1) {
    throw new AppError("人間プレイヤーの席が不正です", 400);
  }
  if (state.phase !== "playing") {
    throw new AppError("このラウンドは終了しています", 409);
  }
  if (state.selections[seat] !== null) {
    throw new AppError("すでに手を選択済みです", 409);
  }

  state.selections[seat] = action.choice;

  if (state.selections.some((choice) => choice === null)) {
    state.resultMessage = "相手の入力を待っています";
    return;
  }

  const [first, second] = state.selections as [JankenChoice, JankenChoice];
  const result = resolveJanken(first, second);

  if (result === null) {
    state.round += 1;
    state.selections = [null, null];
    state.winnerSeat = null;
    state.resultMessage = `あいこです。Round ${state.round} を始めます`;
    return;
  }

  state.phase = "finished";
  state.winnerSeat = result;
  state.resultMessage = `プレイヤー ${result + 1} の勝ちです`;
  room.roomStatus = "finished";
}

function applyOldMaidAction(room: RoomRecord, seat: number, action: ClientAction): void {
  const state = room.gameState;
  if (state.type !== "old-maid") {
    throw new AppError("old-maid state ではありません", 500);
  }
  if (action.type !== "draw_old_maid") {
    throw new AppError("この操作はババ抜きでは無効です", 400);
  }
  if (state.currentSeat !== seat) {
    throw new AppError("あなたの手番ではありません", 403);
  }

  const opponentSeat = seat === 0 ? 1 : 0;
  const opponentHand = state.hands[opponentSeat] ?? [];
  if (action.targetIndex < 0 || action.targetIndex >= opponentHand.length) {
    throw new AppError("そのカードは引けません", 409);
  }

  const [drawnCard] = opponentHand.splice(action.targetIndex, 1);
  state.hands[seat].push(drawnCard);
  const removedPairs = collapsePairs(state.hands[seat]);
  const actorName = `プレイヤー ${seat + 1}`;
  const opponentName = `プレイヤー ${opponentSeat + 1}`;
  state.lastAction =
    removedPairs > 0
      ? `${actorName} が ${opponentName} から 1 枚引き、${removedPairs} 組のペアを捨てました`
      : `${actorName} が ${opponentName} から 1 枚引きました`;

  const winner = resolveOldMaidWinner(state);
  if (winner !== null) {
    room.roomStatus = "finished";
    if (winner === -1) {
      state.winnerSeat = null;
      state.loserSeat = null;
      state.statusMessage = "引き分けです";
      return;
    }
    state.winnerSeat = winner;
    state.loserSeat = winner === 0 ? 1 : 0;
    state.statusMessage = `プレイヤー ${winner + 1} の勝ちです`;
    return;
  }

  state.currentSeat = opponentSeat;
  state.statusMessage = `プレイヤー ${opponentSeat + 1} がカードを引く番です`;
}

function applyConnect4Action(room: RoomRecord, seat: number, action: ClientAction): void {
  const state = room.gameState;
  if (state.type !== "connect4") {
    throw new AppError("connect4 state ではありません", 500);
  }
  if (action.type !== "drop_disc") {
    throw new AppError("列を指定してください", 400);
  }
  if (state.currentSeat !== seat) {
    throw new AppError("あなたの手番ではありません", 403);
  }

  const row = findDropRow(state.board, action.col);
  if (row === null) {
    throw new AppError("その列には置けません", 409);
  }

  state.board[row][action.col] = seat;
  const winningLine = findWinningLine(state.board, row, action.col, seat, 4);
  if (winningLine.length > 0) {
    state.winnerSeat = seat;
    state.winningLine = winningLine;
    state.statusMessage = `プレイヤー ${seat + 1} の勝ちです`;
    room.roomStatus = "finished";
    return;
  }

  if (isBoardFull(state.board)) {
    state.statusMessage = "引き分けです";
    room.roomStatus = "finished";
    return;
  }

  state.currentSeat = seat === 0 ? 1 : 0;
  state.statusMessage = `プレイヤー ${state.currentSeat + 1} の手番です`;
}

function applyPlacementAction(room: RoomRecord, seat: number, action: ClientAction): void {
  const state = room.gameState;
  if (state.type !== "gomoku" && state.type !== "othello") {
    throw new AppError("盤面操作ができるゲームではありません", 500);
  }
  if (action.type !== "place_piece") {
    throw new AppError("盤面上の位置を指定してください", 400);
  }
  if (state.currentSeat !== seat) {
    throw new AppError("あなたの手番ではありません", 403);
  }
  if (!isLegalMove(state.legalMoves, action.row, action.col)) {
    throw new AppError("その位置には置けません", 409);
  }

  if (state.type === "gomoku") {
    state.board[action.row][action.col] = seat;
    const winningLine = findWinningLine(state.board, action.row, action.col, seat, 5);
    if (winningLine.length > 0) {
      state.winnerSeat = seat;
      state.winningLine = winningLine;
      state.statusMessage = `プレイヤー ${seat + 1} の勝ちです`;
      room.roomStatus = "finished";
      return;
    }

    if (isBoardFull(state.board)) {
      state.statusMessage = "引き分けです";
      room.roomStatus = "finished";
      return;
    }

    state.currentSeat = seat === 0 ? 1 : 0;
    state.legalMoves = getEmptyCells(state.board);
    state.statusMessage = `プレイヤー ${state.currentSeat + 1} の手番です`;
    return;
  }

  const flips = getOthelloFlips(state.board, action.row, action.col, seat);
  if (flips.length === 0) {
    throw new AppError("その位置には置けません", 409);
  }

  state.board[action.row][action.col] = seat;
  for (const position of flips) {
    state.board[position.row][position.col] = seat;
  }

  const nextSeat = seat === 0 ? 1 : 0;
  const nextMoves = getOthelloLegalMoves(state.board, nextSeat);
  if (nextMoves.length > 0) {
    state.currentSeat = nextSeat;
    state.legalMoves = nextMoves;
    state.statusMessage = `プレイヤー ${nextSeat + 1} の手番です`;
    return;
  }

  const sameSeatMoves = getOthelloLegalMoves(state.board, seat);
  if (sameSeatMoves.length > 0) {
    state.currentSeat = seat;
    state.legalMoves = sameSeatMoves;
    state.statusMessage = `プレイヤー ${nextSeat + 1} はパスです。プレイヤー ${seat + 1} の手番です`;
    return;
  }

  const counts = countBoard(state.board);
  state.winnerSeat = counts[0] === counts[1] ? null : counts[0] > counts[1] ? 0 : 1;
  state.legalMoves = [];
  state.statusMessage =
    state.winnerSeat === null ? "引き分けです" : `プレイヤー ${state.winnerSeat + 1} の勝ちです`;
  room.roomStatus = "finished";
}

function resolveJanken(first: JankenChoice, second: JankenChoice): number | null {
  if (first === second) {
    return null;
  }
  if (
    (first === "rock" && second === "scissors") ||
    (first === "scissors" && second === "paper") ||
    (first === "paper" && second === "rock")
  ) {
    return 0;
  }
  return 1;
}

function createOldMaidState(): OldMaidState {
  const deck = shuffle(createOldMaidDeck());
  const hands: string[][] = [[], []];

  deck.forEach((card, index) => {
    hands[index % 2].push(card);
  });

  collapsePairs(hands[0]);
  collapsePairs(hands[1]);

  const startingSeat = Math.random() >= 0.5 ? 1 : 0;
  const state: OldMaidState = {
    type: "old-maid",
    hands,
    currentSeat: startingSeat,
    winnerSeat: null,
    loserSeat: null,
    statusMessage: `プレイヤー ${startingSeat + 1} がカードを引く番です`,
    lastAction: "配札を行いました"
  };

  const winner = resolveOldMaidWinner(state);
  if (winner !== null) {
    if (winner === -1) {
      state.winnerSeat = null;
      state.loserSeat = null;
      state.statusMessage = "引き分けです";
    } else {
      state.winnerSeat = winner;
      state.loserSeat = winner === 0 ? 1 : 0;
      state.statusMessage = `プレイヤー ${winner + 1} の勝ちです`;
    }
  }

  return state;
}

function createBoard(rows: number, cols: number): Array<Array<number | null>> {
  return Array.from({ length: rows }, () => Array.from({ length: cols }, () => null));
}

function createOldMaidDeck(): string[] {
  const suits = ["S", "H", "D", "C"];
  const ranks = ["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"];
  const deck: string[] = [];

  for (const suit of suits) {
    for (const rank of ranks) {
      deck.push(`${rank}${suit}`);
    }
  }

  deck.push("JOKER");
  return deck;
}

function shuffle(cards: string[]): string[] {
  const result = [...cards];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    const current = result[index];
    result[index] = result[swapIndex];
    result[swapIndex] = current;
  }
  return result;
}

function collapsePairs(hand: string[]): number {
  const counts = new Map<string, string[]>();
  for (const card of hand) {
    const rank = getCardRank(card);
    if (rank === "JOKER") {
      continue;
    }
    const bucket = counts.get(rank) ?? [];
    bucket.push(card);
    counts.set(rank, bucket);
  }

  const toRemove = new Set<string>();
  let removedPairs = 0;
  for (const cards of counts.values()) {
    const pairCount = Math.floor(cards.length / 2);
    for (let index = 0; index < pairCount * 2; index += 1) {
      toRemove.add(cards[index]);
    }
    removedPairs += pairCount;
  }

  if (toRemove.size === 0) {
    return 0;
  }

  const kept = hand.filter((card) => !toRemove.has(card));
  hand.splice(0, hand.length, ...kept);
  return removedPairs;
}

function resolveOldMaidWinner(state: OldMaidState): number | -1 | null {
  if (state.hands[0].length === 0 && state.hands[1].length === 0) {
    state.statusMessage = "引き分けです";
    state.loserSeat = null;
    return -1;
  }
  if (state.hands[0].length === 0 && state.hands[1].length > 0) {
    return 0;
  }
  if (state.hands[1].length === 0 && state.hands[0].length > 0) {
    return 1;
  }
  return null;
}

function getCardRank(card: string): string {
  if (card === "JOKER") {
    return "JOKER";
  }
  return card.slice(0, -1);
}

function compareCardLabels(left: string, right: string): number {
  return getCardSortIndex(left) - getCardSortIndex(right);
}

function getCardSortIndex(card: string): number {
  const ranks = ["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K", "JOKER"];
  const suits = ["S", "H", "D", "C"];
  const rank = getCardRank(card);
  const rankIndex = ranks.indexOf(rank);
  if (card === "JOKER") {
    return rankIndex * 10;
  }
  const suit = card.slice(-1);
  return rankIndex * 10 + suits.indexOf(suit);
}

function getColumnCount(board: Array<Array<number | null>>): number {
  return board[0]?.length ?? 0;
}

function getEmptyCells(board: Array<Array<number | null>>): BoardPosition[] {
  const positions: BoardPosition[] = [];
  for (let row = 0; row < board.length; row += 1) {
    const columnCount = board[row]?.length ?? 0;
    for (let col = 0; col < columnCount; col += 1) {
      if (board[row][col] === null) {
        positions.push({ row, col });
      }
    }
  }
  return positions;
}

function isBoardFull(board: Array<Array<number | null>>): boolean {
  return board.every((row) => row.every((cell) => cell !== null));
}

function isLegalMove(legalMoves: BoardPosition[], row: number, col: number): boolean {
  return legalMoves.some((move) => move.row === row && move.col === col);
}

function findWinningLine(
  board: Array<Array<number | null>>,
  row: number,
  col: number,
  seat: number,
  lengthToWin: number
): BoardPosition[] {
  const directions: Array<[number, number]> = [
    [1, 0],
    [0, 1],
    [1, 1],
    [1, -1]
  ];

  for (const [deltaRow, deltaCol] of directions) {
    const line: BoardPosition[] = [{ row, col }];
    collectDirection(board, row, col, deltaRow, deltaCol, seat, line);
    collectDirection(board, row, col, -deltaRow, -deltaCol, seat, line);
    if (line.length >= lengthToWin) {
      return line;
    }
  }

  return [];
}

function collectDirection(
  board: Array<Array<number | null>>,
  row: number,
  col: number,
  deltaRow: number,
  deltaCol: number,
  seat: number,
  line: BoardPosition[]
): void {
  const columnCount = getColumnCount(board);
  let currentRow = row + deltaRow;
  let currentCol = col + deltaCol;

  while (
    currentRow >= 0 &&
    currentRow < board.length &&
    currentCol >= 0 &&
    currentCol < columnCount &&
    board[currentRow]?.[currentCol] === seat
  ) {
    line.push({ row: currentRow, col: currentCol });
    currentRow += deltaRow;
    currentCol += deltaCol;
  }
}

function findDropRow(board: Array<Array<number | null>>, col: number): number | null {
  const columnCount = getColumnCount(board);
  if (col < 0 || col >= columnCount) {
    return null;
  }
  for (let row = board.length - 1; row >= 0; row -= 1) {
    if (board[row]?.[col] === null) {
      return row;
    }
  }
  return null;
}

function getLegalColumns(board: Array<Array<number | null>>): number[] {
  const columns: number[] = [];
  const columnCount = getColumnCount(board);
  for (let col = 0; col < columnCount; col += 1) {
    if (board[0]?.[col] === null) {
      columns.push(col);
    }
  }
  return columns;
}

function getOthelloLegalMoves(board: Array<Array<number | null>>, seat: number): BoardPosition[] {
  const moves: BoardPosition[] = [];
  for (let row = 0; row < board.length; row += 1) {
    const columnCount = board[row]?.length ?? 0;
    for (let col = 0; col < columnCount; col += 1) {
      if (board[row][col] !== null) {
        continue;
      }
      if (getOthelloFlips(board, row, col, seat).length > 0) {
        moves.push({ row, col });
      }
    }
  }
  return moves;
}

function getOthelloFlips(
  board: Array<Array<number | null>>,
  row: number,
  col: number,
  seat: number
): BoardPosition[] {
  const opponent = seat === 0 ? 1 : 0;
  const columnCount = getColumnCount(board);
  const directions: Array<[number, number]> = [
    [-1, -1],
    [-1, 0],
    [-1, 1],
    [0, -1],
    [0, 1],
    [1, -1],
    [1, 0],
    [1, 1]
  ];
  const flips: BoardPosition[] = [];

  for (const [deltaRow, deltaCol] of directions) {
    const line: BoardPosition[] = [];
    let currentRow = row + deltaRow;
    let currentCol = col + deltaCol;

    while (
      currentRow >= 0 &&
      currentRow < board.length &&
      currentCol >= 0 &&
      currentCol < columnCount &&
      board[currentRow]?.[currentCol] === opponent
    ) {
      line.push({ row: currentRow, col: currentCol });
      currentRow += deltaRow;
      currentCol += deltaCol;
    }

    if (
      line.length > 0 &&
      currentRow >= 0 &&
      currentRow < board.length &&
      currentCol >= 0 &&
      currentCol < columnCount &&
      board[currentRow]?.[currentCol] === seat
    ) {
      flips.push(...line);
    }
  }

  return flips;
}

function countBoard(board: Array<Array<number | null>>): [number, number] {
  let first = 0;
  let second = 0;

  for (const row of board) {
    for (const cell of row) {
      if (cell === 0) {
        first += 1;
      } else if (cell === 1) {
        second += 1;
      }
    }
  }

  return [first, second];
}

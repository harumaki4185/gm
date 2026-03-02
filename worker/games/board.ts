import type {
  BoardPosition,
  ClientAction,
  Connect4View,
  PlacementBoardView
} from "../../src/shared/types";
import { AppError } from "../errors";
import type { Connect4State, PlacementState, RoomRecord } from "../types";
import { formatPlayerLabel, formatTurnMessage } from "./common";

const CONNECT4_WIN_LENGTH = 4;
const GOMOKU_WIN_LENGTH = 5;

export function createGomokuState(startingSeat: number): PlacementState {
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

export function createConnect4State(startingSeat: number): Connect4State {
  return {
    type: "connect4",
    board: createBoard(6, 7),
    currentSeat: startingSeat,
    winnerSeat: null,
    winningLine: [],
    statusMessage: `プレイヤー ${startingSeat + 1} の手番です`
  };
}

export function createOthelloState(startingSeat: number): PlacementState {
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

export function buildBoardView(room: RoomRecord, selfSeat: number | null): Connect4View | PlacementBoardView {
  const state = room.gameState;
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

  if (state.type !== "gomoku" && state.type !== "othello") {
    throw new AppError("盤面ゲームの view ではありません", 500);
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

export function applyConnect4Action(room: RoomRecord, seat: number, action: ClientAction): void {
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
  const winningLine = findWinningLine(state.board, row, action.col, seat, CONNECT4_WIN_LENGTH);
  if (winningLine.length > 0) {
    state.winnerSeat = seat;
    state.winningLine = winningLine;
    state.statusMessage = `${formatPlayerLabel(room, seat)} の勝ちです`;
    room.roomStatus = "finished";
    return;
  }

  if (isBoardFull(state.board)) {
    state.statusMessage = "引き分けです";
    room.roomStatus = "finished";
    return;
  }

  state.currentSeat = seat === 0 ? 1 : 0;
  state.statusMessage = formatTurnMessage(room, state.currentSeat, "の手番です");
}

export function applyPlacementAction(room: RoomRecord, seat: number, action: ClientAction): void {
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
    const winningLine = findWinningLine(state.board, action.row, action.col, seat, GOMOKU_WIN_LENGTH);
    if (winningLine.length > 0) {
      state.winnerSeat = seat;
      state.winningLine = winningLine;
      state.statusMessage = `${formatPlayerLabel(room, seat)} の勝ちです`;
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
    state.statusMessage = formatTurnMessage(room, state.currentSeat, "の手番です");
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
    state.statusMessage = formatTurnMessage(room, nextSeat, "の手番です");
    return;
  }

  const sameSeatMoves = getOthelloLegalMoves(state.board, seat);
  if (sameSeatMoves.length > 0) {
    state.currentSeat = seat;
    state.legalMoves = sameSeatMoves;
    state.statusMessage = `${formatPlayerLabel(room, nextSeat)} はパスです。${formatTurnMessage(room, seat, "の手番です")}`;
    return;
  }

  const counts = countBoard(state.board);
  state.winnerSeat = counts[0] === counts[1] ? null : counts[0] > counts[1] ? 0 : 1;
  state.legalMoves = [];
  state.statusMessage =
    state.winnerSeat === null ? "引き分けです" : `${formatPlayerLabel(room, state.winnerSeat)} の勝ちです`;
  room.roomStatus = "finished";
}

function createBoard(rows: number, cols: number): Array<Array<number | null>> {
  return Array.from({ length: rows }, () => Array.from({ length: cols }, () => null));
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

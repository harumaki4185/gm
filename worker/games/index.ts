import { GAME_MAP } from "../../src/shared/games";
import type { ClientAction, GameView } from "../../src/shared/types";
import { AppError } from "../errors";
import type { InternalGameState, RoomRecord } from "../types";
import {
  applyConnect4Action,
  applyPlacementAction,
  buildBoardView,
  createConnect4State,
  createGomokuState,
  createOthelloState
} from "./board";
import { formatWinnerMessage } from "./common";
import { applyJankenAction, buildJankenView, createJankenState } from "./janken";
import {
  advanceOldMaidBotTurns,
  applyOldMaidAction,
  buildOldMaidView,
  createOldMaidState
} from "./old-maid";
import {
  advanceSevensBotTurns,
  applySevensAction,
  buildSevensView,
  createSevensState
} from "./sevens";
import {
  advanceSpadesBotTurns,
  applySpadesAction,
  buildSpadesView,
  createSpadesState
} from "./spades";

export function buildWaitingState(gameId: keyof typeof GAME_MAP): InternalGameState {
  return {
    type: "planned",
    title: GAME_MAP[gameId].title,
    message: "参加プレイヤーを待っています。"
  };
}

export function createInitialGameState(gameId: keyof typeof GAME_MAP, seatCount: number): InternalGameState {
  const startingSeat = Math.random() >= 0.5 ? 1 : 0;

  if (gameId === "janken") {
    return createJankenState(seatCount);
  }

  if (gameId === "gomoku") {
    return createGomokuState(startingSeat);
  }

  if (gameId === "connect4") {
    return createConnect4State(startingSeat);
  }

  if (gameId === "othello") {
    return createOthelloState(startingSeat);
  }

  if (gameId === "old-maid") {
    return createOldMaidState(seatCount);
  }

  if (gameId === "sevens") {
    return createSevensState(seatCount);
  }

  if (gameId === "spades") {
    return createSpadesState(seatCount);
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

  if (room.gameState.type === "sevens") {
    applySevensAction(room, seat, action);
    return;
  }

  if (room.gameState.type === "spades") {
    applySpadesAction(room, seat, action);
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
  const requiredHumans =
    room.settings.fillWithBots && game.supportsBots ? game.minHumanPlayers : room.settings.seatCount;

  if (room.roomStatus === "waiting") {
    return {
      kind: "waiting",
      message: "参加プレイヤーを待っています。",
      requiredHumans,
      connectedHumans,
      totalSeats: room.settings.seatCount,
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

  if (state.type === "sevens") {
    return buildSevensView(room, state, selfSeat);
  }

  if (state.type === "spades") {
    return buildSpadesView(room, state, selfSeat);
  }

  return buildBoardView(room, selfSeat);
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

  if (room.gameState.type === "sevens" || room.gameState.type === "spades") {
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
      room.roomStatus === "waiting" ? "参加プレイヤーを待っています。" : room.gameState.message;
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

  if (room.gameState.type === "sevens") {
    if (room.gameState.currentSeat === null) {
      return;
    }
    room.gameState.statusMessage = `プレイヤー ${room.gameState.currentSeat + 1} がカードを出す番です`;
    return;
  }

  if (room.gameState.type === "spades") {
    if (room.gameState.stage === "finished" || room.gameState.currentSeat === null) {
      return;
    }
    room.gameState.statusMessage =
      room.gameState.stage === "bidding"
        ? `プレイヤー ${room.gameState.currentSeat + 1} がビッドする番です`
        : `プレイヤー ${room.gameState.currentSeat + 1} がカードを出す番です`;
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
  const remainingSeats = room.players
    .filter((player) => player.seat !== disconnectedSeat)
    .map((player) => player.seat)
    .sort((left, right) => left - right);

  if (room.gameState.type === "planned") {
    room.gameState.message = "対戦相手の切断によりルームを終了しました。";
    return;
  }

  if (room.gameState.type === "janken") {
    room.gameState.phase = "finished";
    room.gameState.winnerSeats = remainingSeats;
    room.gameState.resultMessage = formatWinnerMessage(remainingSeats, "不戦勝です");
    return;
  }

  if (room.gameState.type === "old-maid") {
    room.gameState.winnerSeats = remainingSeats;
    room.gameState.loserSeat = disconnectedSeat;
    room.gameState.statusMessage = formatWinnerMessage(remainingSeats, "不戦勝です");
    return;
  }

  if (room.gameState.type === "sevens") {
    room.gameState.currentSeat = null;
    room.gameState.winnerSeats = remainingSeats;
    room.gameState.statusMessage = formatWinnerMessage(remainingSeats, "不戦勝です");
    return;
  }

  if (room.gameState.type === "spades") {
    const winningTeam = disconnectedSeat % 2 === 0 ? 1 : 0;
    room.gameState.stage = "finished";
    room.gameState.currentSeat = null;
    room.gameState.winnerSeats = room.players
      .filter((player) => player.team === winningTeam)
      .map((player) => player.seat)
      .sort((left, right) => left - right);
    room.gameState.statusMessage = formatWinnerMessage(room.gameState.winnerSeats, "不戦勝です");
    return;
  }

  const winnerSeat = remainingSeats[0] ?? null;
  room.gameState.winnerSeat = winnerSeat;
  room.gameState.statusMessage =
    winnerSeat === null ? "ルームを終了しました" : `プレイヤー ${winnerSeat + 1} の不戦勝です`;
}

export function advanceAutomatedTurns(room: RoomRecord): void {
  if (room.roomStatus !== "playing") {
    return;
  }

  if (room.gameState.type === "old-maid") {
    advanceOldMaidBotTurns(room);
    return;
  }

  if (room.gameState.type === "sevens") {
    advanceSevensBotTurns(room);
    return;
  }

  if (room.gameState.type === "spades") {
    advanceSpadesBotTurns(room);
  }
}

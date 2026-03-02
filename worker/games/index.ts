import { GAME_MAP } from "../../src/shared/games";
import type { ClientAction, GameView } from "../../src/shared/types";
import { AppError } from "../errors";
import type { InternalGameState, RoomRecord } from "../types";
import {
  advanceBoardBotTurns,
  applyConnect4Action,
  applyPlacementAction,
  buildBoardView,
  createConnect4State,
  createGomokuState,
  createOthelloState
} from "./board";
import { formatPlayerLabel, formatTurnMessage, formatWinnerMessage } from "./common";
import {
  advanceJankenBotTurns,
  applyJankenAction,
  buildJankenView,
  createJankenState
} from "./janken";
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
  const joinedHumans = room.players.filter((player) => player.playerType === "human").length;
  const availableBotSlots = Math.max(0, room.settings.seatCount - joinedHumans);
  const botCount = game.supportsBots ? Math.min(room.settings.botCount, availableBotSlots) : 0;
  const startPlayerCount = joinedHumans + botCount;
  const canStart =
    joinedHumans >= game.minHumanPlayers &&
    startPlayerCount >= game.minSeats &&
    startPlayerCount <= game.maxSeats &&
    (game.minSeats !== game.maxSeats || startPlayerCount === game.maxSeats);

  if (room.roomStatus === "waiting") {
    return {
      kind: "waiting",
      message: "参加プレイヤーを待っています。",
      joinedHumans,
      totalSeats: room.settings.seatCount,
      botCount,
      supportsBots: game.supportsBots,
      minSeats: game.minSeats,
      maxSeats: game.maxSeats,
      minHumanPlayers: game.minHumanPlayers,
      startPlayerCount,
      canStart
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
    room.gameState.statusMessage = formatTurnMessage(room, room.gameState.currentSeat, "がカードを引く番です");
    return;
  }

  if (room.gameState.type === "sevens") {
    if (room.gameState.currentSeat === null) {
      return;
    }
    room.gameState.statusMessage = formatTurnMessage(room, room.gameState.currentSeat, "がカードを出す番です");
    return;
  }

  if (room.gameState.type === "spades") {
    if (room.gameState.stage === "finished" || room.gameState.currentSeat === null) {
      return;
    }
    room.gameState.statusMessage =
      room.gameState.stage === "bidding"
        ? formatTurnMessage(room, room.gameState.currentSeat, "がビッドする番です")
        : formatTurnMessage(room, room.gameState.currentSeat, "がカードを出す番です");
    return;
  }

  if (room.gameState.type === "connect4") {
    room.gameState.statusMessage = formatTurnMessage(room, room.gameState.currentSeat, "の手番です");
    return;
  }

  room.gameState.statusMessage = formatTurnMessage(room, room.gameState.currentSeat, "の手番です");
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
    room.gameState.resultMessage = formatWinnerMessage(room, remainingSeats, "不戦勝です");
    return;
  }

  if (room.gameState.type === "old-maid") {
    room.gameState.winnerSeats = remainingSeats;
    room.gameState.loserSeat = disconnectedSeat;
    room.gameState.statusMessage = formatWinnerMessage(room, remainingSeats, "不戦勝です");
    return;
  }

  if (room.gameState.type === "sevens") {
    room.gameState.currentSeat = null;
    room.gameState.winnerSeats = remainingSeats;
    room.gameState.statusMessage = formatWinnerMessage(room, remainingSeats, "不戦勝です");
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
    room.gameState.statusMessage = formatWinnerMessage(room, room.gameState.winnerSeats, "不戦勝です");
    return;
  }

  const winnerSeat = remainingSeats[0] ?? null;
  room.gameState.winnerSeat = winnerSeat;
  room.gameState.statusMessage =
    winnerSeat === null ? "ルームを終了しました" : `${formatPlayerLabel(room, winnerSeat)} の不戦勝です`;
}

export function advanceAutomatedTurns(room: RoomRecord): void {
  if (room.roomStatus !== "playing") {
    return;
  }

  if (room.gameState.type === "janken") {
    advanceJankenBotTurns(room);
    return;
  }

  if (
    room.gameState.type === "connect4" ||
    room.gameState.type === "gomoku" ||
    room.gameState.type === "othello"
  ) {
    advanceBoardBotTurns(room);
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

import type { ClientAction, JankenChoice, JankenView } from "../../src/shared/types";
import { AppError } from "../errors";
import type { JankenState, RoomRecord } from "../types";
import { formatWinnerMessage } from "./common";

const JANKEN_CHOICES: JankenChoice[] = ["rock", "paper", "scissors"];

export function createJankenState(seatCount: number): JankenState {
  return {
    type: "janken",
    phase: "playing",
    round: 1,
    selections: Array.from({ length: seatCount }, () => null),
    revealedSelections: null,
    winnerSeats: [],
    resultMessage: "手を選んでください"
  };
}

export function buildJankenView(room: RoomRecord, state: JankenState, selfSeat: number | null): JankenView {
  const displaySelections =
    state.phase === "finished" || state.selections.some((choice) => choice !== null)
      ? state.selections
      : state.revealedSelections ?? state.selections;
  const selections = displaySelections.map((choice, index) => {
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
      selfSeat < state.selections.length &&
      state.selections[selfSeat] === null,
    choices: JANKEN_CHOICES,
    selections,
    resultMessage: state.resultMessage,
    currentSeat: null,
    winnerSeats: state.winnerSeats
  };
}

export function applyJankenAction(room: RoomRecord, seat: number, action: ClientAction): void {
  const state = room.gameState;
  if (state.type !== "janken") {
    throw new AppError("janken state ではありません", 500);
  }
  if (action.type !== "choose_rps") {
    throw new AppError("この操作はじゃんけんでは無効です", 400);
  }
  if (seat < 0 || seat >= state.selections.length) {
    throw new AppError("人間プレイヤーの席が不正です", 400);
  }
  if (state.phase !== "playing") {
    throw new AppError("このラウンドは終了しています", 409);
  }
  if (state.selections[seat] !== null) {
    throw new AppError("すでに手を選択済みです", 409);
  }

  state.revealedSelections = null;
  state.selections[seat] = action.choice;
  resolveJankenState(room, state);
}

export function advanceJankenBotTurns(room: RoomRecord): void {
  if (room.roomStatus !== "playing" || room.gameState.type !== "janken" || room.gameState.phase !== "playing") {
    return;
  }

  let updated = false;
  for (let seat = 0; seat < room.gameState.selections.length; seat += 1) {
    if (room.gameState.selections[seat] !== null) {
      continue;
    }

    const player = room.players.find((entry) => entry.seat === seat);
    if (!player || player.playerType !== "bot") {
      continue;
    }

    room.gameState.selections[seat] = JANKEN_CHOICES[Math.floor(Math.random() * JANKEN_CHOICES.length)];
    updated = true;
  }

  if (!updated) {
    return;
  }

  resolveJankenState(room, room.gameState);
}

function resolveJankenState(room: RoomRecord, state: JankenState): void {
  if (state.selections.some((choice) => choice === null)) {
    state.resultMessage = "他のプレイヤーの入力を待っています";
    return;
  }

  const winnerSeats = resolveJanken(state.selections as JankenChoice[]);
  if (winnerSeats.length === 0) {
    state.revealedSelections = [...state.selections];
    state.round += 1;
    state.selections = Array.from({ length: state.selections.length }, () => null);
    state.winnerSeats = [];
    state.resultMessage = `あいこです。Round ${state.round} を始めます`;
    return;
  }

  state.phase = "finished";
  state.revealedSelections = [...state.selections];
  state.winnerSeats = winnerSeats;
  state.resultMessage = formatWinnerMessage(room, winnerSeats, "勝ちです");
  room.roomStatus = "finished";
}

function resolveJanken(selections: JankenChoice[]): number[] {
  const presentChoices = new Set(selections);
  if (presentChoices.size !== 2) {
    return [];
  }

  const [first, second] = [...presentChoices] as [JankenChoice, JankenChoice];
  const winningChoice = resolveWinningChoice(first, second);
  return selections
    .map((choice, seat) => ({ choice, seat }))
    .filter((entry) => entry.choice === winningChoice)
    .map((entry) => entry.seat);
}

function resolveWinningChoice(first: JankenChoice, second: JankenChoice): JankenChoice {
  if (
    (first === "rock" && second === "scissors") ||
    (first === "scissors" && second === "paper") ||
    (first === "paper" && second === "rock")
  ) {
    return first;
  }
  return second;
}

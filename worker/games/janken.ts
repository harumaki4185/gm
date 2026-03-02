import type { ClientAction, JankenChoice, JankenView } from "../../src/shared/types";
import { AppError } from "../errors";
import type { JankenState, RoomRecord } from "../types";
import { formatWinnerMessage } from "./common";

export function createJankenState(seatCount: number): JankenState {
  return {
    type: "janken",
    phase: "playing",
    round: 1,
    selections: Array.from({ length: seatCount }, () => null),
    winnerSeats: [],
    resultMessage: "手を選んでください"
  };
}

export function buildJankenView(room: RoomRecord, state: JankenState, selfSeat: number | null): JankenView {
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
      selfSeat < state.selections.length &&
      state.selections[selfSeat] === null,
    choices: ["rock", "paper", "scissors"],
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

  state.selections[seat] = action.choice;

  if (state.selections.some((choice) => choice === null)) {
    state.resultMessage = "他のプレイヤーの入力を待っています";
    return;
  }

  const winnerSeats = resolveJanken(state.selections as JankenChoice[]);
  if (winnerSeats.length === 0) {
    state.round += 1;
    state.selections = Array.from({ length: state.selections.length }, () => null);
    state.winnerSeats = [];
    state.resultMessage = `あいこです。Round ${state.round} を始めます`;
    return;
  }

  state.phase = "finished";
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

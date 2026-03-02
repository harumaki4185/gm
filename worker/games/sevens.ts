import {
  CARD_SUITS,
  compareCards,
  createStandardDeck,
  formatCardLabel,
  getCardRankValue,
  getCardSuit,
  shuffle,
  sortCards
} from "../../src/shared/cards";
import type {
  ClientAction,
  SevensPlayerView,
  SevensSuitRangeView,
  SevensView
} from "../../src/shared/types";
import { AppError } from "../errors";
import type { RoomRecord, SevensState } from "../types";
import {
  formatPlacementSummary,
  formatPlayerLabel,
  formatTurnMessage,
  formatWinnerMessage
} from "./common";

const MAX_BOT_ITERATIONS = 200;

export function createSevensState(seatCount: number): SevensState {
  const deck = shuffle(createStandardDeck());
  const hands: string[][] = Array.from({ length: seatCount }, () => []);

  deck.forEach((card, index) => {
    hands[index % seatCount].push(card);
  });

  for (const hand of hands) {
    for (let index = hand.length - 1; index >= 0; index -= 1) {
      if (getCardRankValue(hand[index]) === 7) {
        hand.splice(index, 1);
      }
    }
  }

  const candidateSeats = hands
    .map((hand, seat) => ({ hand, seat }))
    .filter((entry) => getLegalSevensCardsForHand(entry.hand).length > 0)
    .map((entry) => entry.seat);
  const startingSeat = candidateSeats[Math.floor(Math.random() * candidateSeats.length)] ?? 0;

  return {
    type: "sevens",
    hands,
    currentSeat: startingSeat,
    winnerSeats: [],
    placements: [],
    suitRanges: {
      S: { low: 7, high: 7 },
      H: { low: 7, high: 7 },
      D: { low: 7, high: 7 },
      C: { low: 7, high: 7 }
    },
    passCounts: Array.from({ length: seatCount }, () => 0),
    statusMessage: `プレイヤー ${startingSeat + 1} がカードを出す番です`,
    lastAction: "7 を場に並べました"
  };
}

export function buildSevensView(room: RoomRecord, state: SevensState, selfSeat: number | null): SevensView {
  const players: SevensPlayerView[] = room.players
    .slice()
    .sort((left, right) => left.seat - right.seat)
    .map((player) => ({
      seat: player.seat,
      name: player.name,
      cardCount: state.hands[player.seat]?.length ?? 0,
      passCount: state.passCounts[player.seat] ?? 0,
      isCurrent: state.currentSeat === player.seat,
      isWinner: state.winnerSeats.includes(player.seat),
      placement: getSevensPlacement(state, player.seat)
    }));
  const suits: SevensSuitRangeView[] = CARD_SUITS.map((suit) => ({
    suit,
    low: state.suitRanges[suit].low,
    high: state.suitRanges[suit].high
  }));
  const legalCards =
    selfSeat !== null && room.roomStatus === "playing" && selfSeat === state.currentSeat
      ? getLegalSevensCards(state, selfSeat)
      : [];

  return {
    kind: "sevens",
    canAct: room.roomStatus === "playing" && selfSeat !== null && selfSeat === state.currentSeat,
    currentSeat: state.currentSeat,
    winnerSeats: state.winnerSeats,
    statusMessage: state.statusMessage,
    lastAction: state.lastAction,
    selfHand: selfSeat === null ? [] : sortCards(state.hands[selfSeat] ?? []),
    legalCards,
    suits,
    players,
    placements: [...state.placements]
  };
}

export function applySevensAction(room: RoomRecord, seat: number, action: ClientAction): void {
  const state = room.gameState;
  if (state.type !== "sevens") {
    throw new AppError("sevens state ではありません", 500);
  }
  if (state.currentSeat !== seat) {
    throw new AppError("あなたの手番ではありません", 403);
  }

  const legalCards = getLegalSevensCards(state, seat);

  if (action.type === "pass_sevens") {
    if (legalCards.length > 0) {
      throw new AppError("出せるカードがあるためパスできません", 409);
    }

    state.passCounts[seat] = (state.passCounts[seat] ?? 0) + 1;
    state.lastAction = `${formatPlayerLabel(room, seat)} がパスしました`;
    if (!hasAnyPlayableSevensCard(state)) {
      room.roomStatus = "finished";
      state.currentSeat = null;
      state.winnerSeats = [];
      finalizeSevensPlacements(room, state, getRemainingSevensSeats(state));
      state.statusMessage = `これ以上出せるカードがないため終了しました。${formatPlacementSummary(room, state.placements)}`;
      return;
    }
    moveToNextSevensTurn(room, state, seat);
    return;
  }

  if (action.type !== "play_card") {
    throw new AppError("この操作は七並べでは無効です", 400);
  }

  if (!legalCards.includes(action.card)) {
    throw new AppError("そのカードは出せません", 409);
  }

  const hand = state.hands[seat] ?? [];
  const cardIndex = hand.indexOf(action.card);
  if (cardIndex < 0) {
    throw new AppError("そのカードは手札にありません", 409);
  }

  hand.splice(cardIndex, 1);
  expandSevensRange(state, action.card);
  state.lastAction = `${formatPlayerLabel(room, seat)} が ${formatCardLabel(action.card)} を出しました`;

  if (hand.length === 0) {
    recordSevensPlacement(state, seat);
    state.lastAction = `${formatPlayerLabel(room, seat)} が ${state.placements.length} 位であがりました`;
    const remainingSeats = getRemainingSevensSeats(state);
    if (remainingSeats.length <= 1) {
      room.roomStatus = "finished";
      state.currentSeat = null;
      finalizeSevensPlacements(room, state, remainingSeats);
      state.statusMessage = `順位確定: ${formatPlacementSummary(room, state.placements)}`;
      return;
    }
  }

  if (!hasAnyPlayableSevensCard(state)) {
    room.roomStatus = "finished";
    state.currentSeat = null;
    state.winnerSeats = [];
    finalizeSevensPlacements(room, state, getRemainingSevensSeats(state));
    state.statusMessage = `これ以上出せるカードがないため終了しました。${formatPlacementSummary(room, state.placements)}`;
    return;
  }

  moveToNextSevensTurn(room, state, seat);
}

export function advanceSevensBotTurns(room: RoomRecord): void {
  if (room.roomStatus !== "playing" || room.gameState.type !== "sevens") {
    return;
  }

  let iterations = 0;
  while (room.roomStatus === "playing") {
    iterations += 1;
    if (iterations > MAX_BOT_ITERATIONS) {
      room.roomStatus = "finished";
      room.gameState.currentSeat = null;
      room.gameState.winnerSeats = [];
      finalizeSevensPlacements(room, room.gameState, getRemainingSevensSeats(room.gameState));
      room.gameState.statusMessage = "bot の自動進行が上限に達したため終了しました";
      return;
    }

    const currentSeat = room.gameState.currentSeat;
    if (currentSeat === null) {
      return;
    }

    const player = room.players.find((entry) => entry.seat === currentSeat);
    if (!player || player.playerType !== "bot") {
      return;
    }

    const legalCards = getLegalSevensCards(room.gameState, currentSeat);
    if (legalCards.length === 0) {
      applySevensAction(room, currentSeat, { type: "pass_sevens" });
      continue;
    }

    applySevensAction(room, currentSeat, {
      type: "play_card",
      card: pickSevensBotCard(legalCards)
    });
  }
}

function getLegalSevensCards(state: SevensState, seat: number): string[] {
  return getLegalSevensCardsForHand(state.hands[seat] ?? [], state.suitRanges);
}

function getLegalSevensCardsForHand(
  hand: readonly string[],
  suitRanges: SevensState["suitRanges"] = {
    S: { low: 7, high: 7 },
    H: { low: 7, high: 7 },
    D: { low: 7, high: 7 },
    C: { low: 7, high: 7 }
  }
): string[] {
  return hand.filter((card) => isLegalSevensCard(card, suitRanges));
}

function isLegalSevensCard(card: string, suitRanges: SevensState["suitRanges"]): boolean {
  const suit = getCardSuit(card);
  if (!suit) {
    return false;
  }

  const rank = getCardRankValue(card);
  const range = suitRanges[suit];
  return rank === range.low - 1 || rank === range.high + 1;
}

function expandSevensRange(state: SevensState, card: string): void {
  const suit = getCardSuit(card);
  if (!suit) {
    throw new AppError("そのカードは七並べで使えません", 409);
  }

  const rank = getCardRankValue(card);
  const range = state.suitRanges[suit];
  if (rank === range.low - 1) {
    range.low = rank;
    return;
  }
  if (rank === range.high + 1) {
    range.high = rank;
    return;
  }

  throw new AppError("そのカードは出せません", 409);
}

function moveToNextSevensTurn(room: RoomRecord, state: SevensState, seat: number): void {
  const nextSeat = getNextSevensSeat(state, seat);
  if (nextSeat === null) {
    room.roomStatus = "finished";
    state.currentSeat = null;
    finalizeSevensPlacements(room, state, getRemainingSevensSeats(state));
    state.statusMessage = state.placements.length > 0 ? `順位確定: ${formatPlacementSummary(room, state.placements)}` : "引き分けです";
    return;
  }

  state.currentSeat = nextSeat;
  state.statusMessage = formatTurnMessage(room, nextSeat, "がカードを出す番です");
}

function getNextSevensSeat(state: SevensState, seat: number): number | null {
  for (let offset = 1; offset < state.hands.length; offset += 1) {
    const candidate = (seat + offset) % state.hands.length;
    if ((state.hands[candidate]?.length ?? 0) > 0 && getSevensPlacement(state, candidate) === null) {
      return candidate;
    }
  }
  return null;
}

function hasAnyPlayableSevensCard(state: SevensState): boolean {
  return state.hands.some(
    (hand, seat) =>
      hand.length > 0 && getSevensPlacement(state, seat) === null && getLegalSevensCardsForHand(hand, state.suitRanges).length > 0
  );
}

function recordSevensPlacement(state: SevensState, seat: number): void {
  if (getSevensPlacement(state, seat) === null) {
    state.placements.push(seat);
  }
}

function getRemainingSevensSeats(state: SevensState): number[] {
  return state.hands
    .map((hand, seat) => ({ hand, seat }))
    .filter((entry) => entry.hand.length > 0 && getSevensPlacement(state, entry.seat) === null)
    .map((entry) => entry.seat);
}

function finalizeSevensPlacements(room: RoomRecord, state: SevensState, trailingSeats: number[]): void {
  for (const seat of trailingSeats) {
    recordSevensPlacement(state, seat);
  }
  state.winnerSeats = state.placements.length > 0 ? [state.placements[0]] : [];
  if (state.winnerSeats.length > 0 && trailingSeats.length === 0 && state.placements.length === 1) {
    state.statusMessage = formatWinnerMessage(room, state.winnerSeats, "勝ちです");
  }
}

function getSevensPlacement(state: SevensState, seat: number): number | null {
  const index = state.placements.indexOf(seat);
  return index >= 0 ? index + 1 : null;
}

function pickSevensBotCard(legalCards: readonly string[]): string {
  return legalCards
    .slice()
    .sort((left, right) => {
      const leftDistance = Math.abs(getCardRankValue(left) - 7);
      const rightDistance = Math.abs(getCardRankValue(right) - 7);
      if (leftDistance !== rightDistance) {
        return rightDistance - leftDistance;
      }
      return compareCards(left, right);
    })[0];
}

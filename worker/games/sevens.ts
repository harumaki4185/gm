import {
  CARD_SUITS,
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
import { formatPlayerLabel, formatWinnerMessage } from "./common";

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
      isWinner: state.winnerSeats.includes(player.seat)
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
    players
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
    room.roomStatus = "finished";
    state.currentSeat = null;
    state.winnerSeats = [seat];
    state.statusMessage = formatWinnerMessage([seat], "勝ちです");
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
    state.winnerSeats = [];
    state.statusMessage = "引き分けです";
    return;
  }

  state.currentSeat = nextSeat;
  state.statusMessage = `プレイヤー ${nextSeat + 1} がカードを出す番です`;
}

function getNextSevensSeat(state: SevensState, seat: number): number | null {
  for (let offset = 1; offset < state.hands.length; offset += 1) {
    const candidate = (seat + offset) % state.hands.length;
    if ((state.hands[candidate]?.length ?? 0) > 0) {
      return candidate;
    }
  }
  return null;
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
      return sortCards([left, right])[0] === left ? -1 : 1;
    })[0];
}

import {
  createStandardDeck,
  getCardRank,
  shuffle,
  sortCards
} from "../../src/shared/cards";
import type {
  ClientAction,
  OldMaidOpponentView,
  OldMaidView
} from "../../src/shared/types";
import { AppError } from "../errors";
import type { OldMaidState, RoomRecord } from "../types";
import { formatPlayerLabel, formatWinnerMessage } from "./common";

const MAX_BOT_ITERATIONS = 100;

type OldMaidResolution = { kind: "resolved"; winnerSeats: number[]; loserSeat: number } | { kind: "draw" } | null;

export function createOldMaidState(seatCount: number): OldMaidState {
  const deck = shuffle(createStandardDeck({ includeJoker: true }));
  const hands: string[][] = Array.from({ length: seatCount }, () => []);

  deck.forEach((card, index) => {
    hands[index % seatCount].push(card);
  });

  for (const hand of hands) {
    collapsePairs(hand);
  }

  const activeSeats = hands
    .map((hand, seat) => ({ hand, seat }))
    .filter((entry) => entry.hand.length > 0)
    .map((entry) => entry.seat);
  const startingSeat = activeSeats[Math.floor(Math.random() * activeSeats.length)] ?? 0;
  const state: OldMaidState = {
    type: "old-maid",
    hands,
    currentSeat: startingSeat,
    winnerSeats: [],
    loserSeat: null,
    statusMessage: `プレイヤー ${startingSeat + 1} がカードを引く番です`,
    lastAction: "配札を行いました"
  };

  const result = resolveOldMaidWinner(state);
  if (result !== null) {
    if (result.kind === "draw") {
      state.winnerSeats = [];
      state.loserSeat = null;
      state.statusMessage = "引き分けです";
    } else {
      state.winnerSeats = result.winnerSeats;
      state.loserSeat = result.loserSeat;
      state.statusMessage = formatWinnerMessage(result.winnerSeats, "勝ちです");
    }
  }

  return state;
}

export function buildOldMaidView(room: RoomRecord, state: OldMaidState, selfSeat: number | null): OldMaidView {
  const sourceSeat =
    selfSeat !== null && room.roomStatus === "playing" && selfSeat === state.currentSeat
      ? getOldMaidSourceSeat(state, selfSeat)
      : null;
  const opponents: OldMaidOpponentView[] = room.players
    .filter((player) => player.seat !== selfSeat)
    .sort((left, right) => left.seat - right.seat)
    .map((player) => {
      const hand = state.hands[player.seat] ?? [];
      const isCurrentTarget = sourceSeat === player.seat;
      return {
        seat: player.seat,
        name: player.name,
        cardCount: hand.length,
        isCurrentTarget,
        hasFinished: hand.length === 0,
        targetableSlots: isCurrentTarget ? shuffle(Array.from({ length: hand.length }, (_, index) => index)) : []
      };
    });

  if (selfSeat === null) {
    return {
      kind: "old-maid",
      canAct: false,
      currentSeat: state.currentSeat,
      winnerSeats: state.winnerSeats,
      loserSeat: state.loserSeat,
      statusMessage: state.statusMessage,
      selfHand: [],
      opponents,
      lastAction: state.lastAction
    };
  }

  return {
    kind: "old-maid",
    canAct:
      room.roomStatus === "playing" &&
      selfSeat === state.currentSeat &&
      sourceSeat !== null &&
      (state.hands[sourceSeat]?.length ?? 0) > 0,
    currentSeat: state.currentSeat,
    winnerSeats: state.winnerSeats,
    loserSeat: state.loserSeat,
    statusMessage: state.statusMessage,
    selfHand: sortCards(state.hands[selfSeat] ?? []),
    opponents,
    lastAction: state.lastAction
  };
}

export function applyOldMaidAction(room: RoomRecord, seat: number, action: ClientAction): void {
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

  const sourceSeat = getOldMaidSourceSeat(state, seat);
  if (sourceSeat === null) {
    throw new AppError("引ける相手がいません", 409);
  }

  const sourceHand = state.hands[sourceSeat] ?? [];
  if (action.targetIndex < 0 || action.targetIndex >= sourceHand.length) {
    throw new AppError("そのカードは引けません", 409);
  }

  const drawnCard = sourceHand.splice(action.targetIndex, 1)[0];
  if (!drawnCard) {
    throw new AppError("そのカードは引けません", 409);
  }
  state.hands[seat].push(drawnCard);
  const removedPairs = collapsePairs(state.hands[seat]);
  const actorName = formatPlayerLabel(room, seat);
  const opponentName = formatPlayerLabel(room, sourceSeat);
  state.lastAction =
    removedPairs > 0
      ? `${actorName} が ${opponentName} から 1 枚引き、${removedPairs} 組のペアを捨てました`
      : `${actorName} が ${opponentName} から 1 枚引きました`;

  const result = resolveOldMaidWinner(state);
  if (result !== null) {
    room.roomStatus = "finished";
    if (result.kind === "draw") {
      state.winnerSeats = [];
      state.loserSeat = null;
      state.statusMessage = "引き分けです";
      return;
    }
    state.winnerSeats = result.winnerSeats;
    state.loserSeat = result.loserSeat;
    state.statusMessage = formatWinnerMessage(result.winnerSeats, "勝ちです");
    return;
  }

  const nextSeat = getNextOldMaidTurnSeat(state, seat);
  if (nextSeat === null) {
    room.roomStatus = "finished";
    state.winnerSeats = [];
    state.loserSeat = null;
    state.statusMessage = "引き分けです";
    return;
  }

  state.currentSeat = nextSeat;
  state.statusMessage = `プレイヤー ${nextSeat + 1} がカードを引く番です`;
}

export function advanceOldMaidBotTurns(room: RoomRecord): void {
  if (room.roomStatus !== "playing" || room.gameState.type !== "old-maid") {
    return;
  }

  let iterations = 0;
  while (room.roomStatus === "playing") {
    iterations += 1;
    if (iterations > MAX_BOT_ITERATIONS) {
      room.roomStatus = "finished";
      room.gameState.winnerSeats = [];
      room.gameState.loserSeat = null;
      room.gameState.statusMessage = "bot の自動進行が上限に達したため終了しました";
      return;
    }

    const currentSeat = room.gameState.currentSeat;
    const currentPlayer = room.players.find((player) => player.seat === currentSeat);
    if (!currentPlayer || currentPlayer.playerType !== "bot") {
      return;
    }

    const sourceSeat = getOldMaidSourceSeat(room.gameState, currentSeat);
    if (sourceSeat === null) {
      const result = resolveOldMaidWinner(room.gameState);
      if (result?.kind === "resolved") {
        room.gameState.winnerSeats = result.winnerSeats;
        room.gameState.loserSeat = result.loserSeat;
        room.gameState.statusMessage = formatWinnerMessage(result.winnerSeats, "勝ちです");
        room.roomStatus = "finished";
      } else if (result?.kind === "draw") {
        room.gameState.winnerSeats = [];
        room.gameState.loserSeat = null;
        room.gameState.statusMessage = "引き分けです";
        room.roomStatus = "finished";
      }
      return;
    }

    const sourceHand = room.gameState.hands[sourceSeat] ?? [];
    if (sourceHand.length === 0) {
      return;
    }

    applyOldMaidAction(room, currentSeat, {
      type: "draw_old_maid",
      targetIndex: Math.floor(Math.random() * sourceHand.length)
    });
  }
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

function resolveOldMaidWinner(state: OldMaidState): OldMaidResolution {
  const activeSeats = getActiveOldMaidSeats(state);
  if (activeSeats.length === 0) {
    state.statusMessage = "引き分けです";
    state.loserSeat = null;
    return { kind: "draw" };
  }
  if (activeSeats.length === 1) {
    const loserSeat = activeSeats[0];
    return {
      kind: "resolved",
      loserSeat,
      winnerSeats: state.hands
        .map((_, seat) => seat)
        .filter((entrySeat) => entrySeat !== loserSeat)
    };
  }
  return null;
}

function getActiveOldMaidSeats(state: OldMaidState): number[] {
  return state.hands
    .map((hand, seat) => ({ hand, seat }))
    .filter((entry) => entry.hand.length > 0)
    .map((entry) => entry.seat);
}

function getOldMaidSourceSeat(state: OldMaidState, seat: number): number | null {
  if ((state.hands[seat]?.length ?? 0) === 0) {
    return null;
  }
  for (let offset = 1; offset < state.hands.length; offset += 1) {
    const candidate = (seat - offset + state.hands.length) % state.hands.length;
    if ((state.hands[candidate]?.length ?? 0) > 0) {
      return candidate;
    }
  }
  return null;
}

function getNextOldMaidTurnSeat(state: OldMaidState, seat: number): number | null {
  for (let offset = 1; offset < state.hands.length; offset += 1) {
    const candidate = (seat + offset) % state.hands.length;
    if ((state.hands[candidate]?.length ?? 0) > 0) {
      return candidate;
    }
  }
  return null;
}

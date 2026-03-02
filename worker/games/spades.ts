import {
  createStandardDeck,
  formatCardLabel,
  getCardRankValue,
  getCardSuit,
  shuffle,
  sortCards
} from "../../src/shared/cards";
import type {
  ClientAction,
  SpadesPlayerView,
  SpadesTeamView,
  SpadesTrickCardView,
  SpadesView
} from "../../src/shared/types";
import { AppError } from "../errors";
import type { RoomRecord, SpadesState } from "../types";
import { formatPlayerLabel, formatWinnerMessage } from "./common";

const MAX_BOT_ITERATIONS = 300;
const SPADES_SUIT_ORDER = ["C", "D", "H", "S"] as const;

export function createSpadesState(seatCount: number): SpadesState {
  if (seatCount !== 4) {
    throw new AppError("スペードは 4 人固定です", 400);
  }

  const deck = shuffle(createStandardDeck());
  const hands: string[][] = Array.from({ length: seatCount }, () => []);
  deck.forEach((card, index) => {
    hands[index % seatCount].push(card);
  });

  const dealerSeat = Math.floor(Math.random() * seatCount);
  const currentSeat = (dealerSeat + 1) % seatCount;

  return {
    type: "spades",
    stage: "bidding",
    hands,
    currentSeat,
    dealerSeat,
    bids: Array.from({ length: seatCount }, () => null),
    tricksWon: Array.from({ length: seatCount }, () => 0),
    currentTrick: [],
    completedTricks: 0,
    spadesBroken: false,
    winnerSeats: [],
    teamScores: [0, 0],
    statusMessage: `プレイヤー ${currentSeat + 1} がビッドする番です`,
    lastAction: "配札を行いました"
  };
}

export function buildSpadesView(room: RoomRecord, state: SpadesState, selfSeat: number | null): SpadesView {
  const players: SpadesPlayerView[] = room.players
    .slice()
    .sort((left, right) => left.seat - right.seat)
    .map((player) => ({
      seat: player.seat,
      name: player.name,
      cardCount: state.hands[player.seat]?.length ?? 0,
      bid: state.bids[player.seat],
      tricksWon: state.tricksWon[player.seat] ?? 0,
      team: player.team,
      isCurrent: state.currentSeat === player.seat
    }));
  const teams: SpadesTeamView[] = [0, 1].map((team) => {
    const members = room.players
      .filter((player) => player.team === team)
      .map((player) => player.seat)
      .sort((left, right) => left - right);
    return {
      team,
      bid: getTeamBid(state, team),
      tricksWon: getTeamTricksWon(state, team),
      score: state.teamScores[team] ?? 0,
      members
    };
  });
  const currentTrick: SpadesTrickCardView[] = room.players
    .slice()
    .sort((left, right) => left.seat - right.seat)
    .map((player) => ({
      seat: player.seat,
      card: state.currentTrick.find((entry) => entry.seat === player.seat)?.card ?? null
    }));
  const legalCards =
    selfSeat !== null &&
    room.roomStatus === "playing" &&
    state.stage === "playing" &&
    selfSeat === state.currentSeat
      ? getLegalSpadesCards(state, selfSeat)
      : [];

  return {
    kind: "spades",
    stage: state.stage,
    canBid:
      room.roomStatus === "playing" &&
      state.stage === "bidding" &&
      selfSeat !== null &&
      selfSeat === state.currentSeat,
    canPlay:
      room.roomStatus === "playing" &&
      state.stage === "playing" &&
      selfSeat !== null &&
      selfSeat === state.currentSeat,
    currentSeat: state.currentSeat,
    dealerSeat: state.dealerSeat,
    winnerSeats: state.winnerSeats,
    statusMessage: state.statusMessage,
    lastAction: state.lastAction,
    selfHand:
      selfSeat === null
        ? []
        : sortCards(state.hands[selfSeat] ?? [], {
            aceHigh: true,
            suitOrder: SPADES_SUIT_ORDER
          }),
    legalCards,
    bidOptions: Array.from({ length: 13 }, (_, index) => index + 1),
    players,
    teams,
    currentTrick,
    completedTricks: state.completedTricks,
    spadesBroken: state.spadesBroken
  };
}

export function applySpadesAction(room: RoomRecord, seat: number, action: ClientAction): void {
  const state = room.gameState;
  if (state.type !== "spades") {
    throw new AppError("spades state ではありません", 500);
  }
  if (state.currentSeat !== seat) {
    throw new AppError("あなたの手番ではありません", 403);
  }

  if (state.stage === "bidding") {
    if (action.type !== "bid_spades") {
      throw new AppError("このタイミングではビッドを選んでください", 400);
    }
    if (!Number.isInteger(action.bid) || action.bid < 1 || action.bid > 13) {
      throw new AppError("ビッドは 1 から 13 の範囲で指定してください", 400);
    }

    state.bids[seat] = action.bid;
    state.lastAction = `${formatPlayerLabel(room, seat)} が ${action.bid} トリックでビッドしました`;

    const nextSeat = getNextUnbidSeat(state, seat);
    if (nextSeat !== null) {
      state.currentSeat = nextSeat;
      state.statusMessage = `プレイヤー ${nextSeat + 1} がビッドする番です`;
      return;
    }

    state.stage = "playing";
    state.currentSeat = (state.dealerSeat + 1) % state.hands.length;
    state.statusMessage = `プレイヤー ${state.currentSeat + 1} が最初のカードを出す番です`;
    return;
  }

  if (state.stage !== "playing") {
    throw new AppError("このハンドは終了しています", 409);
  }
  if (action.type !== "play_card") {
    throw new AppError("カードを選んでください", 400);
  }

  const legalCards = getLegalSpadesCards(state, seat);
  if (!legalCards.includes(action.card)) {
    throw new AppError("そのカードは出せません", 409);
  }

  const hand = state.hands[seat] ?? [];
  const cardIndex = hand.indexOf(action.card);
  if (cardIndex < 0) {
    throw new AppError("そのカードは手札にありません", 409);
  }

  hand.splice(cardIndex, 1);
  state.currentTrick.push({ seat, card: action.card });
  if (getCardSuit(action.card) === "S") {
    state.spadesBroken = true;
  }

  if (state.currentTrick.length < state.hands.length) {
    state.currentSeat = (seat + 1) % state.hands.length;
    state.lastAction = `${formatPlayerLabel(room, seat)} が ${formatCardLabel(action.card)} を出しました`;
    state.statusMessage = `プレイヤー ${state.currentSeat + 1} がカードを出す番です`;
    return;
  }

  const trickWinner = resolveSpadesTrickWinner(state.currentTrick);
  state.tricksWon[trickWinner] = (state.tricksWon[trickWinner] ?? 0) + 1;
  state.completedTricks += 1;
  state.currentTrick = [];
  state.lastAction = `${formatPlayerLabel(room, seat)} が ${formatCardLabel(action.card)} を出しました。プレイヤー ${
    trickWinner + 1
  } がトリックを獲得しました`;

  if (state.hands.every((entry) => entry.length === 0)) {
    finishSpadesHand(room, state);
    return;
  }

  state.currentSeat = trickWinner;
  state.statusMessage = `プレイヤー ${trickWinner + 1} がカードを出す番です`;
}

export function advanceSpadesBotTurns(room: RoomRecord): void {
  if (room.roomStatus !== "playing" || room.gameState.type !== "spades") {
    return;
  }

  let iterations = 0;
  while (room.roomStatus === "playing") {
    iterations += 1;
    if (iterations > MAX_BOT_ITERATIONS) {
      room.roomStatus = "finished";
      room.gameState.stage = "finished";
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

    if (room.gameState.stage === "bidding") {
      applySpadesAction(room, currentSeat, {
        type: "bid_spades",
        bid: estimateSpadesBid(room.gameState.hands[currentSeat] ?? [])
      });
      continue;
    }

    const legalCards = getLegalSpadesCards(room.gameState, currentSeat);
    applySpadesAction(room, currentSeat, {
      type: "play_card",
      card: pickSpadesBotCard(room.gameState, currentSeat, legalCards)
    });
  }
}

function getLegalSpadesCards(state: SpadesState, seat: number): string[] {
  const hand = state.hands[seat] ?? [];
  if (state.stage !== "playing") {
    return [];
  }

  if (state.currentTrick.length === 0) {
    if (state.spadesBroken || hand.every((card) => getCardSuit(card) === "S")) {
      return [...hand];
    }

    const nonSpades = hand.filter((card) => getCardSuit(card) !== "S");
    return nonSpades.length > 0 ? nonSpades : [...hand];
  }

  const leadSuit = getCardSuit(state.currentTrick[0].card);
  if (!leadSuit) {
    return [...hand];
  }

  const followSuitCards = hand.filter((card) => getCardSuit(card) === leadSuit);
  return followSuitCards.length > 0 ? followSuitCards : [...hand];
}

function getNextUnbidSeat(state: SpadesState, seat: number): number | null {
  for (let offset = 1; offset < state.bids.length; offset += 1) {
    const candidate = (seat + offset) % state.bids.length;
    if (state.bids[candidate] === null) {
      return candidate;
    }
  }
  return null;
}

function resolveSpadesTrickWinner(trick: SpadesState["currentTrick"]): number {
  const leadSuit = getCardSuit(trick[0]?.card ?? "");
  if (!leadSuit) {
    throw new AppError("トリックの先頭カードが不正です", 500);
  }

  let winner = trick[0];
  for (const play of trick.slice(1)) {
    if (beatsCurrentWinner(play.card, winner.card, leadSuit)) {
      winner = play;
    }
  }
  return winner.seat;
}

function beatsCurrentWinner(candidate: string, currentWinner: string, leadSuit: string): boolean {
  const candidateSuit = getCardSuit(candidate);
  const winnerSuit = getCardSuit(currentWinner);
  if (!candidateSuit || !winnerSuit) {
    return false;
  }

  if (candidateSuit === winnerSuit) {
    return getCardRankValue(candidate, true) > getCardRankValue(currentWinner, true);
  }

  if (candidateSuit === "S" && winnerSuit !== "S") {
    return true;
  }

  if (candidateSuit !== "S" && winnerSuit === "S") {
    return false;
  }

  return candidateSuit === leadSuit && winnerSuit !== leadSuit;
}

function finishSpadesHand(room: RoomRecord, state: SpadesState): void {
  room.roomStatus = "finished";
  state.stage = "finished";
  state.currentSeat = null;
  state.teamScores = [0, 1].map((team) => calculateSpadesTeamScore(state, team));

  if (state.teamScores[0] === state.teamScores[1]) {
    state.winnerSeats = [];
    state.statusMessage = `引き分けです (${state.teamScores[0]} - ${state.teamScores[1]})`;
    return;
  }

  const winningTeam = state.teamScores[0] > state.teamScores[1] ? 0 : 1;
  state.winnerSeats = getTeamSeats(winningTeam);
  state.statusMessage = `${formatWinnerMessage(state.winnerSeats, "勝ちです")} (${state.teamScores[0]} - ${
    state.teamScores[1]
  })`;
}

function calculateSpadesTeamScore(state: SpadesState, team: number): number {
  const bid = getTeamBid(state, team);
  const tricksWon = getTeamTricksWon(state, team);
  if (tricksWon < bid) {
    return bid * -10;
  }
  return bid * 10 + (tricksWon - bid);
}

function getTeamBid(state: SpadesState, team: number): number {
  return state.bids.reduce((total, bid, seat) => total + (seat % 2 === team ? bid ?? 0 : 0), 0);
}

function getTeamTricksWon(state: SpadesState, team: number): number {
  return state.tricksWon.reduce((total, tricksWon, seat) => total + (seat % 2 === team ? tricksWon : 0), 0);
}

function getTeamSeats(team: number): number[] {
  return [0, 1, 2, 3].filter((seat) => seat % 2 === team);
}

function estimateSpadesBid(hand: readonly string[]): number {
  let strength = 0;
  let spadeCount = 0;

  for (const card of hand) {
    const suit = getCardSuit(card);
    const value = getCardRankValue(card, true);
    if (suit === "S") {
      spadeCount += 1;
      if (value >= 11) {
        strength += 1;
      } else if (value >= 8) {
        strength += 0.45;
      }
      continue;
    }

    if (value === 14) {
      strength += 0.8;
    } else if (value === 13) {
      strength += 0.55;
    } else if (value === 12) {
      strength += 0.35;
    }
  }

  strength += Math.max(0, spadeCount - 2) * 0.3;
  return Math.max(1, Math.min(13, Math.round(strength)));
}

function pickSpadesBotCard(state: SpadesState, seat: number, legalCards: readonly string[]): string {
  if (legalCards.length === 0) {
    throw new AppError("出せるカードがありません", 409);
  }

  const sortedLegalCards = sortCards(legalCards, {
    aceHigh: true,
    suitOrder: SPADES_SUIT_ORDER
  });

  if (state.currentTrick.length === 0) {
    const nonSpades = sortedLegalCards.filter((card) => getCardSuit(card) !== "S");
    return nonSpades[0] ?? sortedLegalCards[0];
  }

  const currentWinner = state.currentTrick.reduce((winner, play) => {
    if (!winner) {
      return play;
    }
    const leadSuit = getCardSuit(state.currentTrick[0]?.card ?? "");
    if (leadSuit && beatsCurrentWinner(play.card, winner.card, leadSuit)) {
      return play;
    }
    return winner;
  }, state.currentTrick[0]);

  const partnerIsWinning = currentWinner.seat % 2 === seat % 2;
  const leadSuit = getCardSuit(state.currentTrick[0]?.card ?? "");
  const winningCards = leadSuit
    ? sortedLegalCards.filter((card) => beatsCurrentWinner(card, currentWinner.card, leadSuit))
    : [];

  if (!partnerIsWinning && winningCards.length > 0) {
    return winningCards[0];
  }

  return sortedLegalCards[0];
}

import {
  compareMahjongTiles,
  createMahjongWall,
  formatMahjongTile,
  getMahjongTileKind,
  getMahjongTileRank,
  getMahjongTileSuit,
  isMahjongHonor,
  isMahjongTerminalOrHonor,
  sortMahjongTiles
} from "../../src/shared/mahjong";
import type { ClientAction, MahjongView } from "../../src/shared/types";
import { assert } from "../errors";
import type { MahjongState, RoomRecord } from "../types";
import { formatPlayerLabel, formatTurnMessage } from "./common";

const DEAD_WALL_SIZE = 14;
const MAHJONG_SEAT_COUNT = 4;
const MAX_BOT_STEPS = 80;

export function createMahjongState(seatCount: number): MahjongState {
  assert(seatCount === MAHJONG_SEAT_COUNT, "麻雀は 4 人卓のみ対応しています", 409);

  const dealerSeat = Math.floor(Math.random() * MAHJONG_SEAT_COUNT);
  const stock = createMahjongWall();
  const deadWall = stock.splice(0, DEAD_WALL_SIZE);
  const hands = Array.from({ length: MAHJONG_SEAT_COUNT }, () => [] as string[]);
  const discards = Array.from({ length: MAHJONG_SEAT_COUNT }, () => [] as string[]);

  for (let round = 0; round < 13; round += 1) {
    for (let seat = 0; seat < MAHJONG_SEAT_COUNT; seat += 1) {
      const tile = stock.shift();
      assert(tile, "麻雀の初期配牌に失敗しました", 500);
      hands[seat].push(tile);
    }
  }

  const dealerDraw = stock.shift();
  assert(dealerDraw, "麻雀の初期配牌に失敗しました", 500);
  hands[dealerSeat].push(dealerDraw);

  return {
    type: "mahjong",
    phase: "playing",
    roundLabel: "東1局",
    dealerSeat,
    currentSeat: dealerSeat,
    hands: hands.map((hand) => sortMahjongTiles(hand)),
    discards,
    wall: stock,
    deadWall,
    doraIndicator: deadWall[4] ?? deadWall[0] ?? null,
    winnerSeats: [],
    statusMessage: "",
    lastAction: `${formatPlayerLabelFromSeat(dealerSeat)} が親です。`,
    finishReason: null
  };
}

export function buildMahjongView(
  room: RoomRecord,
  state: MahjongState,
  selfSeat: number | null
): MahjongView {
  const canAct = selfSeat !== null && state.phase === "playing" && selfSeat === state.currentSeat;

  return {
    kind: "mahjong",
    phase: state.phase,
    canAct,
    currentSeat: state.currentSeat,
    dealerSeat: state.dealerSeat,
    roundLabel: state.roundLabel,
    wallCount: state.wall.length,
    deadWallCount: state.deadWall.length,
    doraIndicator: state.doraIndicator,
    winnerSeats: [...state.winnerSeats],
    statusMessage: state.statusMessage,
    lastAction: state.lastAction,
    finishReason: state.finishReason,
    selfHand: selfSeat === null ? [] : sortMahjongTiles(state.hands[selfSeat] ?? []),
    players: [...room.players]
      .sort((left, right) => left.seat - right.seat)
      .map((player) => ({
        seat: player.seat,
        name: player.name,
        handCount: state.hands[player.seat]?.length ?? 0,
        discardCount: state.discards[player.seat]?.length ?? 0,
        isCurrent: state.currentSeat === player.seat,
        isDealer: state.dealerSeat === player.seat,
        isWinner: state.winnerSeats.includes(player.seat)
      })),
    discards: [...room.players]
      .sort((left, right) => left.seat - right.seat)
      .map((player) => ({
        seat: player.seat,
        name: player.name,
        tiles: [...(state.discards[player.seat] ?? [])]
      }))
  };
}

export function applyMahjongAction(room: RoomRecord, seat: number, action: ClientAction): void {
  assert(room.gameState.type === "mahjong", "麻雀ゲームではありません", 409);
  const state = room.gameState;

  assert(state.phase === "playing", "この局はすでに終了しています", 409);
  assert(action.type === "mahjong_discard", "麻雀では打牌のみ操作できます", 400);
  assert(state.currentSeat === seat, "現在の手番ではありません", 409);

  discardAndAdvance(room, state, seat, action.tile);
}

export function advanceMahjongBotTurns(room: RoomRecord): void {
  assert(room.gameState.type === "mahjong", "麻雀ゲームではありません", 409);
  const state = room.gameState;
  let steps = 0;

  while (state.phase === "playing" && state.currentSeat !== null) {
    const player = room.players.find((entry) => entry.seat === state.currentSeat);
    if (!player || player.playerType !== "bot") {
      return;
    }

    const tile = chooseMahjongBotDiscard(state.hands[player.seat] ?? []);
    discardAndAdvance(room, state, player.seat, tile);
    steps += 1;

    assert(steps < MAX_BOT_STEPS, "麻雀 bot の進行が停止しません", 500);
  }
}

function discardAndAdvance(room: RoomRecord, state: MahjongState, seat: number, tile: string): void {
  const hand = state.hands[seat];
  assert(hand, "手牌が見つかりません", 500);
  const tileIndex = hand.indexOf(tile);
  assert(tileIndex >= 0, "その牌は手牌にありません", 400);
  assert(hand.length % 3 === 2, "自摸後の 14 枚手牌から打牌してください", 409);

  hand.splice(tileIndex, 1);
  state.hands[seat] = sortMahjongTiles(hand);
  state.discards[seat].push(tile);
  state.lastAction = `${formatPlayerLabel(room, seat)} が ${formatMahjongTile(tile)} を打牌`;

  if (state.wall.length === 0) {
    finishMahjongAsDraw(room, state);
    return;
  }

  const nextSeat = (seat + 1) % MAHJONG_SEAT_COUNT;
  const nextDraw = state.wall.shift();
  assert(nextDraw, "山から牌を引けませんでした", 500);
  state.hands[nextSeat].push(nextDraw);
  state.hands[nextSeat] = sortMahjongTiles(state.hands[nextSeat]);
  state.currentSeat = nextSeat;
  state.statusMessage = formatTurnMessage(room, nextSeat, "が打牌する番です");
}

function finishMahjongAsDraw(room: RoomRecord, state: MahjongState): void {
  state.phase = "finished";
  state.currentSeat = null;
  state.winnerSeats = [];
  state.finishReason = "山が尽きたため流局";
  state.statusMessage = `${state.roundLabel} は流局です。`;
  state.lastAction = `${state.lastAction ?? "最後の打牌"} / 山が尽きました`;
}

function chooseMahjongBotDiscard(hand: string[]): string {
  const kindCounts = new Map<string, number>();
  for (const tile of hand) {
    const kind = getMahjongTileKind(tile);
    kindCounts.set(kind, (kindCounts.get(kind) ?? 0) + 1);
  }

  return [...hand]
    .sort((left, right) => {
      const scoreDiff = scoreDiscardTile(right, hand, kindCounts) - scoreDiscardTile(left, hand, kindCounts);
      if (scoreDiff !== 0) {
        return scoreDiff;
      }
      return compareMahjongTiles(right, left);
    })[0];
}

function scoreDiscardTile(tile: string, hand: string[], kindCounts: Map<string, number>): number {
  let score = 0;
  const kind = getMahjongTileKind(tile);
  const sameKindCount = kindCounts.get(kind) ?? 0;
  const suit = getMahjongTileSuit(tile);
  const rank = getMahjongTileRank(tile);

  if (sameKindCount >= 2) {
    score -= 8;
  }

  if (isMahjongHonor(tile)) {
    score += 6;
  }

  if (isMahjongTerminalOrHonor(tile)) {
    score += 4;
  }

  if (suit !== "z") {
    const leftNeighbor = hand.some(
      (candidate) =>
        candidate !== tile &&
        getMahjongTileSuit(candidate) === suit &&
        Math.abs(getMahjongTileRank(candidate) - rank) === 1
    );
    const skipNeighbor = hand.some(
      (candidate) =>
        candidate !== tile &&
        getMahjongTileSuit(candidate) === suit &&
        Math.abs(getMahjongTileRank(candidate) - rank) === 2
    );

    if (leftNeighbor) {
      score -= 3;
    }
    if (skipNeighbor) {
      score -= 1;
    }
    if (rank >= 4 && rank <= 6) {
      score -= 1;
    }
  }

  return score;
}

function formatPlayerLabelFromSeat(seat: number): string {
  return `座席 ${seat + 1}`;
}

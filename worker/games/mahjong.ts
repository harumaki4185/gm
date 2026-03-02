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
import type {
  ClientAction,
  MahjongCallOptionView,
  MahjongPendingCallView,
  MahjongResultView,
  MahjongView
} from "../../src/shared/types";
import { AppError, assert } from "../errors";
import type {
  MahjongMeld,
  MahjongPendingCall,
  MahjongResult,
  MahjongState,
  RoomRecord
} from "../types";
import { formatPlayerLabel, formatTurnMessage } from "./common";

const DEAD_WALL_SIZE = 14;
const INITIAL_SCORE = 25000;
const MAHJONG_SEAT_COUNT = 4;
const MAX_BOT_STEPS = 120;
const TURN_DRAW_FURITEN_PENALTY = 3000;

type MahjongAnalysis =
  | {
      kind: "standard";
      pairKind: string;
      melds: AnalyzedMeld[];
    }
  | {
      kind: "chiitoitsu";
      pairKinds: string[];
    };

interface AnalyzedMeld {
  type: "sequence" | "triplet";
  kinds: string[];
}

interface MahjongWinEvaluation {
  han: number;
  fu: number;
  total: number;
  yaku: string[];
  scoreDeltas: number[];
  summary: string;
}

export function createMahjongState(seatCount: number): MahjongState {
  assert(seatCount === MAHJONG_SEAT_COUNT, "麻雀は 4 人卓のみ対応しています", 409);

  const dealerSeat = Math.floor(Math.random() * MAHJONG_SEAT_COUNT);
  const stock = createMahjongWall();
  const deadWall = stock.splice(0, DEAD_WALL_SIZE);
  const hands = Array.from({ length: MAHJONG_SEAT_COUNT }, () => [] as string[]);
  const melds = Array.from({ length: MAHJONG_SEAT_COUNT }, () => [] as MahjongMeld[]);
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
    matchType: "tonpuu",
    roundWind: "east",
    roundNumber: 1,
    roundLabel: "東1局",
    dealerSeat,
    currentSeat: dealerSeat,
    honba: 0,
    riichiSticks: 0,
    scores: Array.from({ length: MAHJONG_SEAT_COUNT }, () => INITIAL_SCORE),
    hands: hands.map((hand) => sortMahjongTiles(hand)),
    melds,
    discards,
    wall: stock,
    deadWall,
    doraIndicators: [deadWall[4] ?? deadWall[0]].filter((tile): tile is string => Boolean(tile)),
    uraDoraIndicators: [],
    lastDrawTile: dealerDraw,
    lastDrawSeat: dealerSeat,
    drawSource: "wall",
    riichiSeats: [],
    ippatsuEligible: Array.from({ length: MAHJONG_SEAT_COUNT }, () => false),
    sameTurnFuriten: Array.from({ length: MAHJONG_SEAT_COUNT }, () => false),
    riichiFuriten: Array.from({ length: MAHJONG_SEAT_COUNT }, () => false),
    winnerSeats: [],
    tenpaiSeats: [],
    statusMessage: "",
    lastAction: null,
    finishReason: null,
    pendingCall: null,
    results: []
  };
}

export function buildMahjongView(
  room: RoomRecord,
  state: MahjongState,
  selfSeat: number | null
): MahjongView {
  const canRespondToCall = selfSeat !== null && canRespondToPendingCall(state.pendingCall, selfSeat);
  const canTakeTurn = selfSeat !== null && state.phase === "playing" && selfSeat === state.currentSeat;
  const canTsumo =
    canTakeTurn &&
    state.pendingCall === null &&
    evaluateMahjongWin(room, state, selfSeat, "tsumo", null, null) !== null;
  const riichiDiscardOptions = canTakeTurn ? getRiichiDiscardOptions(room, state, selfSeat) : [];
  const ankanOptions = canTakeTurn ? getAnkanOptions(state, selfSeat) : [];
  const kakanOptions = canTakeTurn ? getKakanOptions(state, selfSeat) : [];

  return {
    kind: "mahjong",
    phase: state.phase,
    canAct: canTakeTurn || canRespondToCall,
    canTsumo,
    canRiichi: riichiDiscardOptions.length > 0,
    canAdvanceRound: state.phase === "round_result",
    currentSeat: state.currentSeat,
    dealerSeat: state.dealerSeat,
    roundLabel: state.roundLabel,
    honba: state.honba,
    riichiSticks: state.riichiSticks,
    wallCount: state.wall.length,
    deadWallCount: state.deadWall.length,
    doraIndicators: [...state.doraIndicators],
    winnerSeats: [...state.winnerSeats],
    tenpaiSeats: [...state.tenpaiSeats],
    statusMessage: state.statusMessage,
    lastAction: state.lastAction,
    finishReason: state.finishReason,
    selfHand: selfSeat === null ? [] : sortMahjongTiles(state.hands[selfSeat] ?? []),
    riichiDiscardOptions,
    ankanOptions,
    kakanOptions,
    players: [...room.players]
      .sort((left, right) => left.seat - right.seat)
      .map((player) => ({
        seat: player.seat,
        name: player.name,
        score: state.scores[player.seat] ?? INITIAL_SCORE,
        handCount: state.hands[player.seat]?.length ?? 0,
        discardCount: state.discards[player.seat]?.length ?? 0,
        isCurrent: state.currentSeat === player.seat,
        isDealer: state.dealerSeat === player.seat,
        isRiichi: state.riichiSeats.includes(player.seat),
        isFuriten: isSeatFuriten(state, player.seat),
        isWinner: state.winnerSeats.includes(player.seat),
        melds: (state.melds[player.seat] ?? []).map((meld) => ({
          type: meld.type,
          tiles: meld.tiles.map((tile) => formatMahjongTile(tile)),
          fromSeat: meld.fromSeat,
          open: meld.open
        }))
      })),
    discards: [...room.players]
      .sort((left, right) => left.seat - right.seat)
      .map((player) => ({
        seat: player.seat,
        name: player.name,
        tiles: [...(state.discards[player.seat] ?? [])]
      })),
    pendingCall: selfSeat !== null ? buildPendingCallView(state.pendingCall, selfSeat) : null,
    results: state.results.map((result) => buildResultView(result))
  };
}

export function applyMahjongAction(room: RoomRecord, seat: number, action: ClientAction): void {
  assert(room.gameState.type === "mahjong", "麻雀ゲームではありません", 409);
  const state = room.gameState;

  if (action.type === "mahjong_next_round") {
    assert(state.phase === "round_result", "次局へ進めるのは局終了後のみです", 409);
    advanceMahjongRound(room, state);
    return;
  }

  assert(state.phase === "playing", "この局はすでに終了しています", 409);

  if (state.pendingCall) {
    handlePendingCallAction(room, state, seat, action);
    return;
  }

  assert(state.currentSeat === seat, "現在の手番ではありません", 409);

  if (action.type === "mahjong_tsumo") {
    const evaluation = evaluateMahjongWin(room, state, seat, "tsumo", null, null);
    assert(evaluation, "この手牌ではツモ和了できません", 409);
    finishMahjongByWin(room, state, seat, null, "tsumo", evaluation);
    return;
  }

  if (action.type === "mahjong_declare_riichi") {
    applyRiichiDeclaration(room, state, seat, action.tile);
    return;
  }

  if (action.type === "mahjong_ankan") {
    applyAnkan(room, state, seat, action.tiles);
    return;
  }

  if (action.type === "mahjong_kakan") {
    applyKakan(room, state, seat, action.tile);
    return;
  }

  if (action.type === "mahjong_discard") {
    discardAndResolve(room, state, seat, action.tile);
    return;
  }

  throw new AppError("麻雀では現在の手番に許可されていない操作です", 400);
}

export function advanceMahjongBotTurns(room: RoomRecord): void {
  assert(room.gameState.type === "mahjong", "麻雀ゲームではありません", 409);
  const state = room.gameState;
  let steps = 0;

  while (room.roomStatus === "playing" && (state.phase === "playing" || state.phase === "round_result")) {
    steps += 1;
    assert(steps <= MAX_BOT_STEPS, "麻雀 bot の進行が停止しません", 500);

    if (state.phase === "round_result") {
      const humanPlayers = room.players.filter((player) => player.playerType === "human");
      if (humanPlayers.length > 0) {
        return;
      }
      advanceMahjongRound(room, state);
      continue;
    }

    if (state.pendingCall) {
      if (state.pendingCall.stage === "ron") {
        const awaitingBotSeat = state.pendingCall.eligibleSeats.find((candidateSeat) => {
          if (!isSeatAwaitingRonDecision(state.pendingCall, candidateSeat)) {
            return false;
          }
          const player = room.players.find((entry) => entry.seat === candidateSeat);
          return player?.playerType === "bot";
        });
        if (typeof awaitingBotSeat === "number") {
          resolveBotPendingCall(room, state, awaitingBotSeat);
          continue;
        }
        return;
      }

      const caller = room.players.find((player) => player.seat === state.pendingCall.seat);
      if (!caller || caller.playerType !== "bot") {
        return;
      }
      resolveBotPendingCall(room, state, caller.seat);
      continue;
    }

    if (state.currentSeat === null) {
      return;
    }

    const player = room.players.find((entry) => entry.seat === state.currentSeat);
    if (!player || player.playerType !== "bot") {
      return;
    }

    const tsumo = evaluateMahjongWin(room, state, player.seat, "tsumo", null, null);
    if (tsumo) {
      finishMahjongByWin(room, state, player.seat, null, "tsumo", tsumo);
      return;
    }

    const kakanOptions = getKakanOptions(state, player.seat);
    if (kakanOptions.length > 0 && shouldBotKakan(state, player.seat, kakanOptions[0])) {
      applyKakan(room, state, player.seat, kakanOptions[0]);
      continue;
    }

    const ankanOptions = getAnkanOptions(state, player.seat);
    if (ankanOptions.length > 0 && shouldBotAnkan(state, player.seat, ankanOptions[0])) {
      applyAnkan(room, state, player.seat, ankanOptions[0]);
      continue;
    }

    const riichiDiscardOptions = getRiichiDiscardOptions(room, state, player.seat);
    const riichiTile = chooseBotRiichiDiscard(state, player.seat, riichiDiscardOptions);
    if (riichiTile) {
      applyRiichiDeclaration(room, state, player.seat, riichiTile);
      continue;
    }

    const tile = chooseMahjongBotDiscard(state, player.seat);
    discardAndResolve(room, state, player.seat, tile);
  }
}

function handlePendingCallAction(
  room: RoomRecord,
  state: MahjongState,
  seat: number,
  action: ClientAction
): void {
  const pending = state.pendingCall;
  assert(pending, "鳴きやロンを選択できる状態ではありません", 409);

  if (pending.stage === "ron") {
    assert(isSeatAwaitingRonDecision(pending, seat), "現在この席はロンを選択できません", 409);

    if (action.type === "mahjong_ron") {
      const evaluation = evaluateMahjongWin(room, state, seat, "ron", pending.discardTile, pending.discardSeat);
      assert(evaluation, "この打牌ではロン和了できません", 409);
      pending.acceptedSeats.push(seat);
    } else if (action.type === "mahjong_pass_call") {
      pending.passedSeats.push(seat);
      state.sameTurnFuriten[seat] = true;
      if (state.riichiSeats.includes(seat)) {
        state.riichiFuriten[seat] = true;
      }
    } else {
      throw new AppError("ロン待ちではロンか見送りのみ選択できます", 400);
    }

    settleRonWindow(room, state, pending);
    return;
  }

  assert(pending.seat === seat, "現在この席は鳴きを選択できません", 409);

  if (action.type === "mahjong_pass_call") {
    resolvePendingPass(room, state);
    return;
  }

  if (action.type !== "mahjong_call") {
    throw new AppError("鳴き待ちでは鳴きか見送りのみ選択できます", 400);
  }

  if (action.call === "chi") {
    const selected = normalizeCallSelection(action.tiles);
    const matched = pending.chiOptions.find((option) => sameTileSelection(option, selected));
    assert(matched, "選択した牌ではチーできません", 409);
    applyOpenCall(room, state, seat, pending.discardSeat, pending.discardTile, "chi", matched);
    return;
  }

  if (action.call === "pon") {
    assert(pending.ponOption !== null, "この打牌ではポンできません", 409);
    const selected = normalizeCallSelection(action.tiles);
    assert(sameTileSelection(pending.ponOption, selected), "選択した牌ではポンできません", 409);
    applyOpenCall(room, state, seat, pending.discardSeat, pending.discardTile, "pon", pending.ponOption);
    return;
  }

  if (action.call === "kan") {
    assert(pending.kanOption !== null, "この打牌ではカンできません", 409);
    const selected = normalizeCallSelection(action.tiles);
    assert(sameTileSelection(pending.kanOption, selected), "選択した牌ではカンできません", 409);
    applyOpenCall(room, state, seat, pending.discardSeat, pending.discardTile, "kan", pending.kanOption);
    return;
  }

  throw new AppError("不明な鳴き操作です", 400);
}

function discardAndResolve(
  room: RoomRecord,
  state: MahjongState,
  seat: number,
  tile: string,
  options?: {
    preserveIppatsu?: boolean;
  }
): void {
  const hand = state.hands[seat];
  assert(hand, "手牌が見つかりません", 500);
  const tileIndex = hand.indexOf(tile);
  assert(tileIndex >= 0, "その牌は手牌にありません", 400);
  assert(hand.length % 3 === 2, "自摸後の手牌から打牌してください", 409);
  assert(canDiscardTile(state, seat, tile), "立直後はツモ切り以外できません", 409);

  hand.splice(tileIndex, 1);
  state.hands[seat] = sortMahjongTiles(hand);
  if (state.riichiSeats.includes(seat) && !options?.preserveIppatsu) {
    state.ippatsuEligible[seat] = false;
  }
  state.discards[seat].push(tile);
  state.lastDrawTile = null;
  state.lastDrawSeat = null;
  state.drawSource = null;
  state.sameTurnFuriten[seat] = false;
  state.lastAction = `${formatPlayerLabel(room, seat)} が ${formatMahjongTile(tile)} を打牌`;

  const ronWindow = findRonPendingCall(room, state, seat, tile);
  if (ronWindow) {
    state.pendingCall = ronWindow;
    state.currentSeat = null;
    state.statusMessage = buildPendingCallMessage(room, ronWindow);
    return;
  }

  const claimWindow = findClaimPendingCall(room, state, seat, tile);
  if (claimWindow) {
    state.pendingCall = claimWindow;
    state.currentSeat = null;
    state.statusMessage = buildPendingCallMessage(room, claimWindow);
    return;
  }

  resolveDiscardWithoutCall(room, state, seat);
}

function resolveDiscardWithoutCall(room: RoomRecord, state: MahjongState, discardSeat: number): void {
  state.pendingCall = null;

  if (state.wall.length === 0) {
    finishMahjongAsDraw(room, state, calculateTenpaiSeats(room, state));
    return;
  }

  const nextSeat = (discardSeat + 1) % MAHJONG_SEAT_COUNT;
  drawFromWall(state, nextSeat);
  state.currentSeat = nextSeat;
  state.statusMessage = formatTurnMessage(room, nextSeat, "が打牌する番です");
}

function resolvePendingPass(room: RoomRecord, state: MahjongState): void {
  const pending = state.pendingCall;
  assert(pending && pending.stage === "call", "鳴き待ちではありません", 409);
  state.lastAction = `${formatPlayerLabel(room, pending.seat)} が ${formatMahjongTile(pending.discardTile)} を見送りました`;
  state.pendingCall = null;
  resolveDiscardWithoutCall(room, state, pending.discardSeat);
}

function applyOpenCall(
  room: RoomRecord,
  state: MahjongState,
  seat: number,
  discardSeat: number,
  discardTile: string,
  callType: "chi" | "pon" | "kan",
  consumedTiles: string[]
): void {
  const hand = state.hands[seat];
  assert(hand, "手牌が見つかりません", 500);
  removeTilesFromHand(hand, consumedTiles);

  const river = state.discards[discardSeat];
  assert(river && river[river.length - 1] === discardTile, "鳴き対象の打牌が見つかりません", 409);
  river.pop();

  const meldTiles = sortMahjongTiles([...consumedTiles, discardTile]);
  state.melds[seat].push({
    type: callType,
    tiles: meldTiles,
    fromSeat: discardSeat,
    calledTile: discardTile,
    open: true
  });
  state.hands[seat] = sortMahjongTiles(hand);
  state.pendingCall = null;
  state.currentSeat = seat;
  clearIppatsuFlags(state);

  if (callType === "kan") {
    state.lastAction = `${formatPlayerLabel(room, seat)} が ${formatMahjongTile(discardTile)} を大明槓しました`;
    revealNextDoraIndicator(state);
    drawRinshanTile(state, seat);
    state.statusMessage = formatTurnMessage(room, seat, "が嶺上牌のあと打牌する番です");
    return;
  }

  state.lastAction = `${formatPlayerLabel(room, seat)} が ${formatMahjongTile(discardTile)} を${
    callType === "chi" ? "チー" : "ポン"
  }しました`;
  state.statusMessage = formatTurnMessage(room, seat, "が打牌する番です");
}

function resolveBotPendingCall(room: RoomRecord, state: MahjongState, seat: number): void {
  const pending = state.pendingCall;
  assert(pending, "bot が処理できる鳴き待ちではありません", 409);

  if (pending.stage === "ron") {
    assert(isSeatAwaitingRonDecision(pending, seat), "bot が処理できるロン待ちではありません", 409);
    const evaluation = evaluateMahjongWin(room, state, seat, "ron", pending.discardTile, pending.discardSeat);
    if (evaluation) {
      pending.acceptedSeats.push(seat);
    } else {
      pending.passedSeats.push(seat);
    }
    settleRonWindow(room, state, pending);
    return;
  }

  assert(pending.seat === seat, "bot が処理できる鳴き待ちではありません", 409);

  if (pending.kanOption && shouldBotClaimTriplet(state, seat, pending.discardTile, true)) {
    applyOpenCall(room, state, seat, pending.discardSeat, pending.discardTile, "kan", pending.kanOption);
    return;
  }

  if (pending.ponOption && shouldBotClaimTriplet(state, seat, pending.discardTile, false)) {
    applyOpenCall(room, state, seat, pending.discardSeat, pending.discardTile, "pon", pending.ponOption);
    return;
  }

  if (pending.chiOptions.length > 0 && shouldBotChi(state, seat, pending.discardTile)) {
    applyOpenCall(room, state, seat, pending.discardSeat, pending.discardTile, "chi", pending.chiOptions[0]);
    return;
  }

  resolvePendingPass(room, state);
}

function shouldBotClaimTriplet(
  state: MahjongState,
  seat: number,
  discardTile: string,
  isKan: boolean
): boolean {
  const kind = getMahjongTileKind(discardTile);
  if (isValueKind(state, seat, kind)) {
    return true;
  }
  if (isMahjongHonor(discardTile)) {
    return true;
  }

  const hand = state.hands[seat] ?? [];
  const simpleCount = hand.filter((tile) => !isMahjongTerminalOrHonor(tile)).length;
  if (simpleCount <= Math.ceil(hand.length / 2)) {
    return true;
  }

  const pairCount = countPairsInHand(hand);
  if (pairCount <= 1) {
    return true;
  }

  return isKan && hand.length <= 8;
}

function shouldBotChi(state: MahjongState, seat: number, discardTile: string): boolean {
  if (isMahjongHonor(discardTile)) {
    return false;
  }
  if (isMahjongTerminalOrHonor(discardTile)) {
    return false;
  }

  const suit = getMahjongTileSuit(discardTile);
  const hand = state.hands[seat] ?? [];
  const sameSuitCount = hand.filter((tile) => getMahjongTileSuit(tile) === suit).length;
  return sameSuitCount >= Math.ceil(hand.length / 3);
}

function chooseBotRiichiDiscard(state: MahjongState, seat: number, riichiOptions: string[]): string | null {
  if (riichiOptions.length === 0 || state.riichiSeats.includes(seat) || (state.scores[seat] ?? 0) < 1000) {
    return null;
  }

  const hand = state.hands[seat] ?? [];
  const bestOption = riichiOptions
    .map((tile) => {
      const remaining = removeTileOnce(hand, tile);
      return {
        tile,
        waitCount: getWinningKindsForHand(remaining, state.melds[seat].length).length,
        handValue: estimateHandProgress(remaining, state.melds[seat].length)
      };
    })
    .sort((left, right) => {
      if (right.waitCount !== left.waitCount) {
        return right.waitCount - left.waitCount;
      }
      if (right.handValue !== left.handValue) {
        return right.handValue - left.handValue;
      }
      return compareMahjongTiles(left.tile, right.tile);
    })[0];

  if (!bestOption) {
    return null;
  }

  if (bestOption.waitCount >= 3) {
    return bestOption.tile;
  }

  if (bestOption.waitCount >= 2 && (state.scores[seat] ?? 0) >= 8000) {
    return bestOption.tile;
  }

  return null;
}

function shouldBotAnkan(state: MahjongState, seat: number, tiles: string[]): boolean {
  if (state.riichiSeats.includes(seat) || tiles.length !== 4) {
    return false;
  }

  const hand = state.hands[seat] ?? [];
  const remaining = [...hand];
  removeTilesFromHand(remaining, tiles);
  const currentValue = estimateBestDiscardPlan(hand, state.melds[seat].length);
  const afterKanValue = estimateBestDiscardPlan(remaining, state.melds[seat].length + 1) + 16;
  return afterKanValue >= currentValue - 12;
}

function shouldBotKakan(state: MahjongState, seat: number, tile: string): boolean {
  if (state.riichiSeats.includes(seat)) {
    return false;
  }

  const hand = state.hands[seat] ?? [];
  const remaining = removeTileOnce(hand, tile);
  const currentValue = estimateBestDiscardPlan(hand, state.melds[seat].length);
  const afterKanValue = estimateBestDiscardPlan(remaining, state.melds[seat].length + 1) + 10;
  return afterKanValue >= currentValue - 8;
}

function applyRiichiDeclaration(room: RoomRecord, state: MahjongState, seat: number, tile: string): void {
  const riichiOptions = getRiichiDiscardOptions(room, state, seat);
  assert(riichiOptions.includes(tile), "この牌では立直できません", 409);
  assert(!state.riichiSeats.includes(seat), "すでに立直済みです", 409);
  assert((state.scores[seat] ?? 0) >= 1000, "立直には 1000 点必要です", 409);

  state.scores[seat] -= 1000;
  state.riichiSticks += 1;
  state.riichiSeats.push(seat);
  state.ippatsuEligible[seat] = true;
  discardAndResolve(room, state, seat, tile, { preserveIppatsu: true });
  state.lastAction = `${formatPlayerLabel(room, seat)} が ${formatMahjongTile(tile)} を切って立直`;
}

function applyAnkan(room: RoomRecord, state: MahjongState, seat: number, tiles: string[]): void {
  const normalized = normalizeCallSelection(tiles);
  const matched = getAnkanOptions(state, seat).find((option) => sameTileSelection(option, normalized));
  assert(matched, "この牌では暗槓できません", 409);

  removeTilesFromHand(state.hands[seat], matched);
  state.melds[seat].push({
    type: "kan",
    tiles: [...matched],
    fromSeat: null,
    calledTile: null,
    open: false
  });
  state.hands[seat] = sortMahjongTiles(state.hands[seat]);
  clearIppatsuFlags(state);
  revealNextDoraIndicator(state);
  drawRinshanTile(state, seat);
  state.currentSeat = seat;
  state.lastAction = `${formatPlayerLabel(room, seat)} が暗槓しました`;
  state.statusMessage = formatTurnMessage(room, seat, "が嶺上牌のあと打牌する番です");
}

function applyKakan(room: RoomRecord, state: MahjongState, seat: number, tile: string): void {
  const kakanOptions = getKakanOptions(state, seat);
  assert(kakanOptions.includes(tile), "この牌では加槓できません", 409);

  const hand = state.hands[seat];
  const index = hand.indexOf(tile);
  assert(index >= 0, "加槓する牌が手牌にありません", 409);
  hand.splice(index, 1);
  state.hands[seat] = sortMahjongTiles(hand);

  const kind = getMahjongTileKind(tile);
  const meldIndex = state.melds[seat].findIndex(
    (meld) => meld.type === "pon" && meld.open && getMahjongTileKind(meld.tiles[0]) === kind
  );
  assert(meldIndex >= 0, "加槓対象のポンが見つかりません", 409);

  const ronSeats = Array.from({ length: MAHJONG_SEAT_COUNT - 1 }, (_, offset) => (seat + offset + 1) % MAHJONG_SEAT_COUNT).filter(
    (targetSeat) =>
      room.players.find((player) => player.seat === targetSeat)?.connected !== false &&
      !isSeatFuriten(state, targetSeat) &&
      evaluateMahjongWin(room, state, targetSeat, "ron", tile, seat) !== null
  );

  if (ronSeats.length > 0) {
    state.pendingCall = {
      stage: "ron",
      discardSeat: seat,
      discardTile: tile,
      source: "kakan",
      eligibleSeats: ronSeats,
      acceptedSeats: [],
      passedSeats: [],
      kakanSeat: seat,
      kakanTile: tile,
      kakanMeldIndex: meldIndex
    };
    state.currentSeat = null;
    state.statusMessage = buildPendingCallMessage(room, state.pendingCall);
    state.lastAction = `${formatPlayerLabel(room, seat)} が加槓を宣言しました`;
    return;
  }

  finalizeKakanWithoutRon(room, state, seat, meldIndex, tile);
}

function finalizeKakanWithoutRon(
  room: RoomRecord,
  state: MahjongState,
  seat: number,
  meldIndex: number,
  tile: string
): void {
  const meld = state.melds[seat][meldIndex];
  assert(meld, "加槓対象の面子が見つかりません", 409);
  meld.type = "kan";
  meld.tiles = sortMahjongTiles([...meld.tiles, tile]);
  clearIppatsuFlags(state);
  revealNextDoraIndicator(state);
  drawRinshanTile(state, seat);
  state.pendingCall = null;
  state.currentSeat = seat;
  state.lastAction = `${formatPlayerLabel(room, seat)} が ${formatMahjongTile(tile)} を加槓しました`;
  state.statusMessage = formatTurnMessage(room, seat, "が嶺上牌のあと打牌する番です");
}

function advanceMahjongRound(room: RoomRecord, state: MahjongState): void {
  const nextInfo = resolveStoredNextRoundInfo(state);
  assert(nextInfo !== null, "次局へ進める情報がありません", 409);

  const stock = createMahjongWall();
  const deadWall = stock.splice(0, DEAD_WALL_SIZE);
  const hands = Array.from({ length: MAHJONG_SEAT_COUNT }, () => [] as string[]);
  const melds = Array.from({ length: MAHJONG_SEAT_COUNT }, () => [] as MahjongMeld[]);
  const discards = Array.from({ length: MAHJONG_SEAT_COUNT }, () => [] as string[]);

  for (let round = 0; round < 13; round += 1) {
    for (let seat = 0; seat < MAHJONG_SEAT_COUNT; seat += 1) {
      const tile = stock.shift();
      assert(tile, "麻雀の配牌に失敗しました", 500);
      hands[seat].push(tile);
    }
  }

  const dealerDraw = stock.shift();
  assert(dealerDraw, "麻雀の配牌に失敗しました", 500);
  hands[nextInfo.dealerSeat].push(dealerDraw);

  state.phase = "playing";
  state.matchType = nextInfo.matchType;
  state.roundWind = nextInfo.roundWind;
  state.roundNumber = nextInfo.roundNumber;
  state.roundLabel = formatRoundLabel(nextInfo.roundWind, nextInfo.roundNumber);
  state.dealerSeat = nextInfo.dealerSeat;
  state.currentSeat = nextInfo.dealerSeat;
  state.honba = nextInfo.honba;
  state.hands = hands.map((entry) => sortMahjongTiles(entry));
  state.melds = melds;
  state.discards = discards;
  state.wall = stock;
  state.deadWall = deadWall;
  state.doraIndicators = [deadWall[4] ?? deadWall[0]].filter((entry): entry is string => Boolean(entry));
  state.uraDoraIndicators = [];
  state.lastDrawTile = dealerDraw;
  state.lastDrawSeat = nextInfo.dealerSeat;
  state.drawSource = "wall";
  state.riichiSeats = [];
  state.ippatsuEligible = Array.from({ length: MAHJONG_SEAT_COUNT }, () => false);
  state.sameTurnFuriten = Array.from({ length: MAHJONG_SEAT_COUNT }, () => false);
  state.riichiFuriten = Array.from({ length: MAHJONG_SEAT_COUNT }, () => false);
  state.pendingCall = null;
  state.winnerSeats = [];
  state.tenpaiSeats = [];
  state.results = [];
  state.finishReason = null;
  state.lastAction = `${formatPlayerLabel(room, nextInfo.dealerSeat)} が親です。`;
  state.statusMessage = formatTurnMessage(room, nextInfo.dealerSeat, "が打牌する番です");
  room.roomStatus = "playing";
}

function finishMahjongByWin(
  room: RoomRecord,
  state: MahjongState,
  winnerSeat: number,
  sourceSeat: number | null,
  winType: "tsumo" | "ron",
  evaluation: MahjongWinEvaluation
): void {
  room.roomStatus = "finished";
  state.phase = "finished";
  state.currentSeat = null;
  state.pendingCall = null;
  state.tenpaiSeats = [winnerSeat];
  state.winnerSeats = [winnerSeat];
  state.scores = state.scores.map(
    (score, seat) => score + (evaluation.scoreDeltas[seat] ?? 0)
  );
  state.scores[winnerSeat] += state.riichiSticks * 1000;
  state.results = [{
    winnerSeat,
    sourceSeat,
    winType,
    han: evaluation.han,
    fu: evaluation.fu,
    total: evaluation.total,
    yaku: [...evaluation.yaku],
    scoreDeltas: [...evaluation.scoreDeltas],
    summary: evaluation.summary
  }];
  state.riichiSticks = 0;
  state.finishReason = evaluation.summary;
  const dealerContinues = winnerSeat === state.dealerSeat;
  const nextRoundLabel = resolveNextRoundLabel(state, dealerContinues, false);
  state.phase = nextRoundLabel === null ? "finished" : "round_result";
  state.statusMessage =
    winType === "tsumo"
      ? `${formatPlayerLabel(room, winnerSeat)} のツモ和了`
      : `${formatPlayerLabel(room, winnerSeat)} が ${formatPlayerLabel(room, sourceSeat ?? winnerSeat)} からロン和了`;
  if (state.phase === "round_result") {
    state.statusMessage += ` / 次局: ${nextRoundLabel}`;
  }
  state.lastAction = state.statusMessage;
  room.roomStatus = state.phase === "finished" ? "finished" : "playing";
}

function finishMahjongByRonSet(
  room: RoomRecord,
  state: MahjongState,
  winnerSeats: number[],
  discardSeat: number,
  discardTile: string
): void {
  const results = winnerSeats
    .map((winnerSeat) => {
      const evaluation = evaluateMahjongWin(room, state, winnerSeat, "ron", discardTile, discardSeat);
      return evaluation
        ? ({
            winnerSeat,
            sourceSeat: discardSeat,
            winType: "ron",
            han: evaluation.han,
            fu: evaluation.fu,
            total: evaluation.total,
            yaku: [...evaluation.yaku],
            scoreDeltas: [...evaluation.scoreDeltas],
            summary: evaluation.summary
          } satisfies MahjongResult)
        : null;
    })
    .filter((entry): entry is MahjongResult => entry !== null);

  assert(results.length > 0, "ロン和了結果を計算できませんでした", 500);

  const combinedDeltas = Array.from({ length: MAHJONG_SEAT_COUNT }, (_, seat) =>
    results.reduce((sum, result) => sum + (result.scoreDeltas[seat] ?? 0), 0)
  );

  room.roomStatus = "finished";
  state.phase = "finished";
  state.currentSeat = null;
  state.pendingCall = null;
  state.winnerSeats = [...winnerSeats];
  state.tenpaiSeats = [...winnerSeats];
  state.scores = state.scores.map((score, seat) => score + combinedDeltas[seat]);
  if (winnerSeats.length > 0) {
    const riichiReceiver =
      [...winnerSeats].sort(
        (left, right) =>
          ((left - discardSeat + MAHJONG_SEAT_COUNT) % MAHJONG_SEAT_COUNT) -
          ((right - discardSeat + MAHJONG_SEAT_COUNT) % MAHJONG_SEAT_COUNT)
      )[0] ?? winnerSeats[0];
    state.scores[riichiReceiver] += state.riichiSticks * 1000;
  }
  state.results = results;
  state.riichiSticks = 0;
  state.finishReason = results.map((result) => result.summary).join(" / ");
  const dealerContinues = winnerSeats.includes(state.dealerSeat);
  const nextRoundLabel = resolveNextRoundLabel(state, dealerContinues, false);
  state.phase = nextRoundLabel === null ? "finished" : "round_result";
  state.statusMessage =
    winnerSeats.length === 1
      ? `${formatPlayerLabel(room, winnerSeats[0])} が ${formatPlayerLabel(room, discardSeat)} からロン和了`
      : `${winnerSeats.map((seat) => formatPlayerLabel(room, seat)).join(" / ")} が ${formatPlayerLabel(room, discardSeat)} からダブロン`;
  if (state.phase === "round_result") {
    state.statusMessage += ` / 次局: ${nextRoundLabel}`;
  }
  state.lastAction = state.statusMessage;
  room.roomStatus = state.phase === "finished" ? "finished" : "playing";
}

function finishMahjongAsTripleRonDraw(room: RoomRecord, state: MahjongState, discardSeat: number): void {
  room.roomStatus = "finished";
  state.phase = "finished";
  state.currentSeat = null;
  state.pendingCall = null;
  state.winnerSeats = [];
  state.results = [];
  state.tenpaiSeats = [];
  state.finishReason = "三家和のため流局";
  state.phase = resolveNextRoundLabel(state, true, true) === null ? "finished" : "round_result";
  state.statusMessage = `${formatPlayerLabel(room, discardSeat)} の打牌に三家和が成立し流局です。`;
  if (state.phase === "round_result") {
    state.statusMessage += ` / 次局: ${resolveNextRoundLabel(state, true, true)}`;
  }
  state.lastAction = state.statusMessage;
  room.roomStatus = state.phase === "finished" ? "finished" : "playing";
}

function finishMahjongAsDraw(room: RoomRecord, state: MahjongState, tenpaiSeats: number[]): void {
  state.currentSeat = null;
  state.pendingCall = null;
  state.winnerSeats = [];
  state.results = [];
  state.tenpaiSeats = tenpaiSeats;
  applyNotenPenalty(state, tenpaiSeats);
  state.finishReason = tenpaiSeats.length > 0 ? `流局 / 聴牌: ${formatSeatLabels(room, tenpaiSeats)}` : "山が尽きたため流局";
  const dealerContinues = tenpaiSeats.includes(state.dealerSeat);
  const nextRoundLabel = resolveNextRoundLabel(state, dealerContinues, true);
  state.phase = nextRoundLabel === null ? "finished" : "round_result";
  state.statusMessage = `${state.roundLabel} は流局です。`;
  if (state.phase === "round_result") {
    state.statusMessage += ` / 次局: ${nextRoundLabel}`;
  }
  state.lastAction = `${state.lastAction ?? "最後の打牌"} / 山が尽きました`;
  room.roomStatus = state.phase === "finished" ? "finished" : "playing";
}

function buildPendingCallView(pending: MahjongPendingCall | null, selfSeat: number): MahjongPendingCallView | null {
  if (!pending || !canRespondToPendingCall(pending, selfSeat)) {
    return null;
  }

  const options: MahjongCallOptionView[] = [];
  if (pending.stage === "ron") {
    options.push({
      type: "ron",
      combinations: [[pending.discardTile]]
    });
  } else {
    if (pending.ponOption) {
      options.push({
        type: "pon",
        combinations: [pending.ponOption]
      });
    }
    if (pending.kanOption) {
      options.push({
        type: "kan",
        combinations: [pending.kanOption]
      });
    }
    if (pending.chiOptions.length > 0) {
      options.push({
        type: "chi",
        combinations: pending.chiOptions
      });
    }
  }

  return {
    stage: pending.stage,
    discardSeat: pending.discardSeat,
    discardTile: pending.discardTile,
    options
  };
}

function buildResultView(result: MahjongResult): MahjongResultView {
  return {
    winnerSeat: result.winnerSeat,
    sourceSeat: result.sourceSeat,
    winType: result.winType,
    han: result.han,
    fu: result.fu,
    total: result.total,
    yaku: [...result.yaku],
    scoreDeltas: [...result.scoreDeltas],
    summary: result.summary
  };
}

function buildPendingCallMessage(room: RoomRecord, pending: MahjongPendingCall): string {
  if (pending.stage === "ron") {
    const awaiting = pending.eligibleSeats
      .filter((seat) => isSeatAwaitingRonDecision(pending, seat))
      .map((seat) => formatPlayerLabel(room, seat));
    return `${
      pending.source === "kakan"
        ? `${formatPlayerLabel(room, pending.discardSeat)} の加槓 ${formatMahjongTile(pending.discardTile)}`
        : `${formatPlayerLabel(room, pending.discardSeat)} の ${formatMahjongTile(pending.discardTile)}`
    } に対してロン確認中: ${awaiting.join(" / ")}`;
  }

  const actions: string[] = [];
  if (pending.kanOption) {
    actions.push("カン");
  }
  if (pending.ponOption) {
    actions.push("ポン");
  }
  if (pending.chiOptions.length > 0) {
    actions.push("チー");
  }
  return `${formatPlayerLabel(room, pending.seat)} は ${formatPlayerLabel(room, pending.discardSeat)} の ${formatMahjongTile(
    pending.discardTile
  )} に ${actions.join(" / ")} できます`;
}

function canRespondToPendingCall(pending: MahjongPendingCall | null, selfSeat: number): boolean {
  if (!pending) {
    return false;
  }
  if (pending.stage === "ron") {
    return isSeatAwaitingRonDecision(pending, selfSeat);
  }
  return pending.seat === selfSeat;
}

function isSeatAwaitingRonDecision(pending: MahjongPendingCall, seat: number): boolean {
  return (
    pending.stage === "ron" &&
    pending.eligibleSeats.includes(seat) &&
    !pending.acceptedSeats.includes(seat) &&
    !pending.passedSeats.includes(seat)
  );
}

function settleRonWindow(room: RoomRecord, state: MahjongState, pending: MahjongPendingCall): void {
  assert(pending.stage === "ron", "ロン待ちではありません", 409);

  const unresolvedSeats = pending.eligibleSeats.filter((seat) => isSeatAwaitingRonDecision(pending, seat));
  if (unresolvedSeats.length > 0) {
    state.statusMessage = buildPendingCallMessage(room, pending);
    return;
  }

  if (pending.acceptedSeats.length >= 3) {
    finishMahjongAsTripleRonDraw(room, state, pending.discardSeat);
    return;
  }

  if (pending.acceptedSeats.length > 0) {
    finishMahjongByRonSet(
      room,
      state,
      [...pending.acceptedSeats].sort((left, right) => left - right),
      pending.discardSeat,
      pending.discardTile
    );
    return;
  }

  if (pending.source === "kakan") {
    assert(
      typeof pending.kakanSeat === "number" &&
        typeof pending.kakanMeldIndex === "number" &&
        typeof pending.kakanTile === "string",
      "加槓解決情報が不足しています",
      500
    );
    finalizeKakanWithoutRon(room, state, pending.kakanSeat, pending.kakanMeldIndex, pending.kakanTile);
    return;
  }

  state.pendingCall = findClaimPendingCall(room, state, pending.discardSeat, pending.discardTile);
  if (state.pendingCall) {
    state.statusMessage = buildPendingCallMessage(room, state.pendingCall);
    return;
  }

  resolveDiscardWithoutCall(room, state, pending.discardSeat);
}

function resolveStoredNextRoundInfo(state: MahjongState) {
  if (state.winnerSeats.length > 0) {
    return resolveNextRoundInfo(state, {
      dealerContinues: state.winnerSeats.includes(state.dealerSeat),
      draw: false
    });
  }

  return resolveNextRoundInfo(state, {
    dealerContinues:
      state.tenpaiSeats.includes(state.dealerSeat) || state.finishReason?.includes("三家和") === true,
    draw: true
  });
}

function resolveNextRoundLabel(state: MahjongState, dealerContinues: boolean, draw = false): string | null {
  const info = resolveNextRoundInfo(state, {
    dealerContinues,
    draw
  });
  return info ? formatRoundLabel(info.roundWind, info.roundNumber) : null;
}

function resolveNextRoundInfo(
  state: MahjongState,
  options: {
    dealerContinues: boolean;
    draw: boolean;
  }
) {
  if (state.scores.some((score) => score < 0)) {
    return null;
  }

  let dealerSeat = state.dealerSeat;
  let roundWind = state.roundWind;
  let roundNumber = state.roundNumber;
  const honba = options.draw ? state.honba + 1 : options.dealerContinues ? state.honba + 1 : 0;

  if (!options.dealerContinues) {
    dealerSeat = (dealerSeat + 1) % MAHJONG_SEAT_COUNT;
    if (dealerSeat === 0) {
      if (roundNumber === 4) {
        if (state.matchType === "hanchan" && roundWind === "east") {
          roundWind = "south";
          roundNumber = 1;
        } else {
          return null;
        }
      } else {
        roundNumber += 1;
      }
    }
  }

  return {
    matchType: state.matchType,
    roundWind,
    roundNumber,
    dealerSeat,
    honba
  };
}

function formatRoundLabel(roundWind: "east" | "south", roundNumber: number): string {
  return `${roundWind === "east" ? "東" : "南"}${roundNumber}局`;
}

function evaluateMahjongWin(
  room: RoomRecord,
  state: MahjongState,
  seat: number,
  winType: "tsumo" | "ron",
  winningTile: string | null,
  sourceSeat: number | null
): MahjongWinEvaluation | null {
  const resolvedWinningTile = winType === "tsumo" ? state.lastDrawTile : winningTile;
  const concealedTiles =
    winType === "ron" ? [...(state.hands[seat] ?? []), winningTile ?? ""] : [...(state.hands[seat] ?? [])];
  if (resolvedWinningTile === null) {
    return null;
  }

  const openMelds = state.melds[seat] ?? [];
  const totalTileCount =
    concealedTiles.filter(Boolean).length + openMelds.reduce((sum, meld) => sum + meld.tiles.length, 0);
  if (totalTileCount !== 14) {
    return null;
  }

  const analysis = analyzeWinningHand(concealedTiles.filter(Boolean), openMelds.length);
  if (!analysis) {
    return null;
  }

  const closedHand = openMelds.length === 0;
  const allKinds = [
    ...concealedTiles.filter(Boolean).map((tile) => getMahjongTileKind(tile)),
    ...openMelds.flatMap((meld) => meld.tiles.map((tile) => getMahjongTileKind(tile)))
  ];
  const yaku: string[] = [];
  let han = 0;

  if (state.riichiSeats.includes(seat)) {
    yaku.push("立直");
    han += 1;
  }

  if (state.ippatsuEligible[seat]) {
    yaku.push("一発");
    han += 1;
  }

  if (analysis.kind === "chiitoitsu") {
    yaku.push("七対子");
    han += 2;
  }

  if (closedHand && winType === "tsumo") {
    yaku.push("門前清自摸和");
    han += 1;
  }

  if (allKinds.every((kind) => isSimpleKind(kind))) {
    yaku.push("断么九");
    han += 1;
  }

  if (analysis.kind === "standard" && isToitoi(analysis, openMelds)) {
    yaku.push("対々和");
    han += 2;
  }

  const sequencePairCount = countIdenticalSequencePairs(analysis);
  if (analysis.kind === "standard" && closedHand && sequencePairCount >= 2) {
    yaku.push("二盃口");
    han += 3;
  } else if (analysis.kind === "standard" && closedHand && sequencePairCount >= 1) {
    yaku.push("一盃口");
    han += 1;
  }

  if (analysis.kind === "standard" && hasPinfu(state, seat, analysis, winType, getMahjongTileKind(resolvedWinningTile))) {
    yaku.push("平和");
    han += 1;
  }

  if (analysis.kind === "standard" && hasSanshokuDoujun(analysis, openMelds)) {
    yaku.push("三色同順");
    han += closedHand ? 2 : 1;
  }

  if (analysis.kind === "standard" && hasSanshokuDokou(analysis, openMelds)) {
    yaku.push("三色同刻");
    han += 2;
  }

  if (analysis.kind === "standard" && hasIttsu(analysis, openMelds)) {
    yaku.push("一気通貫");
    han += closedHand ? 2 : 1;
  }

  if (analysis.kind === "standard" && hasChanta(analysis, openMelds, true)) {
    yaku.push("純全帯么九");
    han += closedHand ? 3 : 2;
  } else if (analysis.kind === "standard" && hasChanta(analysis, openMelds, false)) {
    yaku.push("混全帯么九");
    han += closedHand ? 2 : 1;
  }

  if (hasHonroutou(allKinds)) {
    yaku.push("混老頭");
    han += 2;
  }

  if (analysis.kind === "standard" && hasShousangen(analysis, openMelds)) {
    yaku.push("小三元");
    han += 2;
  }

  if (analysis.kind === "standard" && hasSanankou(state, seat, analysis, openMelds, winType, resolvedWinningTile)) {
    yaku.push("三暗刻");
    han += 2;
  }

  if (countKans(openMelds) + countKans(state.melds[seat].filter((meld) => !meld.open)) >= 3) {
    yaku.push("三槓子");
    han += 2;
  }

  const yakuhai = collectYakuhai(room, state, seat, analysis, openMelds);
  yaku.push(...yakuhai);
  han += yakuhai.length;

  const suitYaku = resolveSuitYaku(allKinds, closedHand);
  if (suitYaku) {
    yaku.push(suitYaku.name);
    han += suitYaku.han;
  }

  const doraCount = countDora(state, allKinds);
  if (doraCount > 0) {
    yaku.push(`ドラ ${doraCount}`);
    han += doraCount;
  }

  if (state.drawSource === "rinshan" && winType === "tsumo") {
    yaku.push("嶺上開花");
    han += 1;
  }

  if (winType === "tsumo" && state.wall.length === 0) {
    yaku.push("海底摸月");
    han += 1;
  }

  if (winType === "ron" && state.wall.length === 0 && state.pendingCall?.stage === "ron" && state.pendingCall.source === "discard") {
    yaku.push("河底撈魚");
    han += 1;
  }

  if (winType === "ron" && state.pendingCall?.stage === "ron" && state.pendingCall.source === "kakan") {
    yaku.push("槍槓");
    han += 1;
  }

  const hasBaseYaku = yaku.some((entry) => !entry.startsWith("ドラ "));
  if (!hasBaseYaku) {
    return null;
  }

  const fu = calculateFu(
    state,
    seat,
    winType,
    analysis,
    openMelds,
    closedHand,
    getMahjongTileKind(resolvedWinningTile)
  );
  const { total, scoreDeltas, summary } = calculateWinningPayments(
    room,
    state,
    seat,
    winType,
    fu,
    han,
    sourceSeat
  );

  return {
    han,
    fu,
    total,
    yaku,
    scoreDeltas,
    summary
  };
}

function analyzeWinningHand(concealedTiles: string[], openMeldCount: number): MahjongAnalysis | null {
  const kinds = concealedTiles.map((tile) => getMahjongTileKind(tile));
  const counts = buildKindCounts(kinds);

  if (openMeldCount === 0) {
    const chiitoitsu = analyzeChiitoitsu(counts);
    if (chiitoitsu) {
      return chiitoitsu;
    }
  }

  const requiredMelds = 4 - openMeldCount;
  if (requiredMelds < 0) {
    return null;
  }

  for (let pairIndex = 0; pairIndex < counts.length; pairIndex += 1) {
    if (counts[pairIndex] < 2) {
      continue;
    }
    counts[pairIndex] -= 2;
    const melds: AnalyzedMeld[] = [];
    if (extractStandardMelds(counts, requiredMelds, melds)) {
      counts[pairIndex] += 2;
      return {
        kind: "standard",
        pairKind: indexToKind(pairIndex),
        melds
      };
    }
    counts[pairIndex] += 2;
  }

  return null;
}

function analyzeChiitoitsu(counts: number[]): MahjongAnalysis | null {
  const pairKinds: string[] = [];
  for (let index = 0; index < counts.length; index += 1) {
    if (counts[index] === 0) {
      continue;
    }
    if (counts[index] !== 2) {
      return null;
    }
    pairKinds.push(indexToKind(index));
  }

  if (pairKinds.length !== 7) {
    return null;
  }

  return {
    kind: "chiitoitsu",
    pairKinds
  };
}

function extractStandardMelds(counts: number[], requiredMelds: number, melds: AnalyzedMeld[]): boolean {
  if (melds.length === requiredMelds) {
    return counts.every((count) => count === 0);
  }

  const nextIndex = counts.findIndex((count) => count > 0);
  if (nextIndex < 0) {
    return false;
  }

  if (counts[nextIndex] >= 3) {
    counts[nextIndex] -= 3;
    melds.push({
      type: "triplet",
      kinds: [indexToKind(nextIndex), indexToKind(nextIndex), indexToKind(nextIndex)]
    });
    if (extractStandardMelds(counts, requiredMelds, melds)) {
      return true;
    }
    melds.pop();
    counts[nextIndex] += 3;
  }

  const suitIndex = Math.floor(nextIndex / 9);
  const rank = (nextIndex % 9) + 1;
  const canSequence = suitIndex < 3 && rank <= 7 && counts[nextIndex + 1] > 0 && counts[nextIndex + 2] > 0;
  if (canSequence) {
    counts[nextIndex] -= 1;
    counts[nextIndex + 1] -= 1;
    counts[nextIndex + 2] -= 1;
    melds.push({
      type: "sequence",
      kinds: [indexToKind(nextIndex), indexToKind(nextIndex + 1), indexToKind(nextIndex + 2)]
    });
    if (extractStandardMelds(counts, requiredMelds, melds)) {
      return true;
    }
    melds.pop();
    counts[nextIndex] += 1;
    counts[nextIndex + 1] += 1;
    counts[nextIndex + 2] += 1;
  }

  return false;
}

function findRonPendingCall(
  room: RoomRecord,
  state: MahjongState,
  discardSeat: number,
  discardTile: string
): MahjongPendingCall | null {
  const turnOrder = Array.from({ length: MAHJONG_SEAT_COUNT - 1 }, (_, index) => (discardSeat + index + 1) % MAHJONG_SEAT_COUNT);

  const ronSeats = turnOrder.filter(
    (seat) =>
      room.players.find((player) => player.seat === seat)?.connected !== false &&
      !isSeatFuriten(state, seat) &&
      evaluateMahjongWin(room, state, seat, "ron", discardTile, discardSeat) !== null
  );
  if (ronSeats.length > 0) {
    return {
      stage: "ron",
      discardSeat,
      discardTile,
      source: "discard",
      eligibleSeats: ronSeats,
      acceptedSeats: [],
      passedSeats: []
    };
  }

  return null;
}

function findClaimPendingCall(
  room: RoomRecord,
  state: MahjongState,
  discardSeat: number,
  discardTile: string
): MahjongPendingCall | null {
  const turnOrder = Array.from({ length: MAHJONG_SEAT_COUNT - 1 }, (_, index) => (discardSeat + index + 1) % MAHJONG_SEAT_COUNT);

  for (const seat of turnOrder) {
    const player = room.players.find((entry) => entry.seat === seat);
    if (!player || player.connected === false || state.riichiSeats.includes(seat)) {
      continue;
    }
    const hand = state.hands[seat] ?? [];
    const ponOption = findMatchingKindTiles(hand, discardTile, 2);
    const kanOption = findMatchingKindTiles(hand, discardTile, 3);
    if (ponOption || kanOption) {
      return {
        stage: "call",
        seat,
        discardSeat,
        discardTile,
        chiOptions: seat === (discardSeat + 1) % MAHJONG_SEAT_COUNT ? findChiOptions(hand, discardTile) : [],
        ponOption,
        kanOption
      };
    }
  }

  const nextSeat = (discardSeat + 1) % MAHJONG_SEAT_COUNT;
  const nextPlayer = room.players.find((entry) => entry.seat === nextSeat);
  if (!nextPlayer || nextPlayer.connected === false) {
    return null;
  }
  const chiOptions = findChiOptions(state.hands[nextSeat] ?? [], discardTile);
  if (chiOptions.length > 0) {
    return {
      stage: "call",
      seat: nextSeat,
      discardSeat,
      discardTile,
      chiOptions,
      ponOption: null,
      kanOption: null
    };
  }

  return null;
}

function findMatchingKindTiles(hand: string[], discardTile: string, count: number): string[] | null {
  const discardKind = getMahjongTileKind(discardTile);
  const matches = hand.filter((tile) => getMahjongTileKind(tile) === discardKind);
  return matches.length >= count ? matches.slice(0, count) : null;
}

function findChiOptions(hand: string[], discardTile: string): string[][] {
  if (isMahjongHonor(discardTile)) {
    return [];
  }

  const suit = getMahjongTileSuit(discardTile);
  const rank = getMahjongTileRank(discardTile);
  const patterns = [
    [rank - 2, rank - 1],
    [rank - 1, rank + 1],
    [rank + 1, rank + 2]
  ];

  const options: string[][] = [];
  for (const pattern of patterns) {
    if (pattern.some((value) => value < 1 || value > 9)) {
      continue;
    }
    const selected: string[] = [];
    let valid = true;
    for (const neededRank of pattern) {
      const tile = hand.find(
        (candidate) =>
          !selected.includes(candidate) &&
          getMahjongTileSuit(candidate) === suit &&
          getMahjongTileRank(candidate) === neededRank
      );
      if (!tile) {
        valid = false;
        break;
      }
      selected.push(tile);
    }
    if (valid) {
      options.push(sortMahjongTiles(selected));
    }
  }

  return dedupeTileSelections(options);
}

function dedupeTileSelections(options: string[][]): string[][] {
  const seen = new Set<string>();
  return options.filter((option) => {
    const key = normalizeCallSelection(option).join("|");
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function drawFromWall(state: MahjongState, seat: number): void {
  const tile = state.wall.shift();
  assert(tile, "山から牌を引けませんでした", 500);
  state.hands[seat].push(tile);
  state.hands[seat] = sortMahjongTiles(state.hands[seat]);
  state.lastDrawTile = tile;
  state.lastDrawSeat = seat;
  state.drawSource = "wall";
  state.sameTurnFuriten[seat] = false;
}

function drawRinshanTile(state: MahjongState, seat: number): void {
  const tile = state.deadWall.pop();
  assert(tile, "嶺上牌を引けませんでした", 500);
  state.hands[seat].push(tile);
  state.hands[seat] = sortMahjongTiles(state.hands[seat]);
  state.lastDrawTile = tile;
  state.lastDrawSeat = seat;
  state.drawSource = "rinshan";
  state.sameTurnFuriten[seat] = false;
}

function clearIppatsuFlags(state: MahjongState): void {
  state.ippatsuEligible = state.ippatsuEligible.map(() => false);
}

function revealNextDoraIndicator(state: MahjongState): void {
  const nextIndicator = state.deadWall[state.doraIndicators.length + 4];
  if (nextIndicator) {
    state.doraIndicators.push(nextIndicator);
  }
}

function canDiscardTile(state: MahjongState, seat: number, tile: string): boolean {
  if (!state.riichiSeats.includes(seat)) {
    return true;
  }
  return state.lastDrawSeat === seat && state.lastDrawTile === tile;
}

function getRiichiDiscardOptions(room: RoomRecord, state: MahjongState, seat: number): string[] {
  if (state.phase !== "playing" || state.currentSeat !== seat) {
    return [];
  }
  if (state.riichiSeats.includes(seat)) {
    return [];
  }
  if (state.melds[seat].some((meld) => meld.open)) {
    return [];
  }
  if ((state.scores[seat] ?? 0) < 1000) {
    return [];
  }

  const hand = state.hands[seat] ?? [];
  if (hand.length % 3 !== 2) {
    return [];
  }

  const distinctTiles = dedupeTileSelections(hand.map((tile) => [tile])).map((group) => group[0]);
  return distinctTiles.filter((tile) => {
    if (!canDiscardTile(state, seat, tile)) {
      return false;
    }
    const remaining = removeTileOnce(hand, tile);
    return getWinningKindsForConcealedHand(remaining).length > 0;
  });
}

function getAnkanOptions(state: MahjongState, seat: number): string[][] {
  if (state.phase !== "playing" || state.currentSeat !== seat) {
    return [];
  }
  if (state.riichiSeats.includes(seat)) {
    return [];
  }

  const hand = state.hands[seat] ?? [];
  const byKind = groupTilesByKind(hand);
  return [...byKind.values()]
    .filter((tiles) => tiles.length >= 4)
    .map((tiles) => sortMahjongTiles(tiles.slice(0, 4)));
}

function getKakanOptions(state: MahjongState, seat: number): string[] {
  if (state.phase !== "playing" || state.currentSeat !== seat) {
    return [];
  }
  if (state.riichiSeats.includes(seat)) {
    return [];
  }

  const hand = state.hands[seat] ?? [];
  const openPonKinds = (state.melds[seat] ?? [])
    .filter((meld) => meld.type === "pon" && meld.open)
    .map((meld) => getMahjongTileKind(meld.tiles[0]));

  return hand.filter((tile) => openPonKinds.includes(getMahjongTileKind(tile)));
}

function groupTilesByKind(hand: string[]): Map<string, string[]> {
  const map = new Map<string, string[]>();
  for (const tile of hand) {
    const kind = getMahjongTileKind(tile);
    const group = map.get(kind) ?? [];
    group.push(tile);
    map.set(kind, group);
  }
  return map;
}

function removeTileOnce(hand: string[], tile: string): string[] {
  const copy = [...hand];
  const index = copy.indexOf(tile);
  if (index >= 0) {
    copy.splice(index, 1);
  }
  return copy;
}

function getWinningKindsForConcealedHand(hand: string[]): string[] {
  return getWinningKindsForHand(hand, 0);
}

function getWinningKindsForHand(hand: string[], openMeldCount: number): string[] {
  const winningKinds: string[] = [];
  for (let index = 0; index < 34; index += 1) {
    const kind = indexToKind(index);
    const candidateHand = [...hand, `${kind}-candidate`];
    if (analyzeWinningHand(candidateHand, openMeldCount)) {
      winningKinds.push(kind);
    }
  }
  return dedupeKinds(winningKinds);
}

function calculateTenpaiSeats(room: RoomRecord, state: MahjongState): number[] {
  return room.players
    .filter((player) => isSeatTenpai(state, player.seat))
    .map((player) => player.seat)
    .sort((left, right) => left - right);
}

function isSeatTenpai(state: MahjongState, seat: number): boolean {
  return getWinningKindsForSeat(state, seat).length > 0;
}

function applyNotenPenalty(state: MahjongState, tenpaiSeats: number[]): void {
  if (tenpaiSeats.length === 0 || tenpaiSeats.length === MAHJONG_SEAT_COUNT) {
    return;
  }

  const notenSeats = Array.from({ length: MAHJONG_SEAT_COUNT }, (_, seat) => seat).filter(
    (seat) => !tenpaiSeats.includes(seat)
  );
  const tenpaiGain = TURN_DRAW_FURITEN_PENALTY / tenpaiSeats.length;
  const notenLoss = TURN_DRAW_FURITEN_PENALTY / notenSeats.length;

  for (const seat of tenpaiSeats) {
    state.scores[seat] += tenpaiGain;
  }
  for (const seat of notenSeats) {
    state.scores[seat] -= notenLoss;
  }
}

function removeTilesFromHand(hand: string[], tiles: string[]): void {
  for (const tile of tiles) {
    const index = hand.indexOf(tile);
    assert(index >= 0, "鳴きに必要な牌が手牌にありません", 409);
    hand.splice(index, 1);
  }
}

function chooseMahjongBotDiscard(state: MahjongState, seat: number): string {
  const hand = state.hands[seat] ?? [];
  assert(hand.length > 0, "bot の手牌が空です", 500);

  const kindCounts = new Map<string, number>();
  for (const tile of hand) {
    const kind = getMahjongTileKind(tile);
    kindCounts.set(kind, (kindCounts.get(kind) ?? 0) + 1);
  }

  return [...hand].sort((left, right) => {
    const scoreDiff =
      scoreDiscardChoice(state, seat, right, hand, kindCounts) - scoreDiscardChoice(state, seat, left, hand, kindCounts);
    if (scoreDiff !== 0) {
      return scoreDiff;
    }
    return compareMahjongTiles(right, left);
  })[0];
}

function scoreDiscardChoice(
  state: MahjongState,
  seat: number,
  tile: string,
  hand: string[],
  kindCounts: Map<string, number>
): number {
  const remaining = removeTileOnce(hand, tile);
  const handValue = estimateHandProgress(remaining, state.melds[seat].length);
  const doraPenalty = isDoraTile(state, tile) ? 10 : 0;
  return handValue + scoreDiscardTile(tile, hand, kindCounts) - doraPenalty;
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
    const neighbor = hand.some(
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

    if (neighbor) {
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

function estimateBestDiscardPlan(hand: string[], openMeldCount: number): number {
  if (hand.length === 0) {
    return 0;
  }

  const distinctTiles = dedupeTileSelections(hand.map((tile) => [tile])).map((group) => group[0]);
  return Math.max(
    ...distinctTiles.map((tile) => estimateHandProgress(removeTileOnce(hand, tile), openMeldCount))
  );
}

function estimateHandProgress(hand: string[], openMeldCount: number): number {
  const winningKinds = getWinningKindsForHand(hand, openMeldCount);
  const byKind = groupTilesByKind(hand);
  let score = winningKinds.length * 80 + openMeldCount * 30;

  for (const [kind, tiles] of byKind.entries()) {
    if (tiles.length >= 3) {
      score += 22;
    } else if (tiles.length === 2) {
      score += 10;
    }

    if (isSimpleKind(kind)) {
      score += 2;
    }
  }

  for (const tile of hand) {
    if (isMahjongTerminalOrHonor(tile)) {
      score -= 1;
    }
    if (hasStraightNeighbors(hand, tile)) {
      score += 4;
    }
  }

  return score;
}

function hasStraightNeighbors(hand: string[], tile: string): boolean {
  if (isMahjongHonor(tile)) {
    return false;
  }
  const suit = getMahjongTileSuit(tile);
  const rank = getMahjongTileRank(tile);
  const ranks = hand
    .filter((candidate) => candidate !== tile && getMahjongTileSuit(candidate) === suit)
    .map((candidate) => getMahjongTileRank(candidate));

  return (
    (ranks.includes(rank - 2) && ranks.includes(rank - 1)) ||
    (ranks.includes(rank - 1) && ranks.includes(rank + 1)) ||
    (ranks.includes(rank + 1) && ranks.includes(rank + 2))
  );
}

function calculateFu(
  state: MahjongState,
  seat: number,
  winType: "tsumo" | "ron",
  analysis: MahjongAnalysis,
  openMelds: MahjongMeld[],
  closedHand: boolean,
  winningKind: string
): number {
  if (analysis.kind === "chiitoitsu") {
    return 25;
  }

  if (hasPinfu(state, seat, analysis, winType, winningKind)) {
    return winType === "tsumo" ? 20 : 30;
  }

  let fu = 20;
  if (winType === "tsumo") {
    fu += 2;
  }
  if (winType === "ron" && closedHand) {
    fu += 10;
  }

  if (isValueKind(state, seat, analysis.pairKind)) {
    fu += 2;
    if (analysis.pairKind === getRoundWindKind(state) && getSeatWindKind(state, seat) === getRoundWindKind(state)) {
      fu += 2;
    }
  }

  for (const meld of analysis.melds) {
    if (meld.type === "sequence") {
      continue;
    }
    const kind = meld.kinds[0];
    fu += calculateMeldFu(kind, false, false);
  }

  for (const meld of openMelds) {
    if (meld.type === "chi") {
      continue;
    }
    const kind = getMahjongTileKind(meld.tiles[0]);
    fu += calculateMeldFu(kind, true, meld.type === "kan");
  }

  fu += calculateWaitFu(analysis, winningKind);
  if (!closedHand && fu === 20) {
    fu = 30;
  }

  return roundUpToTen(Math.max(20, fu));
}

function calculateMeldFu(kind: string, open: boolean, kan: boolean): number {
  const terminalOrHonor = isTerminalOrHonorKind(kind);
  if (kan) {
    if (open) {
      return terminalOrHonor ? 16 : 8;
    }
    return terminalOrHonor ? 32 : 16;
  }
  if (open) {
    return terminalOrHonor ? 4 : 2;
  }
  return terminalOrHonor ? 8 : 4;
}

function collectYakuhai(
  room: RoomRecord,
  state: MahjongState,
  seat: number,
  analysis: MahjongAnalysis,
  openMelds: MahjongMeld[]
): string[] {
  if (analysis.kind !== "standard") {
    return [];
  }

  const meldKinds = [
    ...analysis.melds.filter((meld) => meld.type === "triplet").map((meld) => meld.kinds[0]),
    ...openMelds.filter((meld) => meld.type === "pon" || meld.type === "kan").map((meld) => getMahjongTileKind(meld.tiles[0]))
  ];
  const result: string[] = [];
  const seatWind = getSeatWindKind(state, seat);
  const roundWind = getRoundWindKind(state);

  for (const kind of meldKinds) {
    if (kind === roundWind) {
      result.push(`役牌: 場風 ${formatMahjongKind(kind)}`);
    }
    if (kind === seatWind) {
      result.push(`役牌: 自風 ${formatMahjongKind(kind)}`);
    }
    if (kind === "z5" || kind === "z6" || kind === "z7") {
      result.push(`役牌: ${formatMahjongKind(kind)}`);
    }
  }

  return result;
}

function resolveSuitYaku(
  allKinds: string[],
  closedHand: boolean
): { name: string; han: number } | null {
  const suits = new Set(allKinds.filter((kind) => !kind.startsWith("z")).map((kind) => kind.slice(0, 1)));
  const hasHonor = allKinds.some((kind) => kind.startsWith("z"));

  if (suits.size !== 1) {
    return null;
  }

  if (hasHonor) {
    return {
      name: "混一色",
      han: closedHand ? 3 : 2
    };
  }

  return {
    name: "清一色",
    han: closedHand ? 6 : 5
  };
}

function countDora(state: MahjongState, allKinds: string[]): number {
  return state.doraIndicators.reduce((sum, indicator) => {
    const doraKind = resolveDoraKind(getMahjongTileKind(indicator));
    return sum + allKinds.filter((kind) => kind === doraKind).length;
  }, 0);
}

function isDoraTile(state: MahjongState, tile: string): boolean {
  const kind = getMahjongTileKind(tile);
  return state.doraIndicators.some((indicator) => resolveDoraKind(getMahjongTileKind(indicator)) === kind);
}

function calculateWinningPayments(
  room: RoomRecord,
  state: MahjongState,
  winnerSeat: number,
  winType: "tsumo" | "ron",
  fu: number,
  han: number,
  sourceSeat: number | null
): { total: number; scoreDeltas: number[]; summary: string } {
  const basePoints = calculateBasePoints(han, fu);
  const scoreDeltas = Array.from({ length: MAHJONG_SEAT_COUNT }, () => 0);
  const dealer = winnerSeat === state.dealerSeat;
  const honbaBonus = state.honba * 300;
  let total = 0;

  if (winType === "ron") {
    assert(sourceSeat !== null, "ロン和了の放銃者が見つかりません", 500);
    total = roundUpToHundred(basePoints * (dealer ? 6 : 4)) + honbaBonus;
    scoreDeltas[winnerSeat] += total;
    scoreDeltas[sourceSeat] -= total;
    return {
      total,
      scoreDeltas,
      summary: `${formatPlayerLabel(room, winnerSeat)} が ${formatPlayerLabel(room, sourceSeat)} からロン ${han} 翻 ${fu} 符 ${total} 点`
    };
  }

  if (dealer) {
    const payment = roundUpToHundred(basePoints * 2) + state.honba * 100;
    for (let seat = 0; seat < MAHJONG_SEAT_COUNT; seat += 1) {
      if (seat === winnerSeat) {
        continue;
      }
      scoreDeltas[seat] -= payment;
      total += payment;
    }
    scoreDeltas[winnerSeat] += total;
    return {
      total,
      scoreDeltas,
      summary: `${formatPlayerLabel(room, winnerSeat)} のツモ ${han} 翻 ${fu} 符 ${payment} オール`
    };
  }

  const dealerPayment = roundUpToHundred(basePoints * 2) + state.honba * 100;
  const childPayment = roundUpToHundred(basePoints) + state.honba * 100;
  for (let seat = 0; seat < MAHJONG_SEAT_COUNT; seat += 1) {
    if (seat === winnerSeat) {
      continue;
    }
    const payment = seat === state.dealerSeat ? dealerPayment : childPayment;
    scoreDeltas[seat] -= payment;
    total += payment;
  }
  scoreDeltas[winnerSeat] += total;

  return {
    total,
    scoreDeltas,
    summary: `${formatPlayerLabel(room, winnerSeat)} のツモ ${han} 翻 ${fu} 符 ${dealerPayment}-${childPayment}`
  };
}

function calculateBasePoints(han: number, fu: number): number {
  if (han >= 13) {
    return 8000;
  }
  if (han >= 11) {
    return 6000;
  }
  if (han >= 8) {
    return 4000;
  }
  if (han >= 6) {
    return 3000;
  }

  const raw = fu * 2 ** (han + 2);
  if (han >= 5 || (han === 4 && fu >= 40) || (han === 3 && fu >= 70)) {
    return 2000;
  }
  return Math.min(2000, raw);
}

function calculateWaitFu(analysis: MahjongAnalysis, winningKind: string): number {
  if (analysis.kind !== "standard") {
    return 0;
  }

  if (analysis.pairKind === winningKind) {
    return 2;
  }

  for (const meld of analysis.melds) {
    if (meld.type !== "sequence" || !meld.kinds.includes(winningKind)) {
      continue;
    }

    const ranks = meld.kinds.map((kind) => Number.parseInt(kind.slice(1), 10));
    if (ranks[0] === 1 && ranks[1] === 2 && ranks[2] === 3 && ranks[2] === Number.parseInt(winningKind.slice(1), 10)) {
      return 2;
    }
    if (ranks[0] === 7 && ranks[1] === 8 && ranks[2] === 9 && ranks[0] === Number.parseInt(winningKind.slice(1), 10)) {
      return 2;
    }
    if (ranks[1] === Number.parseInt(winningKind.slice(1), 10)) {
      return 2;
    }
  }

  return 0;
}

function isToitoi(analysis: MahjongAnalysis, openMelds: MahjongMeld[]): boolean {
  return (
    analysis.kind === "standard" &&
    analysis.melds.every((meld) => meld.type === "triplet") &&
    openMelds.every((meld) => meld.type === "pon" || meld.type === "kan")
  );
}

function hasSanshokuDoujun(analysis: MahjongAnalysis, openMelds: MahjongMeld[]): boolean {
  if (analysis.kind !== "standard") {
    return false;
  }

  const byRank = new Map<number, Set<string>>();
  const sequences = [
    ...analysis.melds.filter((meld) => meld.type === "sequence").map((meld) => meld.kinds),
    ...openMelds
      .filter((meld) => meld.type === "chi")
      .map((meld) => meld.tiles.map((tile) => getMahjongTileKind(tile)))
  ].filter((kinds) => kinds.every((kind) => !kind.startsWith("z")));

  for (const kinds of sequences) {
    const rank = Number.parseInt(kinds[0].slice(1), 10);
    const suits = byRank.get(rank) ?? new Set<string>();
    suits.add(kinds[0].slice(0, 1));
    byRank.set(rank, suits);
  }

  return [...byRank.values()].some((suits) => suits.size === 3);
}

function hasSanshokuDokou(analysis: MahjongAnalysis, openMelds: MahjongMeld[]): boolean {
  if (analysis.kind !== "standard") {
    return false;
  }

  const tripletKinds = [
    ...analysis.melds.filter((meld) => meld.type === "triplet").map((meld) => meld.kinds[0]),
    ...openMelds
      .filter((meld) => meld.type === "pon" || meld.type === "kan")
      .map((meld) => getMahjongTileKind(meld.tiles[0]))
  ].filter((kind) => !kind.startsWith("z"));

  const byRank = new Map<number, Set<string>>();
  for (const kind of tripletKinds) {
    const rank = Number.parseInt(kind.slice(1), 10);
    const suits = byRank.get(rank) ?? new Set<string>();
    suits.add(kind.slice(0, 1));
    byRank.set(rank, suits);
  }

  return [...byRank.values()].some((suits) => suits.size === 3);
}

function hasIttsu(analysis: MahjongAnalysis, openMelds: MahjongMeld[]): boolean {
  if (analysis.kind !== "standard") {
    return false;
  }

  const sequenceKinds = [
    ...analysis.melds.filter((meld) => meld.type === "sequence").map((meld) => meld.kinds),
    ...openMelds
      .filter((meld) => meld.type === "chi")
      .map((meld) => meld.tiles.map((tile) => getMahjongTileKind(tile)))
  ];

  for (const suit of ["m", "p", "s"] as const) {
    const starts = new Set(
      sequenceKinds
        .filter((kinds) => kinds.every((kind) => kind.startsWith(suit)))
        .map((kinds) => Number.parseInt(kinds[0].slice(1), 10))
    );
    if (starts.has(1) && starts.has(4) && starts.has(7)) {
      return true;
    }
  }

  return false;
}

function hasChanta(analysis: MahjongAnalysis, openMelds: MahjongMeld[], pure: boolean): boolean {
  if (analysis.kind !== "standard") {
    return false;
  }

  const allMeldKinds = [
    ...analysis.melds.map((meld) => meld.kinds),
    ...openMelds.map((meld) => meld.tiles.map((tile) => getMahjongTileKind(tile)))
  ];
  const pairKind = analysis.pairKind;

  if (pure && pairKind.startsWith("z")) {
    return false;
  }
  if (!isTerminalOrHonorKind(pairKind)) {
    return false;
  }

  let hasSequence = false;
  for (const kinds of allMeldKinds) {
    const hasTerminalsOrHonors = kinds.some((kind) => isTerminalOrHonorKind(kind));
    if (!hasTerminalsOrHonors) {
      return false;
    }
    if (pure && kinds.some((kind) => kind.startsWith("z"))) {
      return false;
    }
    const sequence = kinds[0] !== kinds[1] || kinds[1] !== kinds[2];
    if (sequence) {
      hasSequence = true;
      const ranks = kinds.map((kind) => Number.parseInt(kind.slice(1), 10));
      if (!(ranks[0] === 1 || ranks[0] === 7)) {
        return false;
      }
    }
  }

  return hasSequence;
}

function hasHonroutou(allKinds: string[]): boolean {
  return allKinds.every((kind) => isTerminalOrHonorKind(kind));
}

function hasShousangen(analysis: MahjongAnalysis, openMelds: MahjongMeld[]): boolean {
  if (analysis.kind !== "standard") {
    return false;
  }

  const dragonKinds = new Set(["z5", "z6", "z7"]);
  const triplets = [
    ...analysis.melds.filter((meld) => meld.type === "triplet").map((meld) => meld.kinds[0]),
    ...openMelds
      .filter((meld) => meld.type === "pon" || meld.type === "kan")
      .map((meld) => getMahjongTileKind(meld.tiles[0]))
  ].filter((kind) => dragonKinds.has(kind));

  const tripletSet = new Set(triplets);
  return tripletSet.size === 2 && dragonKinds.has(analysis.pairKind);
}

function hasSanankou(
  state: MahjongState,
  seat: number,
  analysis: MahjongAnalysis,
  _openMelds: MahjongMeld[],
  winType: "tsumo" | "ron",
  winningTile: string
): boolean {
  if (analysis.kind !== "standard") {
    return false;
  }

  let concealedTriplets = analysis.melds.filter((meld) => meld.type === "triplet").length;
  concealedTriplets += state.melds[seat].filter((meld) => meld.type === "kan" && !meld.open).length;

  if (winType === "ron") {
    const winningTriplet = analysis.melds.find(
      (meld) => meld.type === "triplet" && meld.kinds[0] === winningTile
    );
    if (winningTriplet) {
      concealedTriplets -= 1;
    }
  }

  return concealedTriplets >= 3;
}

function countKans(melds: MahjongMeld[]): number {
  return melds.filter((meld) => meld.type === "kan").length;
}

function countIdenticalSequencePairs(analysis: MahjongAnalysis): number {
  if (analysis.kind !== "standard") {
    return 0;
  }
  const counts = new Map<string, number>();
  for (const entry of analysis.melds.filter((meld) => meld.type === "sequence").map((meld) => meld.kinds.join("|"))) {
    counts.set(entry, (counts.get(entry) ?? 0) + 1);
  }
  return [...counts.values()].reduce((sum, count) => sum + Math.floor(count / 2), 0);
}

function hasPinfu(
  state: MahjongState,
  seat: number,
  analysis: MahjongAnalysis,
  winType: "tsumo" | "ron",
  winningKind: string
): boolean {
  if (analysis.kind !== "standard") {
    return false;
  }
  if (state.melds[seat].some((meld) => meld.open)) {
    return false;
  }
  if (!analysis.melds.every((meld) => meld.type === "sequence")) {
    return false;
  }
  if (isValueKind(state, seat, analysis.pairKind)) {
    return false;
  }
  return calculateWaitFu(analysis, winningKind) === 0 && (winType === "tsumo" || winType === "ron");
}

function isValueKind(state: MahjongState, seat: number, kind: string): boolean {
  return (
    kind === getRoundWindKind(state) ||
    kind === getSeatWindKind(state, seat) ||
    kind === "z5" ||
    kind === "z6" ||
    kind === "z7"
  );
}

function isSeatFuriten(state: MahjongState, seat: number): boolean {
  const permanent = getWinningKindsForSeat(state, seat).some((kind) =>
    (state.discards[seat] ?? []).some((tile) => getMahjongTileKind(tile) === kind)
  );
  return permanent || state.sameTurnFuriten[seat] || state.riichiFuriten[seat];
}

function getWinningKindsForSeat(state: MahjongState, seat: number): string[] {
  const concealed = state.hands[seat] ?? [];
  const openMeldCount = state.melds[seat].length;
  return getWinningKindsForHand(concealed, openMeldCount);
}

function getSeatWindKind(state: MahjongState, seat: number): string {
  const relative = (seat - state.dealerSeat + MAHJONG_SEAT_COUNT) % MAHJONG_SEAT_COUNT;
  return `z${relative + 1}`;
}

function getRoundWindKind(state: MahjongState): string {
  return state.roundWind === "east" ? "z1" : "z2";
}

function buildKindCounts(kinds: string[]): number[] {
  const counts = Array.from({ length: 34 }, () => 0);
  for (const kind of kinds) {
    const index = kindToIndex(kind);
    if (index >= 0) {
      counts[index] += 1;
    }
  }
  return counts;
}

function kindToIndex(kind: string): number {
  const suit = kind.slice(0, 1);
  const rank = Number.parseInt(kind.slice(1), 10);
  if (suit === "m") {
    return rank - 1;
  }
  if (suit === "p") {
    return 9 + rank - 1;
  }
  if (suit === "s") {
    return 18 + rank - 1;
  }
  if (suit === "z") {
    return 27 + rank - 1;
  }
  return -1;
}

function indexToKind(index: number): string {
  if (index < 9) {
    return `m${index + 1}`;
  }
  if (index < 18) {
    return `p${index - 8}`;
  }
  if (index < 27) {
    return `s${index - 17}`;
  }
  return `z${index - 26}`;
}

function resolveDoraKind(kind: string): string {
  const suit = kind.slice(0, 1);
  const rank = Number.parseInt(kind.slice(1), 10);
  if (suit === "z") {
    if (rank >= 1 && rank <= 4) {
      return `z${rank === 4 ? 1 : rank + 1}`;
    }
    if (rank >= 5 && rank <= 7) {
      return `z${rank === 7 ? 5 : rank + 1}`;
    }
  }
  return `${suit}${rank === 9 ? 1 : rank + 1}`;
}

function normalizeCallSelection(tiles: string[]): string[] {
  return sortMahjongTiles(tiles);
}

function sameTileSelection(left: string[], right: string[]): boolean {
  return normalizeCallSelection(left).join("|") === normalizeCallSelection(right).join("|");
}

function countPairsInHand(hand: string[]): number {
  const counts = new Map<string, number>();
  for (const tile of hand) {
    const kind = getMahjongTileKind(tile);
    counts.set(kind, (counts.get(kind) ?? 0) + 1);
  }

  return [...counts.values()].filter((count) => count >= 2).length;
}

function dedupeKinds(kinds: string[]): string[] {
  return [...new Set(kinds)];
}

function isSimpleKind(kind: string): boolean {
  if (kind.startsWith("z")) {
    return false;
  }
  const rank = Number.parseInt(kind.slice(1), 10);
  return rank >= 2 && rank <= 8;
}

function isTerminalOrHonorKind(kind: string): boolean {
  if (kind.startsWith("z")) {
    return true;
  }
  const rank = Number.parseInt(kind.slice(1), 10);
  return rank === 1 || rank === 9;
}

function roundUpToTen(value: number): number {
  return Math.ceil(value / 10) * 10;
}

function roundUpToHundred(value: number): number {
  return Math.ceil(value / 100) * 100;
}

function formatMahjongKind(kind: string): string {
  return formatMahjongTile(`${kind}-0`);
}

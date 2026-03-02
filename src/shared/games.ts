import type { GameCatalogEntry, GameId, RoomSettings } from "./types";

export const GAME_CATALOG: GameCatalogEntry[] = [
  {
    id: "othello",
    title: "オセロ",
    shortDescription: "石を返して盤面を支配する二人用定番ボードゲーム。",
    description: "8x8 盤で石を挟み、置ける手がなくなるまで対戦する。",
    category: "board",
    availability: "active",
    defaultSeats: 2,
    minSeats: 2,
    maxSeats: 2,
    minHumanPlayers: 2,
    supportsBots: false,
    accent: "#1f8f4d"
  },
  {
    id: "gomoku",
    title: "五目並べ",
    shortDescription: "先に 5 つ並べた側が勝つ最短ルールの思考戦。",
    description: "15x15 盤で交互に石を置き、5 連を作ったプレイヤーが勝利する。",
    category: "board",
    availability: "active",
    defaultSeats: 2,
    minSeats: 2,
    maxSeats: 2,
    minHumanPlayers: 2,
    supportsBots: false,
    accent: "#3d2b1f"
  },
  {
    id: "connect4",
    title: "四目並べ",
    shortDescription: "列にディスクを落として 4 連を作るクラシック。",
    description: "7x6 の盤にディスクを落とし、縦横斜めの 4 連を狙う。",
    category: "board",
    availability: "active",
    defaultSeats: 2,
    minSeats: 2,
    maxSeats: 2,
    minHumanPlayers: 2,
    supportsBots: false,
    accent: "#f4b000"
  },
  {
    id: "janken",
    title: "じゃんけん",
    shortDescription: "同時入力で一瞬決着。最初のリアルタイム実装用ゲーム。",
    description: "グー・チョキ・パーを同時に出し合い、勝敗を即座に判定する。",
    category: "party",
    availability: "active",
    defaultSeats: 2,
    minSeats: 2,
    maxSeats: 6,
    minHumanPlayers: 2,
    supportsBots: false,
    accent: "#ff6b35"
  },
  {
    id: "old-maid",
    title: "ババ抜き",
    shortDescription: "ジョーカーを最後まで持っていたら負け。",
    description: "ペアを捨てながらカードを引き合う、古典的なトランプゲーム。",
    category: "card",
    availability: "active",
    defaultSeats: 4,
    minSeats: 2,
    maxSeats: 4,
    minHumanPlayers: 2,
    supportsBots: true,
    accent: "#5e3ab3"
  },
  {
    id: "sevens",
    title: "七並べ",
    shortDescription: "7 を起点にカードを並べていく場づくりゲーム。",
    description: "不足席を bot で補いながら 7 から連結して手札を出し切る。",
    category: "card",
    availability: "planned",
    defaultSeats: 4,
    minSeats: 2,
    maxSeats: 4,
    minHumanPlayers: 2,
    supportsBots: true,
    accent: "#1d6fd6"
  },
  {
    id: "spades",
    title: "スペード",
    shortDescription: "2 対 2 のビッド制トリックテイキング。",
    description: "人間 2 人と bot 2 体で 4 席を揃えて遊ぶペア戦トランプゲーム。",
    category: "card",
    availability: "planned",
    defaultSeats: 4,
    minSeats: 4,
    maxSeats: 4,
    minHumanPlayers: 2,
    supportsBots: true,
    accent: "#101820"
  }
];

export const GAME_MAP = Object.fromEntries(
  GAME_CATALOG.map((game) => [game.id, game])
) as Record<GameId, GameCatalogEntry>;

export function isPlayableGame(gameId: GameId): boolean {
  return GAME_MAP[gameId].availability === "active";
}

export function supportsVariableSeats(gameId: GameId): boolean {
  const game = GAME_MAP[gameId];
  return game.minSeats !== game.maxSeats;
}

export function getDefaultRoomSettings(gameId: GameId): RoomSettings {
  const game = GAME_MAP[gameId] as GameCatalogEntry | undefined;
  if (!game) {
    return {
      fillWithBots: false,
      seatCount: 2
    };
  }
  return {
    fillWithBots: game.supportsBots,
    seatCount: game.defaultSeats
  };
}

export function normalizeRoomSettings(gameId: GameId, settings?: Partial<RoomSettings>): RoomSettings {
  const game = GAME_MAP[gameId];
  const requestedSeatCount = Number.isFinite(settings?.seatCount)
    ? Math.trunc(settings?.seatCount ?? game.defaultSeats)
    : game.defaultSeats;
  const seatCount = Math.min(game.maxSeats, Math.max(game.minSeats, requestedSeatCount));
  const requestedFillWithBots =
    typeof settings?.fillWithBots === "boolean" ? settings.fillWithBots : game.supportsBots;

  return {
    fillWithBots: game.supportsBots ? requestedFillWithBots : false,
    seatCount
  };
}

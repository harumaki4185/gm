import { shuffle } from "./cards";

export const MAHJONG_SUITS = ["m", "p", "s", "z"] as const;
export type MahjongSuit = (typeof MAHJONG_SUITS)[number];

const HONOR_LABELS = ["東", "南", "西", "北", "白", "發", "中"] as const;

export function createMahjongWall(): string[] {
  const wall: string[] = [];

  for (const suit of ["m", "p", "s"] as const) {
    for (let rank = 1; rank <= 9; rank += 1) {
      for (let copy = 0; copy < 4; copy += 1) {
        wall.push(`${suit}${rank}-${copy}`);
      }
    }
  }

  for (let rank = 1; rank <= 7; rank += 1) {
    for (let copy = 0; copy < 4; copy += 1) {
      wall.push(`z${rank}-${copy}`);
    }
  }

  return shuffle(wall);
}

export function getMahjongTileKind(tile: string): string {
  return tile.split("-")[0] ?? tile;
}

export function getMahjongTileSuit(tile: string): MahjongSuit {
  const suit = getMahjongTileKind(tile).slice(0, 1);
  if (suit === "p" || suit === "s" || suit === "z") {
    return suit;
  }
  return "m";
}

export function getMahjongTileRank(tile: string): number {
  const kind = getMahjongTileKind(tile);
  const parsed = Number.parseInt(kind.slice(1), 10);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function compareMahjongTiles(left: string, right: string): number {
  const suitOrder: MahjongSuit[] = ["m", "p", "s", "z"];
  const leftSuitIndex = suitOrder.indexOf(getMahjongTileSuit(left));
  const rightSuitIndex = suitOrder.indexOf(getMahjongTileSuit(right));
  if (leftSuitIndex !== rightSuitIndex) {
    return leftSuitIndex - rightSuitIndex;
  }

  const leftRank = getMahjongTileRank(left);
  const rightRank = getMahjongTileRank(right);
  if (leftRank !== rightRank) {
    return leftRank - rightRank;
  }

  return left.localeCompare(right);
}

export function sortMahjongTiles(tiles: readonly string[]): string[] {
  return [...tiles].sort(compareMahjongTiles);
}

export function formatMahjongTile(tile: string): string {
  const suit = getMahjongTileSuit(tile);
  const rank = getMahjongTileRank(tile);

  if (suit === "z") {
    return HONOR_LABELS[rank - 1] ?? tile;
  }

  return `${rank}${suit}`;
}

export function isMahjongHonor(tile: string): boolean {
  return getMahjongTileSuit(tile) === "z";
}

export function isMahjongTerminalOrHonor(tile: string): boolean {
  const suit = getMahjongTileSuit(tile);
  const rank = getMahjongTileRank(tile);
  return suit === "z" || rank === 1 || rank === 9;
}

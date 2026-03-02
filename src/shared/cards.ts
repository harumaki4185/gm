export const CARD_SUITS = ["S", "H", "D", "C"] as const;
export type CardSuit = (typeof CARD_SUITS)[number];

export const CARD_RANKS = ["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"] as const;

interface CardSortOptions {
  aceHigh?: boolean;
  suitOrder?: readonly CardSuit[];
}

export function createStandardDeck(options?: { includeJoker?: boolean }): string[] {
  const deck: string[] = [];

  for (const suit of CARD_SUITS) {
    for (const rank of CARD_RANKS) {
      deck.push(`${rank}${suit}`);
    }
  }

  if (options?.includeJoker) {
    deck.push("JOKER");
  }

  return deck;
}

export function shuffle<T>(items: readonly T[]): T[] {
  const result = [...items];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    const current = result[index];
    result[index] = result[swapIndex];
    result[swapIndex] = current;
  }
  return result;
}

export function getCardSuit(card: string): CardSuit | null {
  if (card === "JOKER") {
    return null;
  }
  const suit = card.slice(-1);
  return CARD_SUITS.find((entry) => entry === suit) ?? null;
}

export function getCardRank(card: string): string {
  if (card === "JOKER") {
    return "JOKER";
  }
  return card.slice(0, -1);
}

export function getCardRankValue(card: string, aceHigh = false): number {
  const rank = getCardRank(card);
  if (rank === "JOKER") {
    return Number.MAX_SAFE_INTEGER;
  }

  const rankIndex = CARD_RANKS.findIndex((entry) => entry === rank);
  if (rankIndex < 0) {
    return -1;
  }

  if (rank === "A" && aceHigh) {
    return 14;
  }

  return rankIndex + 1;
}

export function compareCards(left: string, right: string, options?: CardSortOptions): number {
  const leftValue = getCardRankValue(left, options?.aceHigh);
  const rightValue = getCardRankValue(right, options?.aceHigh);
  if (leftValue !== rightValue) {
    return leftValue - rightValue;
  }

  const suitOrder = options?.suitOrder ?? CARD_SUITS;
  const leftSuit = getCardSuit(left);
  const rightSuit = getCardSuit(right);
  const leftSuitIndex = leftSuit ? suitOrder.indexOf(leftSuit) : suitOrder.length;
  const rightSuitIndex = rightSuit ? suitOrder.indexOf(rightSuit) : suitOrder.length;
  return leftSuitIndex - rightSuitIndex;
}

export function sortCards(cards: readonly string[], options?: CardSortOptions): string[] {
  return [...cards].sort((left, right) => compareCards(left, right, options));
}

export function isRedCard(card: string): boolean {
  const suit = getCardSuit(card);
  return suit === "H" || suit === "D";
}

export function formatCardLabel(card: string): string {
  if (card === "JOKER") {
    return "JOKER";
  }

  const suitMap: Record<CardSuit, string> = {
    S: "♠",
    H: "♥",
    D: "♦",
    C: "♣"
  };

  const suit = getCardSuit(card);
  return `${getCardRank(card)}${suit ? suitMap[suit] : ""}`;
}

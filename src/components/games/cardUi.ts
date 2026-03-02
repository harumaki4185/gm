import { isRedCard } from "../../shared/cards";

export function getPlayingCardClass(card: string): string {
  return `playing-card ${isRedCard(card) ? "playing-card--red" : "playing-card--black"}`;
}

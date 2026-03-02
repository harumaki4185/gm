import type { RoomRecord } from "../types";

export function formatWinnerMessage(room: RoomRecord, winnerSeats: number[], suffix: string): string {
  if (winnerSeats.length === 0) {
    return "引き分けです";
  }

  const winners = winnerSeats.map((seat) => formatPlayerLabel(room, seat)).join(" / ");
  return `${winners} の${suffix}`;
}

export function formatPlayerLabel(room: RoomRecord, seat: number): string {
  return room.players.find((player) => player.seat === seat)?.name ?? `プレイヤー ${seat + 1}`;
}

export function formatTurnMessage(room: RoomRecord, seat: number, actionLabel: string): string {
  return `${formatPlayerLabel(room, seat)}${actionLabel}`;
}

export function formatPlacementSummary(room: RoomRecord, placements: number[]): string {
  return placements.map((seat, index) => `${index + 1}位 ${formatPlayerLabel(room, seat)}`).join(" / ");
}

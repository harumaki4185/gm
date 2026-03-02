import type { RoomRecord } from "../types";

export function formatWinnerMessage(winnerSeats: number[], suffix: string): string {
  if (winnerSeats.length === 0) {
    return "引き分けです";
  }

  const winners = winnerSeats.map((seat) => `プレイヤー ${seat + 1}`).join(" / ");
  return `${winners} の${suffix}`;
}

export function formatPlayerLabel(room: RoomRecord, seat: number): string {
  return room.players.find((player) => player.seat === seat)?.name ?? `プレイヤー ${seat + 1}`;
}

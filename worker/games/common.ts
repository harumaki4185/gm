export function formatWinnerMessage(winnerSeats: number[], suffix: string): string {
  if (winnerSeats.length === 0) {
    return "引き分けです";
  }

  const winners = winnerSeats.map((seat) => `プレイヤー ${seat + 1}`).join(" / ");
  return `${winners} の${suffix}`;
}

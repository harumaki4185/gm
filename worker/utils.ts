import { GAME_MAP } from "../src/shared/games";
import type { GameId } from "../src/shared/types";
import { AppError } from "./errors";
import type { StoredParticipant } from "./types";

const BLOCKED_NAME_PATTERNS = ["admin", "administrator", "mod", "moderator", "運営", "管理人"];

export function sanitizePlayerName(value: string): string {
  const compact = value
    .trim()
    .replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200d\ufeff]/g, "")
    .replace(/\s+/g, " ");

  if (compact.length < 2) {
    throw new AppError("表示名は 2 文字以上にしてください", 400);
  }

  const lowered = compact.toLocaleLowerCase("ja-JP");
  if (BLOCKED_NAME_PATTERNS.some((token) => lowered.includes(token))) {
    throw new AppError("その表示名は使用できません", 400);
  }

  return compact.slice(0, 20);
}

export function makeRoomId(): string {
  return crypto.randomUUID().replace(/-/g, "");
}

export function getNextHumanSeat(gameId: GameId, players: StoredParticipant[]): number {
  if (gameId === "spades") {
    const preferredSeats = [0, 2];
    for (const seat of preferredSeats) {
      if (!players.some((player) => player.seat === seat && player.playerType === "human")) {
        return seat;
      }
    }
  }

  for (let seat = 0; seat < GAME_MAP[gameId].totalSeats; seat += 1) {
    if (!players.some((player) => player.seat === seat)) {
      return seat;
    }
  }

  throw new AppError("空席がありません", 409);
}

export function nowIso(): string {
  return new Date().toISOString();
}

export function plusMs(isoDate: string, ms: number): string {
  return new Date(new Date(isoDate).getTime() + ms).toISOString();
}

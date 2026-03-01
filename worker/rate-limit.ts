import { AppError } from "./errors";
import type { Env } from "./types";

interface RateLimitBucket {
  count: number;
  resetAt: number;
}

export class RateLimiterDurableObject {
  constructor(private readonly state: DurableObjectState) {}

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname !== "/take" || request.method !== "POST") {
      return new Response("Not found", { status: 404 });
    }

    const { key, limit, windowMs } = (await request.json()) as {
      key: string;
      limit: number;
      windowMs: number;
    };
    const now = Date.now();
    const bucketKey = `bucket:${key}`;
    const current = await this.state.storage.get<RateLimitBucket>(bucketKey);

    let next: RateLimitBucket;
    if (!current || current.resetAt <= now) {
      next = {
        count: 1,
        resetAt: now + windowMs
      };
    } else {
      next = {
        count: current.count + 1,
        resetAt: current.resetAt
      };
    }

    await this.state.storage.put(bucketKey, next);
    await this.state.storage.setAlarm(next.resetAt);

    return Response.json({
      allowed: next.count <= limit,
      remaining: Math.max(0, limit - next.count),
      resetAt: next.resetAt
    });
  }

  async alarm(): Promise<void> {
    await this.state.storage.deleteAll();
  }
}

export async function enforceRoomCreateRateLimit(env: Env, request: Request): Promise<void> {
  const clientKey = request.headers.get("cf-connecting-ip") ?? request.headers.get("x-forwarded-for") ?? "anonymous";
  const stub = env.RATE_LIMITER.get(env.RATE_LIMITER.idFromName(clientKey));
  const response = await stub.fetch("https://limit.internal/take", {
    method: "POST",
    headers: {
      "content-type": "application/json; charset=utf-8"
    },
    body: JSON.stringify({
      key: "create_room",
      limit: 8,
      windowMs: 60 * 1000
    })
  });
  const payload = (await response.json()) as { allowed: boolean };
  if (!payload.allowed) {
    throw new AppError("ルーム作成の回数が多すぎます。しばらく待ってから再試行してください", 429);
  }
}

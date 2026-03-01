import { GAME_CATALOG, GAME_MAP, isPlayableGame } from "../src/shared/games";
import type { CreateRoomRequest } from "../src/shared/types";
import { AppError } from "./errors";
import { apiError, json, serveApp, toErrorResponse } from "./http";
import { enforceRoomCreateRateLimit } from "./rate-limit";
import type { Env } from "./types";
import { makeRoomId } from "./utils";

export async function handleRequest(request: Request, env: Env): Promise<Response> {
  try {
    const url = new URL(request.url);

    if (url.pathname === "/api/games" && request.method === "GET") {
      return json(GAME_CATALOG);
    }

    if (url.pathname === "/api/rooms" && request.method === "POST") {
      await enforceRoomCreateRateLimit(env, request);
      const body = (await request.clone().json()) as CreateRoomRequest;
      if (!GAME_MAP[body.gameId]) {
        return apiError("不明なゲームです", 400);
      }
      if (!isPlayableGame(body.gameId)) {
        return apiError("このゲームはまだ実装中です", 409);
      }

      const roomId = makeRoomId();
      const sessionId = body.sessionId ?? crypto.randomUUID();
      const stub = getRoomStub(env, roomId);
      return stub.fetch("https://room.internal/create", {
        method: "POST",
        headers: {
          "content-type": "application/json; charset=utf-8"
        },
        body: JSON.stringify({
          ...body,
          roomId,
          sessionId
        })
      });
    }

    const roomMatch = url.pathname.match(/^\/api\/rooms\/([^/]+)\/?(?:\/([^/]+))?\/?$/);
    if (!roomMatch) {
      return serveApp(request, env);
    }

    const roomId = roomMatch[1];
    const action = roomMatch[2] ?? "state";
    const stub = getRoomStub(env, roomId);

    if (request.method === "GET" && action === "state") {
      const sessionId = url.searchParams.get("sessionId");
      return stub.fetch(
        `https://room.internal/state${sessionId ? `?sessionId=${encodeURIComponent(sessionId)}` : ""}`
      );
    }

    if (request.method === "GET" && action === "ws") {
      const sessionId = url.searchParams.get("sessionId");
      if (!sessionId) {
        return apiError("sessionId が必要です", 400);
      }
      return stub.fetch(`https://room.internal/ws?sessionId=${encodeURIComponent(sessionId)}`, request);
    }

    if (request.method !== "POST") {
      throw new AppError("未対応のメソッドです", 405);
    }

    const raw = await request.text();
    const forwardBody = raw.length > 0 ? raw : "{}";

    if (action === "join" || action === "reconnect" || action === "actions" || action === "rematch") {
      return stub.fetch(`https://room.internal/${action}`, {
        method: "POST",
        headers: {
          "content-type": "application/json; charset=utf-8"
        },
        body: forwardBody
      });
    }

    throw new AppError("不明な API です", 404);
  } catch (error) {
    return toErrorResponse(error);
  }
}

function getRoomStub(env: Env, roomId: string): DurableObjectStub {
  return env.ROOMS.get(env.ROOMS.idFromName(roomId));
}

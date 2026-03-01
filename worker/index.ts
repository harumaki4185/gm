import { handleRequest } from "./router";
import { RateLimiterDurableObject } from "./rate-limit";
import { RoomDurableObject } from "./room";
import type { Env } from "./types";

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    return handleRequest(request, env);
  }
};

export { RateLimiterDurableObject, RoomDurableObject };

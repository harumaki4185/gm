import { AppError } from "./errors";

const jsonHeaders = {
  "content-type": "application/json; charset=utf-8"
};

export function json<T>(body: T, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: jsonHeaders
  });
}

export function apiError(message: string, status: number): Response {
  return json({ error: message, status }, status);
}

export async function serveApp(request: Request, env: { ASSETS: Fetcher }): Promise<Response> {
  const url = new URL(request.url);
  const isAssetRequest = /\.[a-zA-Z0-9]+$/.test(url.pathname);
  if (isAssetRequest) {
    return env.ASSETS.fetch(request);
  }
  const indexRequest = new Request(new URL("/index.html", request.url).toString(), {
    method: "GET"
  });
  return env.ASSETS.fetch(indexRequest);
}

export function toErrorResponse(error: unknown): Response {
  if (error instanceof AppError) {
    return apiError(error.message, error.status);
  }
  console.error("Unexpected worker error", error);
  if (error instanceof Error) {
    return apiError(error.message, 500);
  }
  return apiError("不明なエラーが発生しました", 500);
}

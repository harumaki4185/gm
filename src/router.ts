import type { GameId } from "./shared/types";

export type Route =
  | { kind: "home" }
  | { kind: "help" }
  | { kind: "game"; gameId: GameId }
  | { kind: "room"; roomId: string };

export function parseRoute(pathname: string): Route {
  const roomMatch = pathname.match(/^\/rooms\/([^/]+)$/);
  if (roomMatch) {
    return { kind: "room", roomId: roomMatch[1] };
  }

  const gameMatch = pathname.match(/^\/games\/([^/]+)$/);
  if (gameMatch) {
    return { kind: "game", gameId: gameMatch[1] as GameId };
  }

  if (pathname === "/help") {
    return { kind: "help" };
  }

  return { kind: "home" };
}

export function toPath(route: Route): string {
  switch (route.kind) {
    case "home":
      return "/";
    case "help":
      return "/help";
    case "game":
      return `/games/${route.gameId}`;
    case "room":
      return `/rooms/${route.roomId}`;
  }
}

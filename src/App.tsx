import { useEffect, useState } from "react";
import { GameCard } from "./components/GameCard";
import { GameSurface } from "./components/GameSurface";
import { GAME_CATALOG } from "./shared/games";
import type {
  ActionRequest,
  ApiErrorBody,
  ClientAction,
  CreateRoomRequest,
  JoinRoomRequest,
  ReconnectRoomRequest,
  RematchRequest,
  RoomMutationResponse,
  RoomSnapshot
} from "./shared/types";

const PLAYER_NAME_KEY = "classic-duels/player-name";
const ROOM_SESSION_KEY = "classic-duels/session/";

export default function App() {
  const [path, setPath] = useState(window.location.pathname);

  useEffect(() => {
    const onPopState = () => setPath(window.location.pathname);
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  const navigate = (nextPath: string) => {
    window.history.pushState({}, "", nextPath);
    setPath(nextPath);
  };

  const roomMatch = path.match(/^\/rooms\/([^/]+)$/);
  if (roomMatch) {
    return <RoomPage navigate={navigate} roomId={roomMatch[1]} />;
  }

  return <LandingPage navigate={navigate} />;
}

function LandingPage({ navigate }: { navigate: (path: string) => void }) {
  const [playerName, setPlayerName] = useState(() => window.localStorage.getItem(PLAYER_NAME_KEY) ?? "");
  const [pendingGameId, setPendingGameId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    window.localStorage.setItem(PLAYER_NAME_KEY, playerName);
  }, [playerName]);

  const createRoom = async (gameId: CreateRoomRequest["gameId"]) => {
    if (playerName.trim().length < 2) {
      setError("表示名は 2 文字以上で入力してください。");
      return;
    }

    setPendingGameId(gameId);
    setError(null);

    try {
      const response = await fetch("/api/rooms", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          gameId,
          playerName
        } satisfies CreateRoomRequest)
      });

      const payload = await parseResponse<RoomMutationResponse>(response);
      window.localStorage.setItem(`${ROOM_SESSION_KEY}${payload.snapshot.roomId}`, payload.sessionId);
      navigate(`/rooms/${payload.snapshot.roomId}`);
    } catch (requestError) {
      setError(getMessage(requestError));
    } finally {
      setPendingGameId(null);
    }
  };

  return (
    <main className="layout">
      <section className="hero">
        <div className="hero__copy">
          <p className="eyebrow">Classic Duels</p>
          <h1>二人で始める古典ゲーム集</h1>
          <p className="hero__lead">
            招待リンクで即開始できるオンライン対戦サイト。最初の実装ではオセロ、五目並べ、四目並べ、じゃんけんをプレイ可能にし、
            トランプゲーム群は同じプロジェクト内で段階追加していきます。
          </p>
        </div>
        <div className="hero__panel">
          <label className="field">
            <span>表示名</span>
            <input
              maxLength={20}
              onChange={(event) => setPlayerName(event.target.value)}
              placeholder="例: Player One"
              value={playerName}
            />
          </label>
          <p className="hero__note">ログインはありません。表示名とローカル保存したセッションで再接続します。</p>
          {error ? <p className="inline-error">{error}</p> : null}
        </div>
      </section>

      <section className="catalog">
        {GAME_CATALOG.map((game) => (
          <GameCard
            busy={pendingGameId === game.id}
            game={game}
            key={game.id}
            onCreate={createRoom}
          />
        ))}
      </section>
    </main>
  );
}

function RoomPage({
  roomId,
  navigate
}: {
  roomId: string;
  navigate: (path: string) => void;
}) {
  const [snapshot, setSnapshot] = useState<RoomSnapshot | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(() => window.localStorage.getItem(`${ROOM_SESSION_KEY}${roomId}`));
  const [joinName, setJoinName] = useState(() => window.localStorage.getItem(PLAYER_NAME_KEY) ?? "");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [socketRevision, setSocketRevision] = useState(0);

  useEffect(() => {
    let cancelled = false;

    const bootstrap = async () => {
      try {
        if (sessionId) {
          const response = await fetch(`/api/rooms/${roomId}/reconnect`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ sessionId } satisfies ReconnectRoomRequest)
          });
          const payload = await parseResponse<RoomMutationResponse>(response);
          if (!cancelled) {
            setSnapshot(payload.snapshot);
            setError(null);
          }
          return;
        }

        const response = await fetch(`/api/rooms/${roomId}`);
        const payload = await parseResponse<RoomSnapshot>(response);
        if (!cancelled) {
          setSnapshot(payload);
        }
      } catch (requestError) {
        if (!cancelled) {
          window.localStorage.removeItem(`${ROOM_SESSION_KEY}${roomId}`);
          setSessionId(null);
          setError(getMessage(requestError));
        }
      }
    };

    void bootstrap();

    return () => {
      cancelled = true;
    };
  }, [roomId, sessionId]);

  useEffect(() => {
    if (!sessionId) {
      return;
    }

    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const socket = new WebSocket(`${protocol}//${window.location.host}/api/rooms/${roomId}/ws?sessionId=${encodeURIComponent(sessionId)}`);
    let intentionalClose = false;

    socket.addEventListener("message", (event) => {
      try {
        const payload = JSON.parse(event.data) as { type: "snapshot"; snapshot: RoomSnapshot };
        if (payload.type === "snapshot") {
          setSnapshot(payload.snapshot);
          setError(null);
        }
      } catch {
        setError("リアルタイム同期メッセージの解析に失敗しました。");
      }
    });

    socket.addEventListener("close", () => {
      if (intentionalClose) {
        return;
      }
      window.setTimeout(() => {
        if (window.localStorage.getItem(`${ROOM_SESSION_KEY}${roomId}`) === sessionId) {
          setSocketRevision((value) => value + 1);
        }
      }, 1200);
    });

    return () => {
      intentionalClose = true;
      socket.close();
    };
  }, [roomId, sessionId, socketRevision]);

  const joinRoom = async () => {
    if (joinName.trim().length < 2) {
      setError("表示名は 2 文字以上で入力してください。");
      return;
    }

    setBusy(true);
    setError(null);

    try {
      const response = await fetch(`/api/rooms/${roomId}/join`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ playerName: joinName } satisfies JoinRoomRequest)
      });
      const payload = await parseResponse<RoomMutationResponse>(response);
      window.localStorage.setItem(PLAYER_NAME_KEY, joinName);
      window.localStorage.setItem(`${ROOM_SESSION_KEY}${roomId}`, payload.sessionId);
      setSessionId(payload.sessionId);
      setSnapshot(payload.snapshot);
    } catch (requestError) {
      setError(getMessage(requestError));
    } finally {
      setBusy(false);
    }
  };

  const sendAction = async (action: ClientAction) => {
    if (!sessionId) {
      return;
    }
    try {
      const response = await fetch(`/api/rooms/${roomId}/actions`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sessionId, action } satisfies ActionRequest)
      });
      const payload = await parseResponse<RoomSnapshot>(response);
      setSnapshot(payload);
    } catch (requestError) {
      setError(getMessage(requestError));
    }
  };

  const requestRematch = async () => {
    if (!sessionId) {
      return;
    }
    try {
      const response = await fetch(`/api/rooms/${roomId}/rematch`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sessionId } satisfies RematchRequest)
      });
      const payload = await parseResponse<RoomSnapshot>(response);
      setSnapshot(payload);
    } catch (requestError) {
      setError(getMessage(requestError));
    }
  };

  const copyInvite = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
    } catch {
      setError("招待リンクのコピーに失敗しました。");
    }
  };

  const clearSession = () => {
    window.localStorage.removeItem(`${ROOM_SESSION_KEY}${roomId}`);
    setSessionId(null);
    setSocketRevision(0);
  };

  return (
    <main className="layout layout--room">
      <header className="room-header">
        <button className="ghost-button" onClick={() => navigate("/")}>
          一覧へ戻る
        </button>
        <div>
          <p className="eyebrow">Room {roomId}</p>
          <h1>{snapshot ? resolveGameTitle(snapshot.gameId) : "ルーム読み込み中"}</h1>
        </div>
        <div className="room-header__actions">
          <button className="ghost-button" onClick={() => void copyInvite()}>
            招待リンクをコピー
          </button>
          <button className="ghost-button" onClick={clearSession}>
            別名で参加
          </button>
        </div>
      </header>

      {error ? <p className="inline-error">{error}</p> : null}

      <div className="room-grid">
        <aside className="sidebar-card">
          <h2>プレイヤー</h2>
          {snapshot ? (
            <ul className="player-list">
              {snapshot.players.map((player) => (
                <li key={player.id}>
                  <span>{player.name}</span>
                  <strong>
                    {player.playerType === "bot" ? "BOT" : "Human"} / {player.connected ? "Online" : "Offline"}
                  </strong>
                </li>
              ))}
            </ul>
          ) : (
            <p>状態を取得しています。</p>
          )}
          {snapshot?.roomStatus === "finished" ? (
            <button className="primary-button" onClick={() => void requestRematch()}>
              再戦をリクエスト
            </button>
          ) : null}
        </aside>

        <section className="room-main">
          {!sessionId ? (
            <div className="join-card">
              <h2>このルームに参加する</h2>
              <label className="field">
                <span>表示名</span>
                <input
                  maxLength={20}
                  onChange={(event) => setJoinName(event.target.value)}
                  placeholder="例: Player Two"
                  value={joinName}
                />
              </label>
              <button className="primary-button" disabled={busy} onClick={() => void joinRoom()}>
                参加する
              </button>
            </div>
          ) : snapshot ? (
            <GameSurface onAction={sendAction} snapshot={snapshot} />
          ) : (
            <div className="join-card">
              <h2>ルームに接続中</h2>
              <p>サーバーから最新状態を取得しています。</p>
            </div>
          )}
        </section>
      </div>
    </main>
  );
}

function resolveGameTitle(gameId: RoomSnapshot["gameId"]): string {
  return GAME_CATALOG.find((game) => game.id === gameId)?.title ?? gameId;
}

async function parseResponse<T>(response: Response): Promise<T> {
  const payload = (await response.json()) as T | ApiErrorBody;
  if (!response.ok) {
    const error = payload as ApiErrorBody;
    throw new Error(error.error || "API request failed");
  }
  return payload as T;
}

function getMessage(error: unknown): string {
  return error instanceof Error ? error.message : "不明なエラーが発生しました。";
}

import { useEffect, useRef, useState } from "react";
import { GameCard } from "./components/GameCard";
import { GameSurface } from "./components/GameSurface";
import { parseRoute, toPath, type Route } from "./router";
import { GAME_CATALOG, GAME_MAP } from "./shared/games";
import type {
  ActionRequest,
  ApiErrorBody,
  ClientAction,
  CreateRoomRequest,
  GameId,
  JoinRoomRequest,
  ReconnectRoomRequest,
  RematchRequest,
  RoomMutationResponse,
  RoomSnapshot
} from "./shared/types";

const PLAYER_NAME_KEY = "classic-duels/player-name";
const ROOM_SESSION_KEY = "classic-duels/session/";
const MAX_SOCKET_RETRIES = 6;

export default function App() {
  const [route, setRoute] = useState<Route>(() => parseRoute(window.location.pathname));

  useEffect(() => {
    const onPopState = () => setRoute(parseRoute(window.location.pathname));
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  const navigate = (nextRoute: Route) => {
    const nextPath = toPath(nextRoute);
    window.history.pushState({}, "", nextPath);
    setRoute(nextRoute);
  };

  if (route.kind === "room") {
    return <RoomPage navigate={navigate} roomId={route.roomId} />;
  }

  if (route.kind === "game") {
    return <GameDetailPage gameId={route.gameId} navigate={navigate} />;
  }

  if (route.kind === "help") {
    return <HelpPage navigate={navigate} />;
  }

  return <LandingPage navigate={navigate} />;
}

function LandingPage({ navigate }: { navigate: (route: Route) => void }) {
  const [playerName, setPlayerName] = useState(() => window.localStorage.getItem(PLAYER_NAME_KEY) ?? "");
  const [pendingGameId, setPendingGameId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    window.localStorage.setItem(PLAYER_NAME_KEY, playerName);
  }, [playerName]);

  const createRoom = async (gameId: CreateRoomRequest["gameId"]) => {
    setPendingGameId(gameId);
    setError(null);

    try {
      const payload = await createRoomOnServer(gameId, playerName);
      navigate({ kind: "room", roomId: payload.snapshot.roomId });
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
          <button className="ghost-button" onClick={() => navigate({ kind: "help" })}>
            ルールとヘルプ
          </button>
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
            onOpenDetails={(gameId) => navigate({ kind: "game", gameId })}
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
  navigate: (route: Route) => void;
}) {
  const [snapshot, setSnapshot] = useState<RoomSnapshot | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(() => window.localStorage.getItem(`${ROOM_SESSION_KEY}${roomId}`));
  const [joinName, setJoinName] = useState(() => window.localStorage.getItem(PLAYER_NAME_KEY) ?? "");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [refreshRevision, setRefreshRevision] = useState(0);
  const [socketRevision, setSocketRevision] = useState(0);
  const skipNextReconnectRef = useRef(false);
  const reconnectBackoffRef = useRef(0);
  const reconnectAttemptsRef = useRef(0);
  const reconnectTimerRef = useRef<number | null>(null);

  useEffect(() => {
    let cancelled = false;

    const bootstrap = async () => {
      try {
        if (sessionId) {
          if (skipNextReconnectRef.current) {
            skipNextReconnectRef.current = false;
            if (!cancelled) {
              setSocketRevision((value) => value + 1);
            }
            return;
          }

          const response = await fetch(`/api/rooms/${roomId}/reconnect`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ sessionId } satisfies ReconnectRoomRequest)
          });
          const payload = await parseResponse<RoomMutationResponse>(response);
          if (!cancelled) {
            setSnapshot(payload.snapshot);
            setError(null);
            reconnectBackoffRef.current = 0;
            reconnectAttemptsRef.current = 0;
            setSocketRevision((value) => value + 1);
          }
          return;
        }

        const response = await fetch(`/api/rooms/${roomId}`);
        const payload = await parseResponse<RoomSnapshot>(response);
        if (!cancelled) {
          setSnapshot(payload);
          setError(null);
        }
      } catch (requestError) {
        if (cancelled) {
          return;
        }
        if (requestError instanceof ApiRequestError && [403, 404, 410].includes(requestError.status)) {
          window.localStorage.removeItem(`${ROOM_SESSION_KEY}${roomId}`);
          setSessionId(null);
          setSnapshot(null);
        }
        setError(getMessage(requestError));
      }
    };

    void bootstrap();

    return () => {
      cancelled = true;
    };
  }, [roomId, sessionId, refreshRevision]);

  useEffect(() => {
    if (!sessionId || !snapshot) {
      return;
    }

    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const socket = new WebSocket(
      `${protocol}//${window.location.host}/api/rooms/${roomId}/ws?sessionId=${encodeURIComponent(sessionId)}`
    );
    let intentionalClose = false;

    socket.addEventListener("message", (event) => {
      try {
        const payload = JSON.parse(event.data) as { type: "snapshot"; snapshot: RoomSnapshot };
        if (payload.type === "snapshot") {
          setSnapshot(payload.snapshot);
          setError(null);
          reconnectBackoffRef.current = 0;
          reconnectAttemptsRef.current = 0;
        }
      } catch {
        setError("リアルタイム同期メッセージの解析に失敗しました。");
      }
    });

    socket.addEventListener("close", () => {
      if (intentionalClose) {
        return;
      }
      if (reconnectAttemptsRef.current >= MAX_SOCKET_RETRIES) {
        setError("リアルタイム接続の再試行上限に達しました。画面を再読み込みしてください。");
        return;
      }
      const delay = Math.min(1000 * 2 ** reconnectBackoffRef.current, 10000);
      reconnectBackoffRef.current += 1;
      reconnectAttemptsRef.current += 1;
      reconnectTimerRef.current = window.setTimeout(() => {
        if (window.localStorage.getItem(`${ROOM_SESSION_KEY}${roomId}`) === sessionId) {
          setRefreshRevision((value) => value + 1);
        }
      }, delay);
    });

    return () => {
      intentionalClose = true;
      if (reconnectTimerRef.current !== null) {
        window.clearTimeout(reconnectTimerRef.current);
      }
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
      skipNextReconnectRef.current = true;
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
    setSnapshot(null);
    setRefreshRevision(0);
    setSocketRevision(0);
  };

  return (
    <main className="layout layout--room">
      <header className="room-header">
        <button className="ghost-button" onClick={() => navigate({ kind: "home" })}>
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
                  <span>
                    {player.name}
                    {snapshot.rematchVotes.includes(player.seat) ? " / 再戦投票済み" : ""}
                  </span>
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

function GameDetailPage({
  gameId,
  navigate
}: {
  gameId: GameId;
  navigate: (route: Route) => void;
}) {
  const game = GAME_MAP[gameId];
  const [playerName, setPlayerName] = useState(() => window.localStorage.getItem(PLAYER_NAME_KEY) ?? "");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!game) {
    return (
      <main className="layout">
        <section className="surface-card detail-card">
          <h1>ゲームが見つかりません</h1>
          <button className="ghost-button" onClick={() => navigate({ kind: "home" })}>
            一覧へ戻る
          </button>
        </section>
      </main>
    );
  }

  const createRoom = async () => {
    setPending(true);
    setError(null);
    try {
      const payload = await createRoomOnServer(gameId, playerName);
      navigate({ kind: "room", roomId: payload.snapshot.roomId });
    } catch (requestError) {
      setError(getMessage(requestError));
    } finally {
      setPending(false);
    }
  };

  return (
    <main className="layout">
      <section className="surface-card detail-card">
        <p className="eyebrow">{game.category}</p>
        <h1>{game.title}</h1>
        <p className="hero__lead">{game.description}</p>
        <dl className="game-card__meta">
          <div>
            <dt>状態</dt>
            <dd>{game.availability === "active" ? "プレイ可能" : "実装予定"}</dd>
          </div>
          <div>
            <dt>総席数</dt>
            <dd>{game.totalSeats}</dd>
          </div>
          <div>
            <dt>bot</dt>
            <dd>{game.supportsBots ? "あり" : "なし"}</dd>
          </div>
        </dl>
        <label className="field">
          <span>表示名</span>
          <input
            maxLength={20}
            onChange={(event) => setPlayerName(event.target.value)}
            placeholder="例: Player One"
            value={playerName}
          />
        </label>
        {error ? <p className="inline-error">{error}</p> : null}
        <div className="detail-card__actions">
          <button className="ghost-button" onClick={() => navigate({ kind: "home" })}>
            一覧へ戻る
          </button>
          <button className="primary-button" disabled={pending || game.availability !== "active"} onClick={() => void createRoom()}>
            ルーム作成へ
          </button>
        </div>
      </section>
    </main>
  );
}

function HelpPage({ navigate }: { navigate: (route: Route) => void }) {
  return (
    <main className="layout">
      <section className="surface-card detail-card">
        <p className="eyebrow">Help</p>
        <h1>ルールと接続ガイド</h1>
        <p className="hero__lead">
          表示名だけで参加し、招待リンクを共有して対戦します。接続が切れても同じブラウザから戻れば再接続できます。
        </p>
        <ul className="help-list">
          <li>オセロ: 挟める場所にだけ置けます。置けない場合は自動でパス判定されます。</li>
          <li>五目並べ: 15x15 盤で先に 5 連を作った側が勝ちです。</li>
          <li>四目並べ: 列を選んでディスクを落とし、縦横斜めに 4 連を作ります。</li>
          <li>じゃんけん: あいこなら自動で次ラウンドへ進みます。</li>
          <li>ババ抜き: 相手の伏せ札から 1 枚引き、同じ数字のペアは自動で捨てられます。最後にジョーカーが残った側が負けです。</li>
        </ul>
        <button className="ghost-button" onClick={() => navigate({ kind: "home" })}>
          一覧へ戻る
        </button>
      </section>
    </main>
  );
}

function resolveGameTitle(gameId: RoomSnapshot["gameId"]): string {
  return GAME_CATALOG.find((game) => game.id === gameId)?.title ?? gameId;
}

async function parseResponse<T>(response: Response): Promise<T> {
  const payload: unknown = await response.json();
  if (!response.ok) {
    if (isApiErrorBody(payload)) {
      throw new ApiRequestError(payload.error || "API request failed", payload.status ?? response.status);
    }
    throw new ApiRequestError("API request failed", response.status);
  }
  return payload as T;
}

function getMessage(error: unknown): string {
  return error instanceof Error ? error.message : "不明なエラーが発生しました。";
}

function isApiErrorBody(payload: unknown): payload is ApiErrorBody {
  return typeof payload === "object" && payload !== null && "error" in payload;
}

class ApiRequestError extends Error {
  constructor(message: string, public readonly status: number) {
    super(message);
  }
}

async function createRoomOnServer(
  gameId: CreateRoomRequest["gameId"],
  playerName: string
): Promise<RoomMutationResponse> {
  if (playerName.trim().length < 2) {
    throw new Error("表示名は 2 文字以上で入力してください。");
  }

  const response = await fetch("/api/rooms", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      gameId,
      playerName
    } satisfies CreateRoomRequest)
  });

  const payload = await parseResponse<RoomMutationResponse>(response);
  window.localStorage.setItem(PLAYER_NAME_KEY, playerName);
  window.localStorage.setItem(`${ROOM_SESSION_KEY}${payload.snapshot.roomId}`, payload.sessionId);
  return payload;
}

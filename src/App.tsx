import { useEffect, useRef, useState } from "react";
import { GameCard } from "./components/GameCard";
import { GameSurface } from "./components/GameSurface";
import { parseRoute, toPath, type Route } from "./router";
import {
  GAME_CATALOG,
  GAME_MAP,
  getDefaultRoomSettings,
  supportsVariableSeats
} from "./shared/games";
import type {
  ActionRequest,
  ApiErrorBody,
  ClientAction,
  CreateRoomRequest,
  GameId,
  JoinRoomRequest,
  ReconnectRoomRequest,
  RematchRequest,
  RoomSettings,
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
  const [playerName, setPlayerName] = useState(() => readStorage(PLAYER_NAME_KEY) ?? "");

  useEffect(() => {
    writeStorage(PLAYER_NAME_KEY, playerName);
  }, [playerName]);

  return (
    <main className="layout">
      <section className="hero">
        <div className="hero__copy">
          <p className="eyebrow">Classic Duels</p>
          <h1>二人で始める古典ゲーム集</h1>
          <p className="hero__lead">
            招待リンクで即開始できるオンライン対戦サイト。オセロ、五目並べ、四目並べ、じゃんけん、ババ抜き、七並べ、スペードを
            ログインなしで遊べます。
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
        </div>
      </section>

      <section className="catalog">
        {GAME_CATALOG.map((game) => (
          <GameCard
            game={game}
            key={game.id}
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
  const [sessionId, setSessionId] = useState<string | null>(() => readStorage(`${ROOM_SESSION_KEY}${roomId}`));
  const [joinName, setJoinName] = useState(() => readStorage(PLAYER_NAME_KEY) ?? "");
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
          if (payload.roomStatus !== "waiting") {
            setSocketRevision((value) => value + 1);
          }
        }
      } catch (requestError) {
        if (cancelled) {
          return;
        }
        if (requestError instanceof ApiRequestError && [403, 404, 410].includes(requestError.status)) {
          removeStorage(`${ROOM_SESSION_KEY}${roomId}`);
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
    if (!snapshot) {
      return;
    }

    if (!sessionId && snapshot.roomStatus === "waiting") {
      return;
    }

    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const sessionQuery = sessionId ? `?sessionId=${encodeURIComponent(sessionId)}` : "";
    const socket = new WebSocket(
      `${protocol}//${window.location.host}/api/rooms/${roomId}/ws${sessionQuery}`
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
        if (!sessionId || readStorage(`${ROOM_SESSION_KEY}${roomId}`) === sessionId) {
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
  }, [roomId, sessionId, socketRevision, Boolean(snapshot) && (sessionId !== null || snapshot?.roomStatus !== "waiting")]);

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
      writeStorage(PLAYER_NAME_KEY, joinName);
      writeStorage(`${ROOM_SESSION_KEY}${roomId}`, payload.sessionId);
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
    removeStorage(`${ROOM_SESSION_KEY}${roomId}`);
    setSessionId(null);
    setSnapshot(null);
    setRefreshRevision(0);
    setSocketRevision(0);
  };

  const currentSeat = snapshot ? resolveCurrentSeat(snapshot.gameView) : null;
  const winnerSeats = snapshot ? resolveWinnerSeats(snapshot.gameView) : [];
  const currentPlayer = currentSeat === null ? null : snapshot?.players.find((player) => player.seat === currentSeat) ?? null;

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
                <li
                  className={`${player.seat === currentSeat ? "player-list__item--current" : ""} ${
                    winnerSeats.includes(player.seat) ? "player-list__item--winner" : ""
                  }`}
                  key={player.id}
                >
                  <span>
                    {player.name}
                    {player.seat === currentSeat ? " / 手番" : ""}
                    {resolveSevensPlacement(snapshot.gameView, player.seat) !== null
                      ? ` / ${resolveSevensPlacement(snapshot.gameView, player.seat)}位`
                      : ""}
                    {snapshot.rematchVotes.includes(player.seat) ? " / 再戦投票済み" : ""}
                  </span>
                  <strong>
                    {player.playerType === "bot" ? "BOT" : "Human"} / {player.connected ? "Online" : "Offline"}
                    {player.team !== null ? ` / Team ${player.team + 1}` : ""}
                  </strong>
                </li>
              ))}
            </ul>
          ) : (
            <p>状態を取得しています。</p>
          )}
          {snapshot?.roomStatus === "finished" && sessionId ? (
            <button className="primary-button" onClick={() => void requestRematch()}>
              再戦をリクエスト
            </button>
          ) : null}
        </aside>

        <section className="room-main">
          {currentPlayer ? <p className="room-turn-banner">現在の手番: {currentPlayer.name}</p> : null}
          {!sessionId ? (
            !snapshot ? (
              <div className="join-card">
                <h2>ルームを確認中</h2>
                <p>参加可能かどうかを確認しています。</p>
              </div>
            ) : snapshot.roomStatus === "waiting" ? (
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
            ) : (
              <>
                <div className="join-card">
                  <h2>観戦モード</h2>
                  <p>このルームの新規参加は締め切られています。現在の対戦状況を閲覧できます。</p>
                </div>
                <GameSurface onAction={sendAction} snapshot={snapshot} />
              </>
            )
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
  const defaultSettings = getDefaultRoomSettings(gameId);
  const [playerName, setPlayerName] = useState(() => readStorage(PLAYER_NAME_KEY) ?? "");
  const [seatCount, setSeatCount] = useState(defaultSettings.seatCount);
  const [fillWithBots, setFillWithBots] = useState(defaultSettings.fillWithBots);
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
    if (playerName.trim().length < 2) {
      setError("表示名は 2 文字以上で入力してください。");
      return;
    }

    setPending(true);
    setError(null);
    try {
      const payload = await createRoomOnServer(gameId, playerName, {
        seatCount,
        fillWithBots
      });
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
            <dt>対応人数</dt>
            <dd>{formatSeatRange(gameId)}</dd>
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
        {supportsVariableSeats(gameId) ? (
          <label className="field">
            <span>ルーム人数</span>
            <select onChange={(event) => setSeatCount(Number(event.target.value))} value={seatCount}>
              {Array.from({ length: game.maxSeats - game.minSeats + 1 }, (_, index) => {
                const value = game.minSeats + index;
                return (
                  <option key={value} value={value}>
                    {value} 人
                  </option>
                );
              })}
            </select>
          </label>
        ) : null}
        {game.supportsBots ? (
          <label className="checkbox-field">
            <input checked={fillWithBots} onChange={(event) => setFillWithBots(event.target.checked)} type="checkbox" />
            <span>不足席を bot で補充して開始する</span>
          </label>
        ) : null}
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
          <li>じゃんけん: 2 人以上で対戦できます。勝ち手が複数人いれば同時勝利、全員ばらけたら次ラウンドです。</li>
          <li>ババ抜き: 2 人から 4 人まで対応し、bot 補充も可能です。手番では前の席の伏せ札から 1 枚引きます。</li>
          <li>七並べ: 2 人から 4 人まで対応し、7 は自動で場に並びます。出せるカードがないときだけパスできます。</li>
          <li>スペード: 4 席固定の 2 対 2 戦です。全員がビッドした後に 13 トリックを行い、1 ハンドの得点で勝敗を決めます。</li>
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

function resolveCurrentSeat(gameView: RoomSnapshot["gameView"]): number | null {
  switch (gameView.kind) {
    case "old-maid":
    case "sevens":
    case "spades":
    case "gomoku":
    case "othello":
    case "connect4":
      return gameView.currentSeat;
    default:
      return null;
  }
}

function resolveWinnerSeats(gameView: RoomSnapshot["gameView"]): number[] {
  switch (gameView.kind) {
    case "janken":
    case "old-maid":
    case "sevens":
    case "spades":
      return gameView.winnerSeats;
    case "gomoku":
    case "othello":
    case "connect4":
      return gameView.winnerSeat === null ? [] : [gameView.winnerSeat];
    default:
      return [];
  }
}

function resolveSevensPlacement(gameView: RoomSnapshot["gameView"], seat: number): number | null {
  if (gameView.kind !== "sevens") {
    return null;
  }
  const player = gameView.players.find((entry) => entry.seat === seat);
  return player?.placement ?? null;
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
  playerName: string,
  settings?: Partial<RoomSettings>
): Promise<RoomMutationResponse> {
  if (playerName.trim().length < 2) {
    throw new Error("表示名は 2 文字以上で入力してください。");
  }

  const response = await fetch("/api/rooms", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      gameId,
      playerName,
      settings
    } satisfies CreateRoomRequest)
  });

  const payload = await parseResponse<RoomMutationResponse>(response);
  writeStorage(PLAYER_NAME_KEY, playerName);
  writeStorage(`${ROOM_SESSION_KEY}${payload.snapshot.roomId}`, payload.sessionId);
  return payload;
}

function formatSeatRange(gameId: GameId): string {
  const game = GAME_MAP[gameId];
  if (game.minSeats === game.maxSeats) {
    return `${game.maxSeats} 人`;
  }
  return `${game.minSeats}-${game.maxSeats} 人`;
}

function readStorage(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeStorage(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // localStorage を使えない環境では永続化を諦める
  }
}

function removeStorage(key: string): void {
  try {
    window.localStorage.removeItem(key);
  } catch {
    // localStorage を使えない環境では削除失敗を握りつぶす
  }
}

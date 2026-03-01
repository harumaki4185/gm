import { DEFAULT_ROOM_SETTINGS, GAME_CATALOG, GAME_MAP, isPlayableGame } from "../src/shared/games";
import type {
  ActionRequest,
  BoardPosition,
  ClientAction,
  CreateRoomRequest,
  GameId,
  JankenChoice,
  JoinRoomRequest,
  ParticipantSummary,
  ReconnectRoomRequest,
  RematchRequest,
  RoomMutationResponse,
  RoomSettings,
  RoomSnapshot,
  RoomStatus
} from "../src/shared/types";

interface Env {
  ASSETS: Fetcher;
  ROOMS: DurableObjectNamespace;
}

interface StoredParticipant extends ParticipantSummary {
  sessionId: string | null;
}

interface RoomRecord {
  roomId: string;
  gameId: GameId;
  roomStatus: RoomStatus;
  createdAt: string;
  updatedAt: string;
  settings: RoomSettings;
  players: StoredParticipant[];
  rematchVotes: string[];
  gameState: InternalGameState;
}

interface JankenState {
  type: "janken";
  phase: "playing" | "finished";
  round: number;
  selections: Array<JankenChoice | null>;
  winnerSeat: number | null;
  resultMessage: string | null;
}

interface PlacementState {
  type: "gomoku" | "othello";
  board: Array<Array<number | null>>;
  currentSeat: number;
  winnerSeat: number | null;
  legalMoves: BoardPosition[];
  winningLine: BoardPosition[];
  statusMessage: string;
}

interface Connect4State {
  type: "connect4";
  board: Array<Array<number | null>>;
  currentSeat: number;
  winnerSeat: number | null;
  winningLine: BoardPosition[];
  statusMessage: string;
}

interface PlannedState {
  type: "planned";
  title: string;
  message: string;
}

type InternalGameState = JankenState | PlacementState | Connect4State | PlannedState;

const jsonHeaders = {
  "content-type": "application/json; charset=utf-8"
};

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/api/games" && request.method === "GET") {
      return json(GAME_CATALOG);
    }

    if (url.pathname === "/api/rooms" && request.method === "POST") {
      const body = (await request.json()) as CreateRoomRequest;
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
        headers: jsonHeaders,
        body: JSON.stringify({
          ...body,
          roomId,
          sessionId
        })
      });
    }

    const roomMatch = url.pathname.match(/^\/api\/rooms\/([^/]+)(?:\/([^/]+))?$/);
    if (!roomMatch) {
      return serveApp(request, env);
    }

    const roomId = roomMatch[1];
    const action = roomMatch[2] ?? "state";
    const stub = getRoomStub(env, roomId);

    if (request.method === "GET" && action === "state") {
      const sessionId = url.searchParams.get("sessionId");
      return stub.fetch(`https://room.internal/state${sessionId ? `?sessionId=${encodeURIComponent(sessionId)}` : ""}`);
    }

    if (request.method === "GET" && action === "ws") {
      const sessionId = url.searchParams.get("sessionId");
      if (!sessionId) {
        return apiError("sessionId が必要です", 400);
      }
      return stub.fetch(`https://room.internal/ws?sessionId=${encodeURIComponent(sessionId)}`, request);
    }

    if (request.method !== "POST") {
      return apiError("未対応のメソッドです", 405);
    }

    const raw = await request.text();
    const forwardBody = raw.length > 0 ? raw : "{}";

    if (action === "join") {
      return stub.fetch("https://room.internal/join", {
        method: "POST",
        headers: jsonHeaders,
        body: forwardBody
      });
    }

    if (action === "reconnect") {
      return stub.fetch("https://room.internal/reconnect", {
        method: "POST",
        headers: jsonHeaders,
        body: forwardBody
      });
    }

    if (action === "actions") {
      return stub.fetch("https://room.internal/actions", {
        method: "POST",
        headers: jsonHeaders,
        body: forwardBody
      });
    }

    if (action === "rematch") {
      return stub.fetch("https://room.internal/rematch", {
        method: "POST",
        headers: jsonHeaders,
        body: forwardBody
      });
    }

    return apiError("不明な API です", 404);
  }
};

export class RoomDurableObject {
  private readonly storage: DurableObjectStorage;
  private readonly connections = new Map<string, Set<WebSocket>>();

  constructor(
    private readonly state: DurableObjectState,
    private readonly env: Env
  ) {
    this.storage = state.storage;
  }

  async fetch(request: Request): Promise<Response> {
    try {
      const url = new URL(request.url);

      if (url.pathname === "/create" && request.method === "POST") {
        const body = (await request.json()) as CreateRoomRequest & { roomId: string; sessionId: string };
        return this.handleCreate(body);
      }

      if (url.pathname === "/join" && request.method === "POST") {
        const body = (await request.json()) as JoinRoomRequest;
        return this.handleJoin(body);
      }

      if (url.pathname === "/reconnect" && request.method === "POST") {
        const body = (await request.json()) as ReconnectRoomRequest;
        return this.handleReconnect(body);
      }

      if (url.pathname === "/actions" && request.method === "POST") {
        const body = (await request.json()) as ActionRequest;
        return this.handleAction(body);
      }

      if (url.pathname === "/rematch" && request.method === "POST") {
        const body = (await request.json()) as RematchRequest;
        return this.handleRematch(body);
      }

      if (url.pathname === "/state" && request.method === "GET") {
        const sessionId = url.searchParams.get("sessionId");
        const room = await this.requireRoom();
        return json(this.makeSnapshot(room, sessionId));
      }

      if (url.pathname === "/ws" && request.method === "GET") {
        const sessionId = url.searchParams.get("sessionId");
        if (!sessionId) {
          return apiError("sessionId が必要です", 400);
        }
        return this.handleWebSocket(sessionId);
      }

      return apiError("不明な room endpoint です", 404);
    } catch (error) {
      return toErrorResponse(error);
    }
  }

  private async handleCreate(
    body: CreateRoomRequest & { roomId: string; sessionId: string }
  ): Promise<Response> {
    const existing = await this.storage.get<RoomRecord>("room");
    if (existing) {
      return apiError("ルームはすでに作成されています", 409);
    }

    const game = GAME_MAP[body.gameId];
    if (!game) {
      return apiError("不明なゲームです", 400);
    }

    const now = new Date().toISOString();
    const room: RoomRecord = {
      roomId: body.roomId,
      gameId: body.gameId,
      roomStatus: "waiting",
      createdAt: now,
      updatedAt: now,
      settings: {
        ...DEFAULT_ROOM_SETTINGS,
        ...body.settings
      },
      players: [
        {
          id: crypto.randomUUID(),
          sessionId: body.sessionId,
          seat: 0,
          name: sanitizePlayerName(body.playerName),
          playerType: "human",
          connected: true,
          isHost: true,
          team: game.totalSeats > 2 ? 0 : null
        }
      ],
      rematchVotes: [],
      gameState: buildWaitingState(body.gameId)
    };

    await this.saveRoom(room);
    return json<RoomMutationResponse>({
      sessionId: body.sessionId,
      snapshot: this.makeSnapshot(room, body.sessionId)
    });
  }

  private async handleJoin(body: JoinRoomRequest): Promise<Response> {
    const room = await this.requireRoom();
    const game = GAME_MAP[room.gameId];
    const sessionId = body.sessionId ?? crypto.randomUUID();
    const existing = room.players.find((player) => player.sessionId === sessionId);

    if (existing) {
      existing.connected = true;
      room.updatedAt = new Date().toISOString();
      await this.saveRoom(room);
      await this.broadcastRoom(room);
      return json<RoomMutationResponse>({
        sessionId,
        snapshot: this.makeSnapshot(room, sessionId)
      });
    }

    const humanPlayers = room.players.filter((player) => player.playerType === "human");
    if (humanPlayers.length >= game.minHumanPlayers) {
      return apiError("このルームは満席です", 409);
    }

    const seat = getNextHumanSeat(game.id, room.players);
    room.players.push({
      id: crypto.randomUUID(),
      sessionId,
      seat,
      name: sanitizePlayerName(body.playerName),
      playerType: "human",
      connected: true,
      isHost: false,
      team: game.totalSeats > 2 ? seat % 2 : null
    });

    maybeStartRoom(room);
    room.updatedAt = new Date().toISOString();
    await this.saveRoom(room);
    await this.broadcastRoom(room);

    return json<RoomMutationResponse>({
      sessionId,
      snapshot: this.makeSnapshot(room, sessionId)
    });
  }

  private async handleReconnect(body: ReconnectRoomRequest): Promise<Response> {
    const room = await this.requireRoom();
    const player = room.players.find((entry) => entry.sessionId === body.sessionId);
    if (!player) {
      return apiError("このセッションはルームに参加していません", 404);
    }

    player.connected = true;
    room.updatedAt = new Date().toISOString();
    await this.saveRoom(room);
    await this.broadcastRoom(room);

    return json<RoomMutationResponse>({
      sessionId: body.sessionId,
      snapshot: this.makeSnapshot(room, body.sessionId)
    });
  }

  private async handleAction(body: ActionRequest): Promise<Response> {
    const room = await this.requireRoom();
    const actor = room.players.find((player) => player.sessionId === body.sessionId);
    if (!actor || actor.playerType !== "human") {
      return apiError("操作権限がありません", 403);
    }
    if (room.roomStatus !== "playing") {
      return apiError("ゲームは開始していません", 409);
    }

    applyGameAction(room, actor.seat, body.action);
    room.updatedAt = new Date().toISOString();
    await this.saveRoom(room);
    await this.broadcastRoom(room);

    return json(this.makeSnapshot(room, body.sessionId));
  }

  private async handleRematch(body: RematchRequest): Promise<Response> {
    const room = await this.requireRoom();
    const actor = room.players.find((player) => player.sessionId === body.sessionId);
    if (!actor || actor.playerType !== "human") {
      return apiError("操作権限がありません", 403);
    }

    if (!room.rematchVotes.includes(body.sessionId)) {
      room.rematchVotes.push(body.sessionId);
    }

    const humanSessionIds = room.players
      .filter((player) => player.playerType === "human" && player.sessionId)
      .map((player) => player.sessionId as string);

    if (humanSessionIds.every((sessionId) => room.rematchVotes.includes(sessionId))) {
      room.roomStatus = "playing";
      room.rematchVotes = [];
      room.gameState = createInitialGameState(room.gameId);
    }

    room.updatedAt = new Date().toISOString();
    await this.saveRoom(room);
    await this.broadcastRoom(room);

    return json(this.makeSnapshot(room, body.sessionId));
  }

  private async handleWebSocket(sessionId: string): Promise<Response> {
    const room = await this.requireRoom();
    const participant = room.players.find((player) => player.sessionId === sessionId);
    if (!participant) {
      return apiError("このセッションはルームに参加していません", 403);
    }

    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];
    server.accept();

    this.trackSocket(sessionId, server);
    participant.connected = true;
    room.updatedAt = new Date().toISOString();
    await this.saveRoom(room);
    this.sendSnapshot(sessionId, room);

    server.addEventListener("message", (event) => {
      if (typeof event.data !== "string") {
        return;
      }
      if (event.data === "ping") {
        server.send("pong");
      }
    });

    server.addEventListener("close", async () => {
      this.untrackSocket(sessionId, server);
      const latest = await this.storage.get<RoomRecord>("room");
      if (!latest) {
        return;
      }
      const sockets = this.connections.get(sessionId);
      if (sockets && sockets.size > 0) {
        return;
      }
      const player = latest.players.find((entry) => entry.sessionId === sessionId);
      if (!player) {
        return;
      }
      player.connected = false;
      latest.updatedAt = new Date().toISOString();
      await this.saveRoom(latest);
      await this.broadcastRoom(latest);
    });

    return new Response(null, {
      status: 101,
      webSocket: client
    });
  }

  private trackSocket(sessionId: string, socket: WebSocket): void {
    const sockets = this.connections.get(sessionId) ?? new Set<WebSocket>();
    sockets.add(socket);
    this.connections.set(sessionId, sockets);
  }

  private untrackSocket(sessionId: string, socket: WebSocket): void {
    const sockets = this.connections.get(sessionId);
    if (!sockets) {
      return;
    }
    sockets.delete(socket);
    if (sockets.size === 0) {
      this.connections.delete(sessionId);
    }
  }

  private async requireRoom(): Promise<RoomRecord> {
    const room = await this.storage.get<RoomRecord>("room");
    if (!room) {
      throw new Error("ROOM_NOT_FOUND");
    }
    return room;
  }

  private async saveRoom(room: RoomRecord): Promise<void> {
    await this.storage.put("room", room);
  }

  private async broadcastRoom(room: RoomRecord): Promise<void> {
    for (const player of room.players) {
      if (!player.sessionId) {
        continue;
      }
      this.sendSnapshot(player.sessionId, room);
    }
  }

  private sendSnapshot(sessionId: string, room: RoomRecord): void {
    const sockets = this.connections.get(sessionId);
    if (!sockets || sockets.size === 0) {
      return;
    }
    const payload = JSON.stringify({
      type: "snapshot",
      snapshot: this.makeSnapshot(room, sessionId)
    });
    for (const socket of sockets) {
      socket.send(payload);
    }
  }

  private makeSnapshot(room: RoomRecord, sessionId: string | null): RoomSnapshot {
    const self = sessionId
      ? room.players.find((player) => player.sessionId === sessionId) ?? null
      : null;

    const gameView = buildView(room, self?.seat ?? null);

    return {
      roomId: room.roomId,
      gameId: room.gameId,
      roomStatus: room.roomStatus,
      createdAt: room.createdAt,
      updatedAt: room.updatedAt,
      players: room.players.map(stripSession),
      selfSeat: self?.seat ?? null,
      selfPlayerId: self?.id ?? null,
      rematchVotes: room.rematchVotes,
      gameView
    };
  }
}

function getRoomStub(env: Env, roomId: string): DurableObjectStub {
  return env.ROOMS.get(env.ROOMS.idFromName(roomId));
}

function buildWaitingState(gameId: GameId): InternalGameState {
  return {
    type: "planned",
    title: GAME_MAP[gameId].title,
    message: "対戦相手の参加を待っています。"
  };
}

function maybeStartRoom(room: RoomRecord): void {
  const game = GAME_MAP[room.gameId];
  const humanPlayers = room.players.filter((player) => player.playerType === "human");
  if (humanPlayers.length < game.minHumanPlayers) {
    return;
  }

  if (game.totalSeats > room.players.length && room.settings.fillWithBots && game.supportsBots) {
    for (let seat = 0; seat < game.totalSeats; seat += 1) {
      const taken = room.players.some((player) => player.seat === seat);
      if (taken) {
        continue;
      }
      room.players.push({
        id: crypto.randomUUID(),
        sessionId: null,
        seat,
        name: `BOT ${seat + 1}`,
        playerType: "bot",
        connected: true,
        isHost: false,
        team: game.totalSeats > 2 ? seat % 2 : null
      });
    }
  }

  room.roomStatus = "playing";
  room.rematchVotes = [];
  room.gameState = createInitialGameState(room.gameId);
}

function createInitialGameState(gameId: GameId): InternalGameState {
  const startingSeat = Math.random() >= 0.5 ? 1 : 0;

  if (gameId === "janken") {
    return {
      type: "janken",
      phase: "playing",
      round: 1,
      selections: [null, null],
      winnerSeat: null,
      resultMessage: null
    };
  }

  if (gameId === "gomoku") {
    const board = createBoard(15, 15);
    return {
      type: "gomoku",
      board,
      currentSeat: startingSeat,
      winnerSeat: null,
      legalMoves: getEmptyCells(board),
      winningLine: [],
      statusMessage: `プレイヤー ${startingSeat + 1} の手番です`
    };
  }

  if (gameId === "connect4") {
    return {
      type: "connect4",
      board: createBoard(6, 7),
      currentSeat: startingSeat,
      winnerSeat: null,
      winningLine: [],
      statusMessage: `プレイヤー ${startingSeat + 1} の手番です`
    };
  }

  if (gameId === "othello") {
    const board = createBoard(8, 8);
    board[3][3] = 1;
    board[3][4] = 0;
    board[4][3] = 0;
    board[4][4] = 1;
    const legalMoves = getOthelloLegalMoves(board, startingSeat);
    return {
      type: "othello",
      board,
      currentSeat: startingSeat,
      winnerSeat: null,
      legalMoves,
      winningLine: [],
      statusMessage: `プレイヤー ${startingSeat + 1} の手番です`
    };
  }

  return {
    type: "planned",
    title: GAME_MAP[gameId].title,
    message: "このゲームロジックは現在実装中です。"
  };
}

function applyGameAction(room: RoomRecord, seat: number, action: ClientAction): void {
  if (room.gameState.type === "planned") {
    throw new Error("このゲームはまだ操作できません");
  }

  if (room.gameState.type === "janken") {
    applyJankenAction(room, seat, action);
    return;
  }

  if (room.gameState.type === "connect4") {
    applyConnect4Action(room, seat, action);
    return;
  }

  applyPlacementAction(room, seat, action);
}

function applyJankenAction(room: RoomRecord, seat: number, action: ClientAction): void {
  const state = room.gameState;
  if (state.type !== "janken") {
    throw new Error("janken state ではありません");
  }
  if (action.type !== "choose_rps") {
    throw new Error("この操作はじゃんけんでは無効です");
  }
  if (seat > 1) {
    throw new Error("人間プレイヤーの席が不正です");
  }
  if (state.phase !== "playing") {
    throw new Error("このラウンドは終了しています");
  }
  if (state.selections[seat] !== null) {
    throw new Error("すでに手を選択済みです");
  }

  state.selections[seat] = action.choice;

  if (state.selections.some((choice) => choice === null)) {
    return;
  }

  const [first, second] = state.selections as [JankenChoice, JankenChoice];
  const result = resolveJanken(first, second);
  state.phase = "finished";
  state.winnerSeat = result;
  state.resultMessage =
    result === null ? "引き分けです" : `プレイヤー ${result + 1} の勝ちです`;
  room.roomStatus = "finished";
}

function applyConnect4Action(room: RoomRecord, seat: number, action: ClientAction): void {
  const state = room.gameState;
  if (state.type !== "connect4") {
    throw new Error("connect4 state ではありません");
  }
  if (action.type !== "drop_disc") {
    throw new Error("列を指定してください");
  }
  if (state.currentSeat !== seat) {
    throw new Error("あなたの手番ではありません");
  }

  const row = findDropRow(state.board, action.col);
  if (row === null) {
    throw new Error("その列には置けません");
  }

  state.board[row][action.col] = seat;
  const winningLine = findWinningLine(state.board, row, action.col, seat, 4);
  if (winningLine.length > 0) {
    state.winnerSeat = seat;
    state.winningLine = winningLine;
    state.statusMessage = `プレイヤー ${seat + 1} の勝ちです`;
    room.roomStatus = "finished";
    return;
  }

  if (isBoardFull(state.board)) {
    state.statusMessage = "引き分けです";
    room.roomStatus = "finished";
    return;
  }

  state.currentSeat = seat === 0 ? 1 : 0;
  state.statusMessage = `プレイヤー ${state.currentSeat + 1} の手番です`;
}

function applyPlacementAction(room: RoomRecord, seat: number, action: ClientAction): void {
  const state = room.gameState;
  if (state.type !== "gomoku" && state.type !== "othello") {
    throw new Error("盤面操作ができるゲームではありません");
  }
  if (action.type !== "place_piece") {
    throw new Error("盤面上の位置を指定してください");
  }
  if (state.currentSeat !== seat) {
    throw new Error("あなたの手番ではありません");
  }
  if (!isLegalMove(state.legalMoves, action.row, action.col)) {
    throw new Error("その位置には置けません");
  }

  if (state.type === "gomoku") {
    state.board[action.row][action.col] = seat;
    const winningLine = findWinningLine(state.board, action.row, action.col, seat, 5);
    if (winningLine.length > 0) {
      state.winnerSeat = seat;
      state.winningLine = winningLine;
      state.statusMessage = `プレイヤー ${seat + 1} の勝ちです`;
      room.roomStatus = "finished";
      return;
    }

    if (isBoardFull(state.board)) {
      state.statusMessage = "引き分けです";
      room.roomStatus = "finished";
      return;
    }

    state.currentSeat = seat === 0 ? 1 : 0;
    state.legalMoves = getEmptyCells(state.board);
    state.statusMessage = `プレイヤー ${state.currentSeat + 1} の手番です`;
    return;
  }

  const flips = getOthelloFlips(state.board, action.row, action.col, seat);
  if (flips.length === 0) {
    throw new Error("その位置には置けません");
  }

  state.board[action.row][action.col] = seat;
  for (const position of flips) {
    state.board[position.row][position.col] = seat;
  }

  const nextSeat = seat === 0 ? 1 : 0;
  const nextMoves = getOthelloLegalMoves(state.board, nextSeat);
  if (nextMoves.length > 0) {
    state.currentSeat = nextSeat;
    state.legalMoves = nextMoves;
    state.statusMessage = `プレイヤー ${nextSeat + 1} の手番です`;
    return;
  }

  const sameSeatMoves = getOthelloLegalMoves(state.board, seat);
  if (sameSeatMoves.length > 0) {
    state.currentSeat = seat;
    state.legalMoves = sameSeatMoves;
    state.statusMessage = `プレイヤー ${nextSeat + 1} はパスです。プレイヤー ${seat + 1} の手番です`;
    return;
  }

  const counts = countBoard(state.board);
  state.winnerSeat = counts[0] === counts[1] ? null : counts[0] > counts[1] ? 0 : 1;
  state.legalMoves = [];
  state.statusMessage =
    state.winnerSeat === null ? "引き分けです" : `プレイヤー ${state.winnerSeat + 1} の勝ちです`;
  room.roomStatus = "finished";
}

function buildView(room: RoomRecord, selfSeat: number | null): GameView {
  const game = GAME_MAP[room.gameId];
  const connectedHumans = room.players.filter(
    (player) => player.playerType === "human" && player.connected
  ).length;

  if (room.roomStatus === "waiting") {
    return {
      kind: "waiting",
      message: "対戦相手の参加を待っています。",
      requiredHumans: game.minHumanPlayers,
      connectedHumans,
      totalSeats: game.totalSeats,
      supportsBots: game.supportsBots
    };
  }

  const state = room.gameState;

  if (state.type === "planned") {
    return {
      kind: "planned",
      title: state.title,
      message: state.message
    };
  }

  if (state.type === "janken") {
    const selections = state.selections.map((choice, index) => {
      if (state.phase === "finished") {
        return choice;
      }
      if (choice === null) {
        return null;
      }
      if (index === selfSeat) {
        return choice;
      }
      return "hidden";
    });

    return {
      kind: "janken",
      phase: state.phase,
      round: state.round,
      canAct:
        room.roomStatus === "playing" &&
        selfSeat !== null &&
        selfSeat <= 1 &&
        state.selections[selfSeat] === null,
      choices: ["rock", "paper", "scissors"],
      selections,
      resultMessage: state.resultMessage,
      currentSeat: null,
      winnerSeat: state.winnerSeat
    };
  }

  if (state.type === "connect4") {
    return {
      kind: "connect4",
      rows: state.board.length,
      cols: state.board[0]?.length ?? 0,
      canAct: room.roomStatus === "playing" && selfSeat === state.currentSeat,
      currentSeat: state.currentSeat,
      winnerSeat: state.winnerSeat,
      board: state.board,
      legalColumns: getLegalColumns(state.board),
      winningLine: state.winningLine,
      statusMessage: state.statusMessage
    };
  }

  return {
    kind: state.type,
    rows: state.board.length,
    cols: state.board[0]?.length ?? 0,
    canAct: room.roomStatus === "playing" && selfSeat === state.currentSeat,
    currentSeat: state.currentSeat,
    winnerSeat: state.winnerSeat,
    board: state.board,
    legalMoves: state.legalMoves,
    winningLine: state.winningLine,
    statusMessage: state.statusMessage
  };
}

function resolveJanken(first: JankenChoice, second: JankenChoice): number | null {
  if (first === second) {
    return null;
  }
  if (
    (first === "rock" && second === "scissors") ||
    (first === "scissors" && second === "paper") ||
    (first === "paper" && second === "rock")
  ) {
    return 0;
  }
  return 1;
}

function createBoard(rows: number, cols: number): Array<Array<number | null>> {
  return Array.from({ length: rows }, () => Array.from({ length: cols }, () => null));
}

function getEmptyCells(board: Array<Array<number | null>>): BoardPosition[] {
  const positions: BoardPosition[] = [];
  for (let row = 0; row < board.length; row += 1) {
    for (let col = 0; col < board[row].length; col += 1) {
      if (board[row][col] === null) {
        positions.push({ row, col });
      }
    }
  }
  return positions;
}

function isBoardFull(board: Array<Array<number | null>>): boolean {
  return board.every((row) => row.every((cell) => cell !== null));
}

function isLegalMove(legalMoves: BoardPosition[], row: number, col: number): boolean {
  return legalMoves.some((move) => move.row === row && move.col === col);
}

function findWinningLine(
  board: Array<Array<number | null>>,
  row: number,
  col: number,
  seat: number,
  lengthToWin: number
): BoardPosition[] {
  const directions: Array<[number, number]> = [
    [1, 0],
    [0, 1],
    [1, 1],
    [1, -1]
  ];

  for (const [deltaRow, deltaCol] of directions) {
    const line: BoardPosition[] = [{ row, col }];
    collectDirection(board, row, col, deltaRow, deltaCol, seat, line);
    collectDirection(board, row, col, -deltaRow, -deltaCol, seat, line);
    if (line.length >= lengthToWin) {
      return line;
    }
  }

  return [];
}

function collectDirection(
  board: Array<Array<number | null>>,
  row: number,
  col: number,
  deltaRow: number,
  deltaCol: number,
  seat: number,
  line: BoardPosition[]
): void {
  let currentRow = row + deltaRow;
  let currentCol = col + deltaCol;

  while (
    currentRow >= 0 &&
    currentRow < board.length &&
    currentCol >= 0 &&
    currentCol < board[0].length &&
    board[currentRow][currentCol] === seat
  ) {
    line.push({ row: currentRow, col: currentCol });
    currentRow += deltaRow;
    currentCol += deltaCol;
  }
}

function findDropRow(board: Array<Array<number | null>>, col: number): number | null {
  if (col < 0 || col >= board[0].length) {
    return null;
  }
  for (let row = board.length - 1; row >= 0; row -= 1) {
    if (board[row][col] === null) {
      return row;
    }
  }
  return null;
}

function getLegalColumns(board: Array<Array<number | null>>): number[] {
  const columns: number[] = [];
  for (let col = 0; col < board[0].length; col += 1) {
    if (board[0][col] === null) {
      columns.push(col);
    }
  }
  return columns;
}

function getOthelloLegalMoves(board: Array<Array<number | null>>, seat: number): BoardPosition[] {
  const moves: BoardPosition[] = [];
  for (let row = 0; row < board.length; row += 1) {
    for (let col = 0; col < board[row].length; col += 1) {
      if (board[row][col] !== null) {
        continue;
      }
      if (getOthelloFlips(board, row, col, seat).length > 0) {
        moves.push({ row, col });
      }
    }
  }
  return moves;
}

function getOthelloFlips(
  board: Array<Array<number | null>>,
  row: number,
  col: number,
  seat: number
): BoardPosition[] {
  const opponent = seat === 0 ? 1 : 0;
  const directions: Array<[number, number]> = [
    [-1, -1],
    [-1, 0],
    [-1, 1],
    [0, -1],
    [0, 1],
    [1, -1],
    [1, 0],
    [1, 1]
  ];
  const flips: BoardPosition[] = [];

  for (const [deltaRow, deltaCol] of directions) {
    const line: BoardPosition[] = [];
    let currentRow = row + deltaRow;
    let currentCol = col + deltaCol;

    while (
      currentRow >= 0 &&
      currentRow < board.length &&
      currentCol >= 0 &&
      currentCol < board[0].length &&
      board[currentRow][currentCol] === opponent
    ) {
      line.push({ row: currentRow, col: currentCol });
      currentRow += deltaRow;
      currentCol += deltaCol;
    }

    if (
      line.length > 0 &&
      currentRow >= 0 &&
      currentRow < board.length &&
      currentCol >= 0 &&
      currentCol < board[0].length &&
      board[currentRow][currentCol] === seat
    ) {
      flips.push(...line);
    }
  }

  return flips;
}

function countBoard(board: Array<Array<number | null>>): [number, number] {
  let first = 0;
  let second = 0;

  for (const row of board) {
    for (const cell of row) {
      if (cell === 0) {
        first += 1;
      } else if (cell === 1) {
        second += 1;
      }
    }
  }

  return [first, second];
}

function stripSession(player: StoredParticipant): ParticipantSummary {
  return {
    id: player.id,
    seat: player.seat,
    name: player.name,
    playerType: player.playerType,
    connected: player.connected,
    isHost: player.isHost,
    team: player.team
  };
}

function sanitizePlayerName(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length < 2) {
    throw new Error("表示名は 2 文字以上にしてください");
  }
  return trimmed.slice(0, 20);
}

function getNextHumanSeat(gameId: GameId, players: StoredParticipant[]): number {
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
  return players.length;
}

function makeRoomId(): string {
  return crypto.randomUUID().split("-")[0];
}

function json<T>(body: T, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: jsonHeaders
  });
}

function apiError(message: string, status: number): Response {
  return json({ error: message }, status);
}

async function serveApp(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const isAssetRequest = /\.[a-zA-Z0-9]+$/.test(url.pathname);
  if (isAssetRequest) {
    return env.ASSETS.fetch(request);
  }
  const indexRequest = new Request(new URL("/index.html", request.url).toString(), request);
  return env.ASSETS.fetch(indexRequest);
}

function toErrorResponse(error: unknown): Response {
  if (error instanceof Error) {
    if (error.message === "ROOM_NOT_FOUND") {
      return apiError("ルームが見つかりません", 404);
    }
    return apiError(error.message, 400);
  }
  return apiError("不明なエラーが発生しました", 500);
}

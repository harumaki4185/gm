import { GAME_MAP, normalizeRoomSettings } from "../src/shared/games";
import type {
  ActionRequest,
  CreateRoomRequest,
  JoinRoomRequest,
  ParticipantSummary,
  ReconnectRoomRequest,
  RematchRequest,
  RoomMutationResponse,
  RoomSnapshot,
  StartRoomRequest,
  UpdateRoomSettingsRequest
} from "../src/shared/types";
import { AppError, assert } from "./errors";
import {
  advanceAutomatedTurns,
  applyGameAction,
  buildView,
  buildWaitingState,
  createInitialGameState,
  finalizeByDisconnect,
  markDisconnectPending,
  resumeGameAfterReconnect
} from "./games/index";
import { json, toErrorResponse } from "./http";
import type { Env, LifecycleAlarm, RoomRecord, StoredParticipant } from "./types";
import {
  DISCONNECT_FORFEIT_MS,
  FINISHED_ROOM_TTL_MS,
  WAITING_ROOM_TTL_MS
} from "./types";
import { getNextHumanSeat, nowIso, plusMs, resolveTeam, sanitizePlayerName } from "./utils";

export class RoomDurableObject {
  private readonly storage: DurableObjectStorage;
  private readonly connections = new Map<string, Set<WebSocket>>();
  private readonly spectatorConnections = new Set<WebSocket>();

  constructor(private readonly state: DurableObjectState, _env: Env) {
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
        return this.handleJoin((await request.json()) as JoinRoomRequest);
      }

      if (url.pathname === "/reconnect" && request.method === "POST") {
        return this.handleReconnect((await request.json()) as ReconnectRoomRequest);
      }

      if (url.pathname === "/actions" && request.method === "POST") {
        return this.handleAction((await request.json()) as ActionRequest);
      }

      if (url.pathname === "/rematch" && request.method === "POST") {
        return this.handleRematch((await request.json()) as RematchRequest);
      }

      if (url.pathname === "/settings" && request.method === "POST") {
        return this.handleUpdateSettings((await request.json()) as UpdateRoomSettingsRequest);
      }

      if (url.pathname === "/start" && request.method === "POST") {
        return this.handleStart((await request.json()) as StartRoomRequest);
      }

      if (url.pathname === "/state" && request.method === "GET") {
        const room = await this.requireRoom();
        return json(this.makeSnapshot(room, url.searchParams.get("sessionId")));
      }

      if (url.pathname === "/ws" && request.method === "GET") {
        const sessionId = url.searchParams.get("sessionId");
        return this.handleWebSocket(sessionId);
      }

      throw new AppError("不明な room endpoint です", 404);
    } catch (error) {
      return toErrorResponse(error);
    }
  }

  async alarm(): Promise<void> {
    const room = await this.storage.get<RoomRecord>("room");
    if (!room || !room.lifecycleAlarm) {
      return;
    }

    const now = Date.now();
    const alarmAt = new Date(room.lifecycleAlarm.at).getTime();
    if (alarmAt > now) {
      await this.storage.setAlarm(alarmAt);
      return;
    }

    if (room.lifecycleAlarm.kind === "waiting_expire") {
      await this.closeRoom(room);
      return;
    }

    if (room.lifecycleAlarm.kind === "cleanup") {
      await this.closeRoom(room);
      return;
    }

    if (room.lifecycleAlarm.kind === "disconnect_forfeit") {
      const disconnected = room.players.find((player) => player.id === room.lifecycleAlarm?.playerId);
      if (!disconnected || disconnected.connected) {
        room.lifecycleAlarm = null;
        await this.saveRoom(room);
        await this.syncAlarm(room.lifecycleAlarm);
        return;
      }
      finalizeByDisconnect(room, disconnected.seat);
      room.lifecycleAlarm = {
        kind: "cleanup",
        at: plusMs(nowIso(), FINISHED_ROOM_TTL_MS)
      };
      room.updatedAt = nowIso();
      await this.saveRoom(room);
      await this.syncAlarm(room.lifecycleAlarm);
      await this.broadcastRoom(room);
    }
  }

  private async handleCreate(
    body: CreateRoomRequest & { roomId: string; sessionId: string }
  ): Promise<Response> {
    const existing = await this.storage.get<RoomRecord>("room");
    assert(!existing, "ルームはすでに作成されています", 409);

    const game = GAME_MAP[body.gameId];
    assert(game, "不明なゲームです", 400);
    const settings = normalizeRoomSettings(body.gameId, body.settings);

    const now = nowIso();
    const room: RoomRecord = {
      roomId: body.roomId,
      gameId: body.gameId,
      roomStatus: "waiting",
      createdAt: now,
      updatedAt: now,
      settings,
      players: [
        {
          id: crypto.randomUUID(),
          sessionId: body.sessionId,
          seat: 0,
          name: sanitizePlayerName(body.playerName),
          playerType: "human",
          connected: true,
          isHost: true,
          team: resolveTeam(body.gameId, 0)
        }
      ],
      rematchVotes: [],
      gameState: buildWaitingState(body.gameId),
      lifecycleAlarm: {
        kind: "waiting_expire",
        at: plusMs(now, WAITING_ROOM_TTL_MS)
      }
    };

    room.settings = clampWaitingSettings(room, room.settings);
    await this.saveRoom(room);
    await this.syncAlarm(room.lifecycleAlarm);
    return json<RoomMutationResponse>({
      sessionId: body.sessionId,
      snapshot: this.makeSnapshot(room, body.sessionId)
    });
  }

  private async handleJoin(body: JoinRoomRequest): Promise<Response> {
    const room = await this.requireRoom();
    const sessionId = body.sessionId ?? crypto.randomUUID();
    const existing = room.players.find((player) => player.sessionId === sessionId);

    if (existing) {
      existing.connected = true;
      room.updatedAt = nowIso();
      if (room.lifecycleAlarm?.kind === "disconnect_forfeit" && room.lifecycleAlarm.playerId === existing.id) {
        room.lifecycleAlarm = null;
        resumeGameAfterReconnect(room);
      }
      await this.saveRoom(room);
      await this.syncAlarm(room.lifecycleAlarm);
      await this.broadcastRoom(room);
      return json<RoomMutationResponse>({
        sessionId,
        snapshot: this.makeSnapshot(room, sessionId)
      });
    }

    assert(room.roomStatus === "waiting", "このルームへの新規参加は締め切られました", 409);

    const humanPlayers = room.players.filter((player) => player.playerType === "human");
    assert(humanPlayers.length < room.settings.seatCount, "このルームは満席です", 409);

    const seat = getNextHumanSeat(room.gameId, room.players, room.settings.seatCount);
    room.players.push({
      id: crypto.randomUUID(),
      sessionId,
      seat,
      name: sanitizePlayerName(body.playerName),
      playerType: "human",
      connected: true,
      isHost: false,
      team: resolveTeam(room.gameId, seat)
    });

    room.settings = clampWaitingSettings(room, room.settings);
    room.updatedAt = nowIso();
    await this.saveRoom(room);
    await this.syncAlarm(room.lifecycleAlarm);
    await this.broadcastRoom(room);

    return json<RoomMutationResponse>({
      sessionId,
      snapshot: this.makeSnapshot(room, sessionId)
    });
  }

  private async handleReconnect(body: ReconnectRoomRequest): Promise<Response> {
    const room = await this.requireRoom();
    const player = room.players.find((entry) => entry.sessionId === body.sessionId);
    assert(player, "このセッションはルームに参加していません", 404);

    player.connected = true;
    if (room.lifecycleAlarm?.kind === "disconnect_forfeit" && room.lifecycleAlarm.playerId === player.id) {
      room.lifecycleAlarm = null;
      resumeGameAfterReconnect(room);
    }

    room.updatedAt = nowIso();
    await this.saveRoom(room);
    await this.syncAlarm(room.lifecycleAlarm);
    await this.broadcastRoom(room);

    return json<RoomMutationResponse>({
      sessionId: body.sessionId,
      snapshot: this.makeSnapshot(room, body.sessionId)
    });
  }

  private async handleAction(body: ActionRequest): Promise<Response> {
    const room = await this.requireRoom();
    const actor = room.players.find((player) => player.sessionId === body.sessionId);
    assert(actor && actor.playerType === "human", "操作権限がありません", 403);
    assert(room.roomStatus === "playing", "ゲームは開始していません", 409);

    applyGameAction(room, actor.seat, body.action);
    advanceAutomatedTurns(room);
    if (room.roomStatus === "finished") {
      room.lifecycleAlarm = {
        kind: "cleanup",
        at: plusMs(nowIso(), FINISHED_ROOM_TTL_MS)
      };
    }
    room.updatedAt = nowIso();
    await this.saveRoom(room);
    await this.syncAlarm(room.lifecycleAlarm);
    await this.broadcastRoom(room);

    return json(this.makeSnapshot(room, body.sessionId));
  }

  private async handleRematch(body: RematchRequest): Promise<Response> {
    const room = await this.requireRoom();
    const actor = room.players.find((player) => player.sessionId === body.sessionId);
    assert(actor && actor.playerType === "human", "操作権限がありません", 403);
    assert(room.roomStatus === "finished", "再戦は対戦終了後のみ可能です", 409);

    if (!room.rematchVotes.includes(actor.id)) {
      room.rematchVotes.push(actor.id);
    }

    const humanPlayerIds = room.players
      .filter((player) => player.playerType === "human")
      .map((player) => player.id);

    if (humanPlayerIds.every((playerId) => room.rematchVotes.includes(playerId))) {
      room.rematchVotes = [];
      room.gameState = createInitialGameState(room.gameId, room.settings.seatCount);
      room.roomStatus = getRoomStatusFromState(room.gameState);
      if (room.roomStatus === "playing") {
        resumeGameAfterReconnect(room);
      }
      advanceAutomatedTurns(room);
      room.lifecycleAlarm = null;
      if (room.roomStatus === "finished") {
        room.lifecycleAlarm = {
          kind: "cleanup",
          at: plusMs(nowIso(), FINISHED_ROOM_TTL_MS)
        };
      }
    }

    room.updatedAt = nowIso();
    await this.saveRoom(room);
    await this.syncAlarm(room.lifecycleAlarm);
    await this.broadcastRoom(room);

    return json(this.makeSnapshot(room, body.sessionId));
  }

  private async handleUpdateSettings(body: UpdateRoomSettingsRequest): Promise<Response> {
    const room = await this.requireRoom();
    const actor = room.players.find((player) => player.sessionId === body.sessionId);
    assert(actor && actor.playerType === "human", "操作権限がありません", 403);
    assert(actor.isHost, "ルーム設定を変更できるのはホストだけです", 403);
    assert(room.roomStatus === "waiting", "ルーム設定は開始前のみ変更できます", 409);

    room.settings = clampWaitingSettings(room, {
      ...room.settings,
      ...body.settings
    });
    room.updatedAt = nowIso();
    await this.saveRoom(room);
    await this.syncAlarm(room.lifecycleAlarm);
    await this.broadcastRoom(room);

    return json(this.makeSnapshot(room, body.sessionId));
  }

  private async handleStart(body: StartRoomRequest): Promise<Response> {
    const room = await this.requireRoom();
    const actor = room.players.find((player) => player.sessionId === body.sessionId);
    assert(actor && actor.playerType === "human", "操作権限がありません", 403);
    assert(actor.isHost, "試合を開始できるのはホストだけです", 403);
    assert(room.roomStatus === "waiting", "試合開始は待機中のみ可能です", 409);

    startRoom(room);
    room.updatedAt = nowIso();
    await this.saveRoom(room);
    await this.syncAlarm(room.lifecycleAlarm);
    await this.broadcastRoom(room);

    return json(this.makeSnapshot(room, body.sessionId));
  }

  private async handleWebSocket(sessionId: string | null): Promise<Response> {
    const room = await this.requireRoom();
    assert(room.lifecycleAlarm?.kind !== "cleanup", "このルームは終了処理中です", 410);

    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];
    server.accept();

    if (sessionId) {
      const participant = room.players.find((player) => player.sessionId === sessionId);
      assert(participant, "このセッションはルームに参加していません", 403);
      assert(participant.connected, "先に再接続処理を完了してください", 409);
      this.trackSocket(sessionId, server);
      this.sendSnapshot(sessionId, room);
    } else {
      assert(room.roomStatus !== "waiting", "観戦はゲーム開始後に可能です", 409);
      this.trackSpectatorSocket(server);
      this.sendSpectatorSnapshot(room);
    }

    server.addEventListener("message", (event) => {
      if (typeof event.data !== "string" || event.data !== "ping") {
        try {
          server.close(1008, "invalid_message");
        } catch {
          if (sessionId) {
            this.untrackSocket(sessionId, server);
          } else {
            this.untrackSpectatorSocket(server);
          }
        }
        return;
      }
      try {
        server.send("pong");
      } catch {
        if (sessionId) {
          this.untrackSocket(sessionId, server);
        } else {
          this.untrackSpectatorSocket(server);
        }
      }
    });

    server.addEventListener("close", () => {
      if (sessionId) {
        this.handleSocketClose(sessionId, server).catch(() => {});
        return;
      }
      this.untrackSpectatorSocket(server);
    });

    return new Response(null, {
      status: 101,
      webSocket: client
    });
  }

  private async handleSocketClose(sessionId: string, socket: WebSocket): Promise<void> {
    this.untrackSocket(sessionId, socket);
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
    latest.updatedAt = nowIso();

    if (latest.roomStatus === "playing" && player.playerType === "human") {
      latest.lifecycleAlarm = {
        kind: "disconnect_forfeit",
        at: plusMs(latest.updatedAt, DISCONNECT_FORFEIT_MS),
        playerId: player.id
      };
      markDisconnectPending(latest, player.seat, player.name);
    }

    if (latest.roomStatus === "finished") {
      latest.lifecycleAlarm = {
        kind: "cleanup",
        at: plusMs(latest.updatedAt, FINISHED_ROOM_TTL_MS)
      };
    }

    await this.saveRoom(latest);
    await this.syncAlarm(latest.lifecycleAlarm);
    await this.broadcastRoom(latest);
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

  private trackSpectatorSocket(socket: WebSocket): void {
    this.spectatorConnections.add(socket);
  }

  private untrackSpectatorSocket(socket: WebSocket): void {
    this.spectatorConnections.delete(socket);
  }

  private async requireRoom(): Promise<RoomRecord> {
    const room = await this.storage.get<RoomRecord>("room");
    if (!room) {
      throw new AppError("ルームが見つかりません", 404);
    }
    return room;
  }

  private async saveRoom(room: RoomRecord): Promise<void> {
    await this.storage.put("room", room);
  }

  private async syncAlarm(alarm: LifecycleAlarm | null): Promise<void> {
    if (!alarm) {
      await this.storage.deleteAlarm();
      return;
    }
    await this.storage.setAlarm(new Date(alarm.at).getTime());
  }

  private async closeRoom(room: RoomRecord): Promise<void> {
    for (const player of room.players) {
      if (!player.sessionId) {
        continue;
      }
      const sockets = this.connections.get(player.sessionId);
      if (!sockets) {
        continue;
      }
      for (const socket of sockets) {
        try {
          socket.close(1000, "room_closed");
        } catch {
          this.untrackSocket(player.sessionId, socket);
        }
      }
    }
    for (const socket of this.spectatorConnections) {
      try {
        socket.close(1000, "room_closed");
      } catch {
        this.untrackSpectatorSocket(socket);
      }
    }
    this.connections.clear();
    this.spectatorConnections.clear();
    await this.storage.deleteAll();
  }

  private async broadcastRoom(room: RoomRecord): Promise<void> {
    for (const player of room.players) {
      if (!player.sessionId) {
        continue;
      }
      this.sendSnapshot(player.sessionId, room);
    }
    this.sendSpectatorSnapshot(room);
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
      try {
        socket.send(payload);
      } catch {
        this.untrackSocket(sessionId, socket);
      }
    }
  }

  private sendSpectatorSnapshot(room: RoomRecord): void {
    if (this.spectatorConnections.size === 0) {
      return;
    }

    const payload = JSON.stringify({
      type: "snapshot",
      snapshot: this.makeSnapshot(room, null)
    });

    for (const socket of this.spectatorConnections) {
      try {
        socket.send(payload);
      } catch {
        this.untrackSpectatorSocket(socket);
      }
    }
  }

  private makeSnapshot(room: RoomRecord, sessionId: string | null): RoomSnapshot {
    const self = sessionId
      ? room.players.find((player) => player.sessionId === sessionId) ?? null
      : null;
    const players = [...room.players].sort((left, right) => left.seat - right.seat).map(stripSession);

    return {
      roomId: room.roomId,
      gameId: room.gameId,
      roomStatus: room.roomStatus,
      createdAt: room.createdAt,
      updatedAt: room.updatedAt,
      players,
      selfSeat: self?.seat ?? null,
      selfPlayerId: self?.id ?? null,
      rematchVotes: room.rematchVotes
        .map((playerId) => room.players.find((player) => player.id === playerId)?.seat)
        .filter((seat): seat is number => typeof seat === "number"),
      gameView: buildView(room, self?.seat ?? null)
    };
  }
}

function getHumanPlayers(room: RoomRecord): StoredParticipant[] {
  return room.players.filter((player) => player.playerType === "human");
}

function clampWaitingSettings(
  room: RoomRecord,
  settings: RoomRecord["settings"]
): RoomRecord["settings"] {
  const game = GAME_MAP[room.gameId];
  const normalized = normalizeRoomSettings(room.gameId, settings);
  const humanPlayerCount = getHumanPlayers(room).length;
  const seatCount = Math.max(humanPlayerCount, normalized.seatCount);
  const maxBotCount = game.supportsBots ? Math.max(0, seatCount - humanPlayerCount) : 0;

  return {
    seatCount,
    botCount: Math.min(normalized.botCount, maxBotCount)
  };
}

function getStartBotCount(room: RoomRecord): number {
  const game = GAME_MAP[room.gameId];
  if (!game.supportsBots) {
    return 0;
  }

  return Math.min(room.settings.botCount, Math.max(0, room.settings.seatCount - getHumanPlayers(room).length));
}

function canStartRoom(room: RoomRecord): boolean {
  const game = GAME_MAP[room.gameId];
  const humanPlayers = getHumanPlayers(room);
  const connectedHumans = humanPlayers.filter((player) => player.connected).length;
  const startSeatCount = humanPlayers.length + getStartBotCount(room);

  if (humanPlayers.length < game.minHumanPlayers) {
    return false;
  }

  if (connectedHumans !== humanPlayers.length) {
    return false;
  }

  if (startSeatCount < game.minSeats || startSeatCount > game.maxSeats) {
    return false;
  }

  if (game.minSeats === game.maxSeats && startSeatCount !== game.maxSeats) {
    return false;
  }

  return true;
}

function startRoom(room: RoomRecord): void {
  assert(canStartRoom(room), "現在の人数と bot 設定では開始できません", 409);

  const humanPlayers = getHumanPlayers(room);
  const botCount = getStartBotCount(room);
  const startSeatCount = humanPlayers.length + botCount;
  room.players = [...humanPlayers];

  if (botCount > 0) {
    let added = 0;
    for (let seat = 0; seat < room.settings.seatCount; seat += 1) {
      if (added >= botCount) {
        break;
      }
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
        team: resolveTeam(room.gameId, seat)
      });
      added += 1;
    }
  }

  room.settings = {
    seatCount: startSeatCount,
    botCount
  };
  room.roomStatus = "playing";
  room.rematchVotes = [];
  room.gameState = createInitialGameState(room.gameId, startSeatCount);
  room.roomStatus = getRoomStatusFromState(room.gameState);
  if (room.roomStatus === "playing") {
    resumeGameAfterReconnect(room);
  }
  advanceAutomatedTurns(room);
  room.lifecycleAlarm = null;
  if (room.roomStatus === "finished") {
    room.lifecycleAlarm = {
      kind: "cleanup",
      at: plusMs(nowIso(), FINISHED_ROOM_TTL_MS)
    };
  }
}

function getRoomStatusFromState(roomState: RoomRecord["gameState"]): RoomRecord["roomStatus"] {
  if (roomState.type === "old-maid" && (roomState.winnerSeats.length > 0 || roomState.hands.every((hand) => hand.length === 0))) {
    return "finished";
  }
  if (roomState.type === "sevens" && roomState.winnerSeats.length > 0) {
    return "finished";
  }
  if (roomState.type === "sevens" && roomState.currentSeat === null && roomState.placements.length > 0) {
    return "finished";
  }
  if (roomState.type === "spades" && roomState.stage === "finished") {
    return "finished";
  }
  return "playing";
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

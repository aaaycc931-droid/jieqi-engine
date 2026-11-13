import { HostResultLedger, hostResultScope, trackedActionResult, trackedRuleFailure, type HostResultOptions, type HostResultScope, type HostResultAnswer, type TrackedHostAction } from "./host-result-ledger.ts";
import { submitRemoteHeroPreparationChoice } from "./remote-room.ts";
import { RuleError } from "./errors.ts";
import {
  advanceRemoteRoomTime,
  completeRemoteHeroIntro,
  completeRemoteHeroPreparation,
  createRemoteRoom,
  disconnectRemotePlayer,
  joinRemoteRoom,
  forfeitRemoteRoom,
  reconnectRemotePlayer,
  requestRemoteRematch,
  respondRemoteRematch,
  playerRoomView,
  publicRemoteRoom,
  submitRemoteAssassination,
  submitRemoteHeroAbility,
  submitRemoteHeroSelection,
  submitRemoteChat,
  submitRemoteMove,
  submitRemoteRps,
  submitRemoteTrapSetup,
  updateRemoteTrapDraft,
  surrenderRemoteRoom,
  type PlayerRemoteRoomView,
  type PublicRemoteRoom,
  type RemoteRoom,
} from "./remote-room.ts";
import type { AssassinationCommand, HeroAbilityCommand, HeroId, MoveCommand, OptionalModeConfig, Position, RandomInt } from "./types.ts";
import { normalizeGameMode } from "./modes.ts";
import type { RpsChoice } from "./rps.ts";

export const BLUETOOTH_HOST_PLAYER = "bluetooth:host";
export const BLUETOOTH_GUEST_PLAYER = "bluetooth:guest";

export type BluetoothRoomAction =
  | { kind: "hero"; hero: HeroId; form?: import("./types.ts").HeroForm; variant?: import("./types.ts").GalakrondForm }
  | { kind: "hero_preparation_choice"; blade?: "left" | "right"; trainingType?: import("./types.ts").PieceType }
  | { kind: "rps"; choice: RpsChoice; round: number }
  | { kind: "hero_intro_complete" }
  | { kind: "trap_draft"; positions: readonly Position[] }
  | { kind: "preparation_ready" }
  | { kind: "traps"; positions: readonly Position[] }
  | { kind: "move"; command: MoveCommand }
  | { kind: "assassination"; command: AssassinationCommand }
  | { kind: "hero_ability"; command: HeroAbilityCommand }
  | { kind: "chat"; messageId: string; text: string }
  | { kind: "forfeit"; actionId: string }
  | { kind: "resign"; expectedRevision: number; actionId: string }
  | { kind: "rematch_request"; actionId: string }
  | { kind: "rematch_response"; accept: boolean };

export interface BluetoothRoomViews {
  publicRoom: PublicRemoteRoom;
  host: PlayerRemoteRoomView;
  guest: PlayerRemoteRoomView;
}

/**
 * The WebView on the Bluetooth host owns this class. The guest never creates
 * it: it only sends a BluetoothRoomAction and renders its returned private view.
 */
export class BluetoothHostRoom {
  private owned!: { room: RemoteRoom; results?: HostResultLedger };
  private mutating = false;
  private get room(): RemoteRoom { return this.owned.room; }
  private set room(room: RemoteRoom) { this.owned = { ...this.owned, room }; }
  private readonly randomInt?: RandomInt;
  private readonly now: () => number;

  constructor(options: {
    roomId: string;
    mode?: Partial<OptionalModeConfig>;
    randomInt?: RandomInt;
    now?: () => number;
    /** Physical RFCOMM admission replaces a human-entered invite token. */
    admissionSecret: string;
    /** Disabled by default; internal draft only. No wire or reconnect identity. */
    resultTracking?: HostResultOptions;
  }) {
    if (normalizeGameMode(options.mode?.baseMode) !== "jieqi") {
      throw new RuleError("MODE_TRANSPORT_PENDING", "新模式尚待英雄畸变与蓝牙协议适配，暂未开放蓝牙对局");
    }
    this.randomInt = options.randomInt;
    this.now = options.now ?? (() => Date.now());
    const initial = createRemoteRoom(options.roomId, BLUETOOTH_HOST_PLAYER, options.admissionSecret, this.now(), options.mode);
    const room = joinRemoteRoom(initial, BLUETOOTH_GUEST_PLAYER, options.admissionSecret, this.now()).room;
    const results = options.resultTracking ? new HostResultLedger(hostResultScope(options.roomId, options.resultTracking), [BLUETOOTH_HOST_PLAYER, BLUETOOTH_GUEST_PLAYER], options.resultTracking) : undefined;
    this.owned = { room, results };
  }

  private mutation<T>(operation: () => T): T {
    if (!this.owned.results) return operation(); // Legacy default path is unchanged.
    if (this.mutating) throw new TypeError("No reentrant tracked host mutation");
    this.mutating = true;
    try { return operation(); } finally { this.mutating = false; }
  }

  views(): BluetoothRoomViews { return this.mutation(() => this.projectViews()); }

  private projectViews(): BluetoothRoomViews {
    this.room = advanceRemoteRoomTime(this.room, this.randomInt, this.now());
    return {
      publicRoom: publicRemoteRoom(this.room),
      host: playerRoomView(this.room, BLUETOOTH_HOST_PLAYER),
      guest: playerRoomView(this.room, BLUETOOTH_GUEST_PLAYER),
    };
  }

  handle(playerId: typeof BLUETOOTH_HOST_PLAYER | typeof BLUETOOTH_GUEST_PLAYER, action: BluetoothRoomAction): BluetoothRoomViews {
    return this.mutation(() => {
      const now = this.now();
      this.room = advanceRemoteRoomTime(this.room, this.randomInt, now);
      const before = this.room, result = this.dispatch(before, playerId, action, now);
      const retired = action.kind === "rematch_response" && action.accept && before.phase === "finished" && result.room.phase !== "finished";
      this.owned = { room: result.room, results: retired ? this.owned.results?.retire() : this.owned.results };
      return this.projectViews();
    });
  }

  /** Explicit internal draft entry. Caller guarantees a globally fresh attempt
   * ID in this authority/match; retained duplicate IDs fail before dispatch.
   * Not a retransmission endpoint, a wire option or actor-authentication layer. */
  handleTracked(playerId: typeof BLUETOOTH_HOST_PLAYER | typeof BLUETOOTH_GUEST_PLAYER, transportId: string, input: TrackedHostAction): BluetoothRoomViews {
    const ledger = this.owned.results;
    if (!ledger) throw new TypeError("Host result tracking is disabled");
    return this.mutation(() => {
      const attempt = ledger.prepare(playerId, transportId, input);
      const now = this.now();
      if (!Number.isFinite(now)) throw new TypeError("Finite tracked host time required");
      // Pre-dispatch clock/RNG failure does not fabricate a command refusal.
      this.room = advanceRemoteRoomTime(this.room, this.randomInt, now);
      const before = this.room;
      let next = before, answer: HostResultAnswer = { query: "valid", outcome: "unknown" }, failed = false, failure: unknown;
      try {
        const result = this.dispatch(before, playerId, attempt.action, now);
        next = result.room;
        answer = trackedActionResult(before, next, attempt, now, result.duplicate);
      } catch (error) { failed = true; failure = error; answer = trackedRuleFailure(error); }
      const records = ledger.append(attempt, answer);
      // Allocate the ledger first, then publish actual room+record in one reference.
      // No crash durability or external transaction promise is made.
      this.owned = { room: next, results: records };
      if (failed) throw failure;
      return this.projectViews(); // Any later failure preserves the published result.
    });
  }

  resultScope(): HostResultScope | undefined { return this.owned.results?.scope(); }
  resultTrackingActive(): boolean { return this.owned.results?.active() ?? false; }
  queryResult(callerActor: string, query: unknown): HostResultAnswer {
    if (callerActor !== BLUETOOTH_HOST_PLAYER && callerActor !== BLUETOOTH_GUEST_PLAYER) return { query: "invalid" };
    return this.owned.results?.query(callerActor, query) ?? { query: "valid", outcome: "unknown" };
  }

  private dispatch(room: RemoteRoom, playerId: typeof BLUETOOTH_HOST_PLAYER | typeof BLUETOOTH_GUEST_PLAYER, action: BluetoothRoomAction, now: number): { room: RemoteRoom; duplicate?: boolean } {
    switch (action.kind) {
      case "rps": return { room: submitRemoteRps(room, playerId, action.choice, action.round, this.randomInt, now) };
      case "hero": return { room: submitRemoteHeroSelection(room, playerId, action.hero, this.randomInt, now, { form: action.form, variant: action.variant }) };
      case "hero_preparation_choice": return { room: submitRemoteHeroPreparationChoice(room, playerId, action, now, this.randomInt) };
      case "hero_intro_complete": return { room: completeRemoteHeroIntro(room, playerId, now) };
      case "trap_draft": return { room: updateRemoteTrapDraft(room, playerId, action.positions, now) };
      case "preparation_ready": return { room: completeRemoteHeroPreparation(room, playerId, now) };
      case "traps": return { room: submitRemoteTrapSetup(room, playerId, action.positions, now) };
      case "move": return submitRemoteMove(room, playerId, action.command, now);
      case "assassination": return submitRemoteAssassination(room, playerId, action.command, now);
      case "hero_ability": return submitRemoteHeroAbility(room, playerId, action.command, now, this.randomInt);
      case "chat": return submitRemoteChat(room, playerId, action.messageId, action.text, now);
      case "forfeit": return forfeitRemoteRoom(room, playerId, action.actionId, now);
      case "resign": return surrenderRemoteRoom(room, playerId, action.expectedRevision, action.actionId, now);
      case "rematch_request": return requestRemoteRematch(room, playerId, action.actionId, now);
      case "rematch_response": return { room: respondRemoteRematch(room, playerId, action.accept, now) };
      default: throw new RuleError("INVALID_BLUETOOTH_ACTION", "未知蓝牙房间操作");
    }
  }

  disconnect(playerId: typeof BLUETOOTH_HOST_PLAYER | typeof BLUETOOTH_GUEST_PLAYER): BluetoothRoomViews {
    return this.mutation(() => {
      const room = disconnectRemotePlayer(this.room, playerId, this.now());
      this.owned = { room, results: this.owned.results?.retire() };
      return this.projectViews();
    });
  }

  reconnect(playerId: typeof BLUETOOTH_HOST_PLAYER | typeof BLUETOOTH_GUEST_PLAYER): BluetoothRoomViews {
    return this.mutation(() => {
      const room = reconnectRemotePlayer(this.room, playerId, this.now());
      this.owned = { room, results: this.owned.results?.retire() };
      return this.projectViews();
    });
  }

  advance(): BluetoothRoomViews {
    return this.mutation(() => {
      this.room = advanceRemoteRoomTime(this.room, this.randomInt, this.now());
      return this.projectViews();
    });
  }
}

import { RuleError } from "./errors.ts";
import {
  createRemoteRoom,
  joinRemoteRoom,
  playerRoomView,
  publicRemoteRoom,
  submitRemoteAssassination,
  submitRemoteHeroSelection,
  submitRemoteMove,
  submitRemoteRps,
  submitRemoteTrapSetup,
  surrenderRemoteRoom,
  type PlayerRemoteRoomView,
  type PublicRemoteRoom,
  type RemoteRoom,
} from "./remote-room.ts";
import type { AssassinationCommand, HeroId, MoveCommand, OptionalModeConfig, Position, RandomInt } from "./types.ts";
import type { RpsChoice } from "./rps.ts";

export const BLUETOOTH_HOST_PLAYER = "bluetooth:host";
export const BLUETOOTH_GUEST_PLAYER = "bluetooth:guest";

export type BluetoothRoomAction =
  | { kind: "rps"; choice: RpsChoice; round: number }
  | { kind: "hero"; hero: HeroId }
  | { kind: "traps"; positions: readonly Position[] }
  | { kind: "move"; command: MoveCommand }
  | { kind: "assassination"; command: AssassinationCommand }
  | { kind: "resign"; expectedRevision: number; actionId: string };

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
  private room: RemoteRoom;
  private readonly randomInt?: RandomInt;
  private readonly now: () => number;

  constructor(options: {
    roomId: string;
    mode?: Partial<OptionalModeConfig>;
    randomInt?: RandomInt;
    now?: () => number;
    /** Physical RFCOMM admission replaces a human-entered invite token. */
    admissionSecret: string;
  }) {
    this.randomInt = options.randomInt;
    this.now = options.now ?? (() => Date.now());
    const initial = createRemoteRoom(options.roomId, BLUETOOTH_HOST_PLAYER, options.admissionSecret, this.now(), options.mode);
    this.room = joinRemoteRoom(initial, BLUETOOTH_GUEST_PLAYER, options.admissionSecret, this.now()).room;
  }

  views(): BluetoothRoomViews {
    return {
      publicRoom: publicRemoteRoom(this.room),
      host: playerRoomView(this.room, BLUETOOTH_HOST_PLAYER),
      guest: playerRoomView(this.room, BLUETOOTH_GUEST_PLAYER),
    };
  }

  handle(playerId: typeof BLUETOOTH_HOST_PLAYER | typeof BLUETOOTH_GUEST_PLAYER, action: BluetoothRoomAction): BluetoothRoomViews {
    const now = this.now();
    switch (action.kind) {
      case "rps":
        this.room = submitRemoteRps(this.room, playerId, action.choice, action.round, this.randomInt, now);
        break;
      case "hero":
        this.room = submitRemoteHeroSelection(this.room, playerId, action.hero, this.randomInt, now);
        break;
      case "traps":
        this.room = submitRemoteTrapSetup(this.room, playerId, action.positions, now);
        break;
      case "move":
        this.room = submitRemoteMove(this.room, playerId, action.command, now).room;
        break;
      case "assassination":
        this.room = submitRemoteAssassination(this.room, playerId, action.command, now).room;
        break;
      case "resign":
        this.room = surrenderRemoteRoom(this.room, playerId, action.expectedRevision, action.actionId, now).room;
        break;
      default:
        throw new RuleError("INVALID_BLUETOOTH_ACTION", "未知蓝牙房间操作");
    }
    return this.views();
  }
}

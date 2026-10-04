import { RuleError } from "./errors.js";
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



} from "./remote-room.js";



export const BLUETOOTH_HOST_PLAYER = "bluetooth:host";
export const BLUETOOTH_GUEST_PLAYER = "bluetooth:guest";























/**
 * The WebView on the Bluetooth host owns this class. The guest never creates
 * it: it only sends a BluetoothRoomAction and renders its returned private view.
 */
export class BluetoothHostRoom {
          room            ;
                   randomInt            ;
                   now              ;

  constructor(options






   ) {
    this.randomInt = options.randomInt;
    this.now = options.now ?? (() => Date.now());
    const initial = createRemoteRoom(options.roomId, BLUETOOTH_HOST_PLAYER, options.admissionSecret, this.now(), options.mode);
    this.room = joinRemoteRoom(initial, BLUETOOTH_GUEST_PLAYER, options.admissionSecret, this.now()).room;
  }

  views()                     {
    this.room = advanceRemoteRoomTime(this.room, this.randomInt, this.now());
    return {
      publicRoom: publicRemoteRoom(this.room),
      host: playerRoomView(this.room, BLUETOOTH_HOST_PLAYER),
      guest: playerRoomView(this.room, BLUETOOTH_GUEST_PLAYER),
    };
  }

  handle(playerId                                                              , action                     )                     {
    const now = this.now();
    this.room = advanceRemoteRoomTime(this.room, this.randomInt, now);
    switch (action.kind) {
      case "rps":
        this.room = submitRemoteRps(this.room, playerId, action.choice, action.round, this.randomInt, now);
        break;
      case "hero":
        this.room = submitRemoteHeroSelection(this.room, playerId, action.hero, this.randomInt, now);
        break;
      case "hero_intro_complete":
        this.room = completeRemoteHeroIntro(this.room, playerId, now);
        break;
      case "trap_draft":
        this.room = updateRemoteTrapDraft(this.room, playerId, action.positions, now);
        break;
      case "preparation_ready":
        this.room = completeRemoteHeroPreparation(this.room, playerId, now);
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
      case "hero_ability":
        this.room = submitRemoteHeroAbility(this.room, playerId, action.command, now, this.randomInt).room;
        break;
      case "chat":
        this.room = submitRemoteChat(this.room, playerId, action.messageId, action.text, now).room;
        break;
      case "forfeit":
        this.room = forfeitRemoteRoom(this.room, playerId, action.actionId, now).room;
        break;
      case "resign":
        this.room = surrenderRemoteRoom(this.room, playerId, action.expectedRevision, action.actionId, now).room;
        break;
      case "rematch_request":
        this.room = requestRemoteRematch(this.room, playerId, action.actionId, now).room;
        break;
      case "rematch_response":
        this.room = respondRemoteRematch(this.room, playerId, action.accept, now);
        break;
      default:
        throw new RuleError("INVALID_BLUETOOTH_ACTION", "未知蓝牙房间操作");
    }
    return this.views();
  }

  disconnect(playerId                                                              )                     {
    this.room = disconnectRemotePlayer(this.room, playerId, this.now());
    return this.views();
  }

  reconnect(playerId                                                              )                     {
    this.room = reconnectRemotePlayer(this.room, playerId, this.now());
    return this.views();
  }

  advance()                     {
    this.room = advanceRemoteRoomTime(this.room, this.randomInt, this.now());
    return this.views();
  }
}

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import { createContext, runInContext } from 'node:vm';
import { BLUETOOTH_GUEST_PLAYER, BLUETOOTH_HOST_PLAYER, BluetoothHostRoom } from '../../src/bluetooth-host-room.ts';
import { BLUETOOTH_PROTOCOL_VERSION, createBluetoothSnapshot, encodeBluetoothEnvelope, parseBluetoothEnvelope } from '../../src/bluetooth-protocol.ts';
import { RuleError } from '../../src/errors.ts';
import { CHAT_COOLDOWN_MS, CHAT_MAX_CHARACTERS } from '../../src/remote-room.ts';
import type { BluetoothRoomAction } from '../../src/bluetooth-host-room.ts';
import type { PlayerRemoteRoomView } from '../../src/remote-room.ts';

export const sourceHash=(s:string)=>createHash('sha256').update(s).digest('hex');
export const currentWeb=()=>readFileSync(new URL('../../web/app.ts',import.meta.url),'utf8');
export const parentWeb=()=>readFileSync(new URL('../../tests/fixtures/bluetooth-receipt/PR20_WEB_FUNCTIONS.txt',import.meta.url),'utf8');

/** Actual complete applyBluetoothView + actual channel functions. The final DOM
 * renderers and native send endpoint are recording substitutes, not devices. */
export function createReceiptChannel(room:BluetoothHostRoom,role:'host'|'guest',source=currentWeb(),checkedSend?: (raw:string)=>string){
  const a=source.indexOf('function applyBluetoothView('),b=source.indexOf('function showBluetoothRematchLobby(',a);
  // The immutable fixture joins the two unchanged source spans directly.
  const renderEnd=b<0?source.indexOf('function sendBluetoothEnvelope<T>',a):b;
  const c=source.indexOf('function sendBluetoothEnvelope<T>'),d=source.indexOf('function beginBluetoothHost()',c);
  assert(a>=0&&renderEnd>a&&c>=0&&d>c,'immutable production function anchors');
  const e=source.indexOf('function sendBluetoothChat('),f=source.indexOf('function nextActionId()',e);
  assert(e>=0&&f>e,'production chat source anchors');
  const applySource=source.slice(a,renderEnd),channelSource=source.slice(c,d),chatSource=source.slice(e,f);
  const emitted:string[]=[],attempted:string[]=[],toasts:string[]=[],renders:any[]=[],calls:any[]=[];
  const listeners=new Map<string,(event:any)=>void>();
  let id=0,uiTime=10000,failure:((raw:string,index:number)=>'throw'|'drop'|undefined)|undefined;
  const bluetooth={role,nativeState:'CONNECTED',hostRoom:room,view:undefined as PlayerRemoteRoomView|undefined,
    pendingAction:false,pendingActionId:undefined as string|undefined,pendingActionWriteUnknown:false,trapDraft:[],everConnected:true};
  const pane=()=>({hidden:true,textContent:'',disabled:false,value:''});
  const record=(name:string)=>(..._args:any[])=>renders.push({name,pending:bluetooth.pendingAction,phase:bluetooth.view?.phase});
  const bridge={send:(raw:string)=>{
    attempted.push(raw);const result=failure?.(raw,attempted.length-1);
    if(result==='throw')throw Error('recorded synchronous send failure');
    if(result!=='drop')emitted.push(raw);
  }};
  if(checkedSend)Object.assign(bridge,{sendChecked:(raw:string)=>{attempted.push(raw);return checkedSend(raw);}});
  const scope:any={bluetooth,BLUETOOTH_PROTOCOL_VERSION,BLUETOOTH_HOST_PLAYER,BLUETOOTH_GUEST_PLAYER,
    createBluetoothSnapshot,encodeBluetoothEnvelope,parseBluetoothEnvelope,RuleError,
    nativeBluetooth:()=>bridge,bluetoothActionId:()=>`recorded:${++id}`,
    showToast:(message:string)=>toasts.push(message),isBluetoothTransportInterrupted:()=>bluetooth.nativeState!=='CONNECTED',
    rpsPublic:{},gameState:undefined,gameSecret:undefined,selectedPieceId:undefined,assassinationArmed:false,strongStrikeArmed:false,
    latestAnnouncement:'',messageInput:pane(),disconnectLayer:pane(),CHAT_COOLDOWN_MS,CHAT_MAX_CHARACTERS,localChatCooldownUntil:0,
    Date:class extends Date{static now(){return uiTime;}},
    ownBluetoothPlayerId:()=>role==='host'?BLUETOOTH_HOST_PLAYER:BLUETOOTH_GUEST_PLAYER,
    bluetoothAnnouncement:()=>'',runOpeningSequence:record('opening-sequence'),
    window:{setTimeout:record('scheduled-timeout'),addEventListener:(type:string,fn:(event:any)=>void)=>listeners.set(type,fn)},
  };
  scope.beginChatCooldown=()=>{scope.localChatCooldownUntil=uiTime+CHAT_COOLDOWN_MS;};
  scope.renderMessagePanel=record('renderMessagePanel');
  for(const name of ['bluetoothLobbyView','mainMenuView','settingsView','heroView','rpsView','gameView'])scope[name]=pane();
  for(const name of ['disconnectTitle','disconnectCopy','disconnectTimer','disconnectBluetoothButton','bluetoothRematchTimer','bluetoothRematchAcceptButton',
    'bluetoothRematchDeclineButton','bluetoothRematchRequestButton','bluetoothSessionTitle','bluetoothSessionDetail','bluetoothSessionKicker',
    'bluetoothStateActions','bluetoothPermissionButton','bluetoothAppSettingsButton','bluetoothJoinPanel'])scope[name]=pane();
  for(const name of ['renderGame','renderRps','renderHeroSelection','queueFormalEventCues','resetMessageUi','closeMatchResult',
    'showBluetoothRematchLobby','setBattleActionMenu','closeMatchDetail','showDialog','showMainMenu','playRemoteTerminalAnimation','showMatchResult',
    'setBluetoothStatus','showBluetoothSessionState','resumeBluetoothUiClocks','pauseBluetoothUiClocks','renderDisconnectLayer','renderBluetoothAvailability'])scope[name]=record(name);
  const context=createContext(scope);
  runInContext(stripTypeScriptTypes(applySource+'\n'+channelSource+'\n'+chatSource),context);
  const eventStart=source.indexOf('window.addEventListener("jieqi-bluetooth"'),eventEnd=source.indexOf('document.addEventListener("visibilitychange"',eventStart);
  if(eventStart>=0&&eventEnd>eventStart)runInContext(stripTypeScriptTypes(source.slice(eventStart,eventEnd)),context);
  function invoke(expression:string,value?:unknown){scope.input=value;runInContext(expression,context);}
  return{sourceSha256:sourceHash(source),applySha256:sourceHash(applySource),channelSha256:sourceHash(channelSource),chatSha256:sourceHash(chatSource),bluetooth,emitted,attempted,toasts,renders,calls,
    setUiTime(time:number){uiTime=time;},
    chat(text:string){invoke('sendBluetoothChat(input, false)',text);},
    failWith(fn?:typeof failure){failure=fn;},
    receive(raw:string){calls.push({receive:parseBluetoothEnvelope(raw).type});invoke('handleIncomingBluetoothMessage(input)',raw);},
    nativeEvent(detail:unknown){const fn=listeners.get('jieqi-bluetooth');assert(fn,'actual native event listener included');fn({detail});},
    action(action:BluetoothRoomAction){calls.push({action:action.kind});invoke('handleBluetoothAction(input)',action);},
    publish(){invoke('publishBluetoothViews()');},
  };
}

/** Explicit FIFO recording queues. Delay by withholding delivery; never reorder
 * frames within a direction. This models the inspected single-stream caller,
 * and is not native scheduling or radio evidence. */
export function createReceiptPair(guestSource=currentWeb(),hostSource=currentWeb()){
  let now=1000;let rng=476;
  const room=new BluetoothHostRoom({roomId:'receipt-source',admissionSecret:'offline-only',now:()=>now,
    randomInt:max=>{rng=(rng*1664525+1013904223)>>>0;return rng%max;},
    mode:{baseMode:'jieqi',heroesEnabled:true,mutationsEnabled:false}});
  const host=createReceiptChannel(room,'host',hostSource),guest=createReceiptChannel(room,'guest',guestSource);
  let h=0,g=0;const delivered:Array<{direction:string;type:string;id?:string}>=[];
  function deliver(sender:typeof host,receiver:typeof host,index:number,direction:string){
    assert(index<sender.emitted.length,'actual queued frame exists');const raw=sender.emitted[index],e=parseBluetoothEnvelope(raw);
    delivered.push({direction,type:e.type,id:e.id});receiver.receive(raw);
  }
  return{room,host,guest,delivered,
    setTime(t:number){now=t;},
    nextHost(){deliver(host,guest,h++,'host→guest');},
    nextGuest(){deliver(guest,host,g++,'guest→host');},
    drain(){while(g<guest.emitted.length||h<host.emitted.length){if(g<guest.emitted.length)this.nextGuest();else this.nextHost();}},
    outstanding(){return{toHost:guest.emitted.length-g,toGuest:host.emitted.length-h};},
  };
}

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import { createContext, runInContext } from 'node:vm';
import { BluetoothHostRoom, BLUETOOTH_HOST_PLAYER, BLUETOOTH_GUEST_PLAYER } from '../../src/bluetooth-host-room.ts';
import { BLUETOOTH_PROTOCOL_VERSION, createBluetoothSnapshot, encodeBluetoothEnvelope, parseBluetoothEnvelope } from '../../src/bluetooth-protocol.ts';
import { RuleError } from '../../src/errors.ts';
import type { BluetoothRoomAction } from '../../src/bluetooth-host-room.ts';
import type { RemoteRoom, PlayerRemoteRoomView } from '../../src/remote-room.ts';

export const hash=(v:string)=>createHash('sha256').update(v).digest('hex');
export const webSource=()=>readFileSync(new URL('../../web/app.ts',import.meta.url),'utf8');

/** Execute the actual WebView message functions. Only the native send endpoint
 * and final DOM renderer are recording sinks; no Bluetooth connection is made. */
export function createRecordedWebChannel(hostRoom:BluetoothHostRoom,source=webSource(),role:'host'|'guest'='host'){
  const start=source.indexOf('function sendBluetoothEnvelope<T>'),end=source.indexOf('function beginBluetoothHost()',start);
  assert(start>=0&&end>start,'actual web channel source anchors');
  const slice=source.slice(start,end),emitted:string[]=[],sendAttempts:string[]=[],applied:PlayerRemoteRoomView[]=[],toasts:string[]=[],attempts:any[]=[];let sendFailure=false;
  const observedRoom={views:()=>hostRoom.views(),handle:(player:any,action:BluetoothRoomAction)=>{
    try{const result=hostRoom.handle(player,action);attempts.push({player,kind:action.kind,disposition:'returned_views',duplicateAckExposed:false});return result;}
    catch(error){attempts.push({player,kind:action.kind,disposition:'threw',code:(error as any).code??null,message:(error as Error).message});throw error;}
  }};
  const bluetooth={role,nativeState:'CONNECTED',hostRoom:observedRoom,view:undefined as PlayerRemoteRoomView|undefined,pendingAction:false};
  const context=createContext({bluetooth,BLUETOOTH_PROTOCOL_VERSION,BLUETOOTH_HOST_PLAYER,BLUETOOTH_GUEST_PLAYER,
    createBluetoothSnapshot,encodeBluetoothEnvelope,parseBluetoothEnvelope,RuleError,
    nativeBluetooth:()=>({send:(raw:string)=>{sendAttempts.push(raw);if(sendFailure)throw Error('recorded native send failure');emitted.push(raw);}}),
    applyBluetoothView:(view:PlayerRemoteRoomView)=>{applied.push(structuredClone(view));bluetooth.view=structuredClone(view);},
    showToast:(message:string)=>toasts.push(message),isBluetoothTransportInterrupted:()=>false,bluetoothActionId:()=> 'recorded-envelope',
  });
  runInContext(stripTypeScriptTypes(slice),context);
  return{sourceSha256:hash(source),sliceSha256:hash(slice),emitted,sendAttempts,applied,toasts,attempts,bluetooth,
    failSending(value:boolean){sendFailure=value;},
    receive(raw:string){(context as any).rawMessage=raw;runInContext('handleIncomingBluetoothMessage(rawMessage)',context);},
    hostAction(action:BluetoothRoomAction){(context as any).nextAction=action;runInContext('handleBluetoothAction(nextAction)',context);},
    publish(){runInContext('publishBluetoothViews()',context);},
  };
}

function seeded(seed:number){let value=seed>>>0;return(max:number)=>{value=(1664525*value+1013904223)>>>0;return value%max;};}

/** Original CH06/PR14 seed476 H15(red)/H11(black), real BluetoothHostRoom setup.
 * No private field is assigned; private authority reads are owner-only probes. */
export function createH15H11ChannelFixture(recruit:0|1,source=webSource()){
  let at=1000,random=seeded(476),stage='opening';const initialTimes=[1000,1001],draws:Array<{stage:string;bound:number;index:number}>=[];
  const room=new BluetoothHostRoom({roomId:'CH06-wire-source',admissionSecret:'internal-recorded-link',mode:{baseMode:'jieqi',heroesEnabled:true,mutationsEnabled:false},
    now:()=>initialTimes.length?initialTimes.shift()!:at,randomInt:bound=>{const index=random(bound);draws.push({stage,bound,index});return index;}});
  const call=(time:number,player:typeof BLUETOOTH_HOST_PLAYER|typeof BLUETOOTH_GUEST_PLAYER,action:BluetoothRoomAction)=>{at=time;return room.handle(player,action);};
  call(1002,BLUETOOTH_HOST_PLAYER,{kind:'hero',hero:'sky_admiral'});call(1003,BLUETOOTH_GUEST_PLAYER,{kind:'hero',hero:'shuffler'});
  call(1004,BLUETOOTH_HOST_PLAYER,{kind:'rps',choice:'scissors',round:1});call(1005,BLUETOOTH_GUEST_PLAYER,{kind:'rps',choice:'rock',round:1});
  call(1006,BLUETOOTH_HOST_PLAYER,{kind:'hero_intro_complete'});call(1007,BLUETOOTH_GUEST_PLAYER,{kind:'hero_intro_complete'});
  stage='recruit';random=seeded(recruit);call(1008,BLUETOOTH_HOST_PLAYER,{kind:'hero_preparation_choice',trainingType:'cannon'});
  call(1009,BLUETOOTH_HOST_PLAYER,{kind:'preparation_ready'});at=1010;room.advance();
  const authority=()=>structuredClone((room as unknown as {room:RemoteRoom}).room);
  const command=(from:number[],to:number[],id:string)=>({actionId:id,expectedRevision:authority().game!.state.revision,from:{x:from[0],y:from[1]},to:{x:to[0],y:to[1]}});
  call(5000,BLUETOOTH_HOST_PLAYER,{kind:'move',command:command([0,9],[0,6],'A-red1')});
  call(10000,BLUETOOTH_GUEST_PLAYER,{kind:'move',command:command([0,3],[0,4],'A-black1')});
  const open=authority();assert.equal(open.game!.state.pendingShuffle?.window,'A');assert.equal(open.game!.players.red,BLUETOOTH_HOST_PLAYER);
  assert.equal(open.game!.secret.training!.red!.pieceId,recruit===0?'covered-25':'covered-00');
  assert.equal(Boolean(open.game!.secret.training!.red!.failed),recruit===0);
  const channel=createRecordedWebChannel(room,source);channel.publish();
  return{room,channel,authority,draws,deadline:open.game!.state.turnDeadlineAt!,open,
    setTime(time:number){at=time;},
    useShuffleTape(){stage='shuffle';const shuffle=seeded(12),rebind=seeded(1);let calls=0;random=bound=>++calls<=29?shuffle(bound):rebind(bound);},
    shuffle(actionId='wire-shuffle'){
      const action:BluetoothRoomAction={kind:'hero_ability',command:{kind:'hero_ability',ability:'shuffle',actionId,expectedRevision:open.game!.state.revision}};
      return{action,raw:encodeBluetoothEnvelope({v:BLUETOOTH_PROTOCOL_VERSION,type:'action',id:'request:'+actionId,payload:action})};
    },
  };
}

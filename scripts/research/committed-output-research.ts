import assert from 'node:assert/strict';
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { createH15H11ChannelFixture, hash } from './committed-output-channel.ts';
import { createOriginalHalfChaosSession } from './original-half-chaos.ts';
import { serializePublicRemoteRoom } from '../../src/remote-room.ts';
import { parseBluetoothEnvelope } from '../../src/bluetooth-protocol.ts';
import { captureMechanismEvents } from '../../src/mechanism-observer.ts';

const digest=(v:any)=>hash(JSON.stringify(v));
const clone=(v:any)=>JSON.parse(JSON.stringify(v));
export function runCommittedOutputResearch(ownerRaw?:(x:any)=>void){
  const old=readFileSync(new URL('../../tests/fixtures/committed-output/PR19_WEB_CHANNEL.txt',import.meta.url),'utf8');
  assert.equal(hash(old),'f2007d05deb3b6b027ae1912ff7f22056329f676c48856f39409b6c44231a7bd','immutable actual parent web excerpt');
  const channelCases=[],currentPairs=new Map<string,any>();
  for(const recruit of [0,1]as const)for(const delta of [-1,0,1]){
    const parent=createH15H11ChannelFixture(recruit,old),current=createH15H11ChannelFixture(recruit);
    for(const f of [parent,current]){f.setTime(f.deadline+delta);if(delta<0)f.useShuffleTape();}
    const run=(f:ReturnType<typeof createH15H11ChannelFixture>)=>{
      const first=f.channel.emitted.length,wire=f.shuffle();
      const observed=captureMechanismEvents(()=>f.channel.receive(wire.raw)),authority=f.authority(),firstFrames=f.channel.emitted.slice(first);
      const retryStart=f.channel.emitted.length;f.setTime(f.deadline+delta+1);const retryObserved=captureMechanismEvents(()=>f.channel.receive(wire.raw));
      return{authority,afterRetry:f.authority(),events:observed.events,retryEvents:retryObserved.events,firstFrames,retryFrames:f.channel.emitted.slice(retryStart),attempts:f.channel.attempts,
        applied:f.channel.applied,toasts:f.channel.toasts,draws:f.draws,sourceSha256:f.channel.sourceSha256,sliceSha256:f.channel.sliceSha256};
    };
    const a=run(parent),b=run(current);assert.deepEqual(b.authority,a.authority);assert.deepEqual(b.afterRetry,a.afterRetry);assert.deepEqual(b.events,a.events);assert.deepEqual(b.retryEvents,a.retryEvents);assert.deepEqual(b.draws,a.draws);
    const types=(xs:string[])=>xs.map(raw=>parseBluetoothEnvelope(raw).type);
    assert.deepEqual(types(b.firstFrames),delta<0?['snapshot']:['error','snapshot']);assert.deepEqual(types(a.firstFrames),delta<0?['snapshot']:['error']);
    const snap=b.firstFrames.map(parseBluetoothEnvelope).find(e=>e.type==='snapshot')!.payload as any;
    assert.equal(snap.state.turn,'red');assert.equal(snap.state.pendingShuffle,undefined);assert.equal(b.authority.game!.state.formalTurns!.black,1);
    if(delta>=0){assert.equal(b.attempts[0].code,'WRONG_TURN');assert.equal(b.draws.filter(x=>x.stage==='shuffle').length,0);}
    currentPairs.set(recruit+':'+delta,b);
    const row={recruitSource:recruit,deltaFromObservedDeadline:delta,observedDeadline:current.deadline,parentPacketTypes:types(a.firstFrames),fixedPacketTypes:types(b.firstFrames),
      parentAppliedTurn:a.applied.at(-1)!.state!.turn,fixedAppliedTurn:b.applied.at(-1)!.state!.turn,authorityTurn:b.authority.game!.state.turn,
      parentFixedAuthorityAndEventsAndDrawsEqual:true,firstFrameHashes:b.firstFrames.map(hash),repeatFrameTypes:types(b.retryFrames),repeatFrameHashes:b.retryFrames.map(hash),
      actualHandlerOutcomes:b.attempts,shuffleDraws:b.draws.filter(x=>x.stage==='shuffle').length,
      mockNativeBridgeOnly:true,realRadioDelivery:false,actualDOMRender:false};channelCases.push(row);
    ownerRaw?.({kind:'actual_web_handler_mock_bridge',case:row,parent:a,current:b});
  }
  for(const delta of [-1,0,1]){
    const a=currentPairs.get('0:'+delta),b=currentPairs.get('1:'+delta);assert.deepEqual(a.firstFrames,b.firstFrames);assert.deepEqual(a.retryFrames,b.retryFrames);assert.deepEqual(a.applied,b.applied);
  }
  const dir=new URL('../../tests/fixtures/half-chaos-original/',import.meta.url),[initial,replays]=['INITIALIZATION_WITNESS_DATA.json','REPLAY_ACTION_DATA.json'].map(x=>readFileSync(new URL(x,dir),'utf8'));
  const halfRows=[],duplicates=[],repeatRefusals=[];
  for(const spec of JSON.parse(replays).replays){
    const s=createOriginalHalfChaosSession(initial,replays,spec.replay_id);
    for(const turn of s.replay.source_prescribed_turns)for(const request of [...turn.pre_main_requests,turn.normal_main]){
      const r=s.step(request.declaration_id);assert.equal(r.disposition,request.expected_disposition??'accepted');
      const publicJson=serializePublicRemoteRoom(r.after),redJson=JSON.stringify(r.views.red),blackJson=JSON.stringify(r.views.black),pub=JSON.parse(publicJson);
      assert.deepEqual(pub,clone(r.views.public));assert.deepEqual(pub.messages,clone(r.after.messages));assert.equal(pub.updatedAt,r.after.updatedAt);
      const main=request===turn.normal_main;
      if(r.disposition==='accepted'){
        assert.equal(pub.updatedAt,r.now);if(main)assert(pub.messages.some((x:any)=>x.id==='system:'+r.command.actionId));
        const retry=s.step(request.declaration_id,{expectedRevision:r.command.expectedRevision,now:r.now+1});
        assert.equal(retry.disposition,'accepted');assert.equal(retry.duplicate,true);assert.deepEqual(retry.command,r.command);assert.deepEqual(retry.after,r.after);assert.deepEqual(retry.events,[]);
        duplicates.push({id:r.declarationId,kind:'NEW_EXACT_PAYLOAD_SERVER_RETRANSMISSION_NOT_ORIGINAL110',actualDuplicate:true,authorityHistoryClockUnchanged:true,clientReceipt:false});
      }else{
        assert.equal(r.error!.code,'IN_CHECK');assert.deepEqual(r.before,r.after);
        const retry=s.step(request.declaration_id,{expectedRevision:r.command.expectedRevision,now:r.now+1});assert.equal(retry.disposition,'rejected');assert.deepEqual(retry.command,r.command);assert.deepEqual(retry.after,r.after);assert.deepEqual(retry.events,[]);
        repeatRefusals.push({id:r.declarationId,kind:'NEW_SAME_PAYLOAD_SERVER_REFUSAL_CONTROL_NOT_ORIGINAL110',code:retry.error!.code,authorityHistoryClockUnchanged:true,clientReceipt:false});
      }
      const row={replayId:s.binding.replayId,id:r.declarationId,disposition:r.disposition,sourceKind:main?'normal_main':'pre_main',
        updatedAt:pub.updatedAt,requestNow:r.now,messageCount:pub.messages?.length??0,currentActionMessagePresent:Boolean(pub.messages?.some((x:any)=>x.id==='system:'+r.command.actionId)),
        publicJsonSha256:hash(publicJson),redJsonSha256:hash(redJson),blackJsonSha256:hash(blackJson),serverRuleError:r.error??null,
        exactCommittedReturn:true,midActionFrame:false,halfChaosBluetoothDelivery:false};halfRows.push(row);
      ownerRaw?.({kind:'original_half_committed_return',binding:s.binding,id:r.declarationId,command:r.command,disposition:r.disposition,serverRuleError:r.error??null,publicJson,redJson,blackJson});
    }
  }
  assert.equal(halfRows.length,110);assert.equal(duplicates.length,106);assert.equal(repeatRefusals.length,4);
  return{schema:'lezi.main.committed_output_channel_research.v1',id:'MAIN-ROOM-COMMITTED-OUTPUT-CHANNEL-20261029',executedLocalDate:'2026-10-29',engineParent:'760caf57d454af0db3be92d5b52ffc3cc9078d06',
    reproducedDefect:'Original eligible H15/H11 natural room advances at observed A deadline; old actual web handler sends only error, retaining old peer view. Fixed handler emits error then sanitized latest committed snapshot.',
    channelCases,privateWorldWirePairComparisons:3,privateWorldWirePairsEqual:3,halfRows,duplicates,repeatRefusals,
    totals:{originalHalfRequests:110,committedPublicJson:110,committedPlayerJson:220,newServerExactPayloadDuplicates:106,newServerRepeatRefusals:4,
      originalServerInCheckRefusals:4,originalHalfClientErrorPayloads:0,mockWebHandlerCases:6,fullOriginal56Discharged:0,formalOriginal64Accepted:0,actualDeviceDeliveries:0},
    outputContract:{guestErrorPayload:'{message} only; no fabricated code/duplicate ACK fields',duplicates:'BluetoothHostRoom returns views, not duplicate ACK; direct server duplicate evidence is separate',
      halfChaos:'MODE_TRANSPORT_PENDING remains; complete committed room serialization is server evidence, not actual half-chaos wire delivery',renderer:'Actual web send/incoming functions; native bridge and applyBluetoothView endpoints are recording sinks, full DOM/device not executed'},
    protected:{gameplayDelta:0,modeGateChanged:false,scoring:'frozen',NET:'paused',heroDesignAndUIAssetsChanged:false,independentQA:false},rawPayloadsInPublicReport:false};
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  const arg=(k:string)=>process.argv.find(x=>x.startsWith(k+'='))?.slice(k.length+1),raw=arg('--owner-raw'),out=arg('--output');
  if(raw)writeFileSync(raw,'');const r=runCommittedOutputResearch(raw?x=>appendFileSync(raw,JSON.stringify(x)+'\n'):undefined);
  if(out)writeFileSync(out,JSON.stringify(r)+'\n');console.log(JSON.stringify(r.totals));
}

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { createOriginalHalfChaosSession, ORIGINAL_HC_SOURCE } from './original-half-chaos.ts';
import { publicStateSnapshot } from '../../src/game.ts';

export const HC51_SLOT_SOURCE_SHA256='5080e34bb93a640827acefb79d60a57f58049eef630d1e918b6ba3836c1388f0';
const digest=(s:string)=>createHash('sha256').update(s).digest('hex');
const hash=(v:any)=>digest(JSON.stringify(v));
const bytes=(s:string)=>Buffer.byteLength(s,'utf8');

/** Only exact factory-issued identifiers at explicitly named transport fields
 * are mapped. No clock, revision, message text, type or effect is discarded. */
export function normalizeDeclaredView(value:any,binding:any,replay:any){
  const ids=new Map<string,string>([[binding.roomId,'<room>'],[binding.players.red,'<red-player>'],[binding.players.black,'<black-player>']]);
  for(const [i,t] of replay.source_prescribed_turns.entries())for(const [j,r] of [...t.pre_main_requests,t.normal_main].entries()){
    const raw=`${binding.roomId}:${r.declaration_id}`,tag=`<request:${i+1}:${j}>`;ids.set(raw,tag);ids.set('system:'+raw,'system:'+tag);
  }
  const substitutions:string[]=[];
  const contextual=(p:string)=>p==='/roomId'||/^\/seats\/(host|guest)\/playerId$/.test(p)||/^\/rps\/(players\/\d+|assignments\/(red|black)|lastResult\/(winner|loser))$/.test(p)||
    /^\/state\/(turnLifecycle|lastCompletedFormalTurn)\/mainActionId$/.test(p)||/^\/state\/(lastMove\/actionId|actionRecords\/\d+\/actionId)$/.test(p)||/^\/messages\/\d+\/id$/.test(p);
  const dictionary=(p:string)=>['/rps/submitted','/rps/lastResult/choices','/disconnects/players'].includes(p);
  const visit=(v:any,p:string):any=>{
    if(typeof v==='string'&&contextual(p)&&ids.has(v)){substitutions.push(p);return ids.get(v);}
    if(Array.isArray(v))return v.map((x,i)=>visit(x,p+'/'+i));
    if(v&&typeof v==='object')return Object.fromEntries(Object.entries(v).map(([k,x])=>{
      const key=dictionary(p)&&[binding.players.red,binding.players.black].includes(k)?ids.get(k)!:k;
      if(key!==k)substitutions.push(p+'/<issued-player-key>');return[key,visit(x,p+'/'+key)];
    }));return v;
  };
  return{value:visit(value,''),substitutionPaths:[...new Set(substitutions)].sort()};
}

export function differingPaths(a:any,b:any,p=''):string[]{
  if(JSON.stringify(a)===JSON.stringify(b))return[];
  if(a&&b&&typeof a==='object'&&typeof b==='object'&&Array.isArray(a)===Array.isArray(b))return[...new Set([...Object.keys(a),...Object.keys(b)])].flatMap(k=>differingPaths(a[k],b[k],p+'/'+k));
  return[p||'/'];
}

function assertPrivateBoundary(v:any){
  if(!v||typeof v!=='object')return;
  for(const [k,x]of Object.entries(v)){
    assert(!['secret','identities','destinyIdentities','processedActions','trainingOriginalSides','inviteTokenHash','rpsSecret','featureSecret','checkpointProjection'].includes(k),'private key in projected output: '+k);
    assertPrivateBoundary(x);
  }
  if(v.faceDown===true)for(const k of ['type','trueType','trueColor','identity'])assert(!(k in v),'hidden identity in covered piece');
}

export function runHalfChaosStageViews(initial:string,replays:string,slotText:string,ownerRaw?:(record:any)=>void){
  assert.equal(digest(slotText),HC51_SLOT_SOURCE_SHA256,'immutable original HC51 slot contract mismatch');
  const contract=JSON.parse(slotText),source=JSON.parse(replays),slots=contract.pair_source_readiness.comparison_slots;
  assert.equal(slots.length,56);assert.equal(new Set(slots.map((x:any)=>x.comparison_id)).size,56);
  const checkpoints=new Map<string,any>(),initials=new Map<string,any>(),runs=[],requests=[];
  let totalMain=0,totalSettled=0,viewJsonCount=0;
  for(const spec of source.replays){
    const s=createOriginalHalfChaosSession(initial,replays,spec.replay_id,{stageProjections:true}),rows=[];
    initials.set(s.binding.replayId,s.initial.game);
    for(const turn of s.replay.source_prescribed_turns)for(const declared of [...turn.pre_main_requests,turn.normal_main]){
      const r=s.step(declared.declaration_id);assert.equal(r.disposition,declared.expected_disposition??'accepted');assert.equal(r.evidenceValid,true);if(r.disposition==='accepted')assert.equal(r.duplicate,false);
      const stageEvents=r.events.filter(e=>e.kind==='main_action_atom_closed'||e.kind==='formal_turn_settled');
      if(declared===turn.normal_main){assert.equal(stageEvents.length,2);totalMain++;totalSettled++;}else assert.equal(stageEvents.length,0);
      for(const event of stageEvents){
        const p=event.checkpointProjection as any;assert(p);assert.equal(p.emittedBeforeRequestReturn,true);assert.equal(p.actualClientDelivery,false);
        const stage=event.kind==='main_action_atom_closed'?'main:closed':'normal-end',cp=`${s.binding.replayId}:${turn.turn_label}:${stage}`;
        assert(!checkpoints.has(cp));
        const pub=JSON.parse(p.publicJson),red=JSON.parse(p.redJson),black=JSON.parse(p.blackJson);
        assert.deepEqual(pub.state,publicStateSnapshot(event.state));assert.equal(red.viewerSide,'red');assert.equal(black.viewerSide,'black');
        assert.equal(event.state.turnDeadlineAt,r.before.game!.state.turnDeadlineAt);
        assert.equal(pub.updatedAt,r.before.updatedAt);assert.equal(pub.messages?.length,r.before.messages?.length);
        for(const v of [pub,red,black])assertPrivateBoundary(v);
        const idx=r.events.indexOf(event),nextBegin=r.events.findIndex(e=>e.kind==='formal_turn_begin');assert(nextBegin>idx);
        viewJsonCount+=3;
        const row={checkpointId:cp,stage,request:declared.declaration_id,binding:s.binding,gameRevision:event.state.revision,
          formalTurns:event.state.formalTurns,turnDeadlineAt:event.state.turnDeadlineAt,eventIndex:idx,nextBeginEventIndex:nextBegin,
          emittedBeforeRequestReturn:true,envelopeBasis:p.envelopeBasis,envelopeUpdatedAt:p.envelopeUpdatedAt,
          publicJsonSha256:digest(p.publicJson),redJsonSha256:digest(p.redJson),blackJsonSha256:digest(p.blackJson),
          publicBytes:bytes(p.publicJson),redBytes:bytes(p.redJson),blackBytes:bytes(p.blackJson),actualClientDelivery:false};
        rows.push(row);checkpoints.set(cp,{projection:p,binding:s.binding,replay:s.replay,row});
      }
      requests.push({replayId:s.binding.replayId,id:declared.declaration_id,disposition:r.disposition,errorCode:r.error?.code??null,stageCount:stageEvents.length});
      ownerRaw?.({binding:s.binding,declarationId:declared.declaration_id,disposition:r.disposition,
        authorityOnlyCheckpoints:stageEvents.map(({checkpointProjection,...e})=>e),
        exactStageProjectionJson:stageEvents.map(e=>e.checkpointProjection),returnedRoomViews:r.views,
        returnedAuthoritySha256:hash(r.after),captureEvidenceValid:r.evidenceValid});
    }
    runs.push({replayId:s.binding.replayId,tupleId:s.binding.tupleId,initialPieceCount:s.initial.game!.state.pieces.length,checkpoints:rows.length,rows});
  }
  const initialPairAudit=contract.pair_source_readiness.pairs.map((pair:any)=>{
    const a=initials.get(pair.replay_ids[0]),b=initials.get(pair.replay_ids[1]);assert(a&&b);
    const changed=Object.keys(a.secret.identities).filter(id=>JSON.stringify(a.secret.identities[id])!==JSON.stringify(b.secret.identities[id]));
    assert.equal(changed.length,2);assert.deepEqual(publicStateSnapshot(a.state),publicStateSnapshot(b.state));
    return{pairId:pair.id,actualDifferentPrivateIdentitySlots:changed.length,initialPublicStateIdentical:true,privateIdentityValuesPublished:false};
  });
  const comparisons=slots.map((slot:any)=>{
    const left=checkpoints.get(slot.original_left_checkpoint),right=checkpoints.get(slot.original_right_checkpoint);assert(left&&right,'original checkpoint missing');
    const field=slot.viewer_side==='red'?'redJson':'blackJson',a=JSON.parse(left.projection[field]),b=JSON.parse(right.projection[field]);
    assert.equal(a.viewerSide,slot.viewer_side);assert.equal(b.viewerSide,slot.viewer_side);
    const na=normalizeDeclaredView(a,left.binding,left.replay),nb=normalizeDeclaredView(b,right.binding,right.replay),changedPaths=differingPaths(na.value,nb.value);
    return{comparisonId:slot.comparison_id,pairId:slot.pair_id,viewerSide:slot.viewer_side,stage:slot.stage,
      leftCheckpoint:slot.original_left_checkpoint,rightCheckpoint:slot.original_right_checkpoint,
      leftRawSha256:digest(left.projection[field]),rightRawSha256:digest(right.projection[field]),leftBytes:bytes(left.projection[field]),rightBytes:bytes(right.projection[field]),
      contextSubstitutionPathsLeft:na.substitutionPaths,contextSubstitutionPathsRight:nb.substitutionPaths,
      normalizedEqual:changedPaths.length===0,changedPaths,
      finding:changedPaths.length?'DIFFERENCES_REQUIRE_SOURCE_PERMISSION_REVIEW':'IDENTICAL_VISIBLE_FIELDS_AFTER_EXACT_ISSUED_CONTEXT_ID_MAPPING',
      exactGameProjectionComponentObserved:true,fullRoomEnvelopeObserved:false,actualClientDelivery:false,completeOriginalSlotDischarged:false};
  });
  assert.equal(totalMain,100);assert.equal(totalSettled,100);assert.equal(viewJsonCount,600);assert.equal(requests.length,110);
  return{schema:'lezi.half_chaos.exact_stage_projection_research.v1',id:'MAIN-HC56-EXACT-STAGE-VIEW-20261029',executedLocalDate:'2026-10-29',
    engineParent:'099eca44dbaab39bdedb02a9986f7d54e9761121',originalSource:ORIGINAL_HC_SOURCE,slotContractSha256:HC51_SLOT_SOURCE_SHA256,
    totals:{originalReplays:12,requests:110,mainAtoms:100,formalSettlements:100,exactGameStageCheckpoints:200,serializedPublicJson:200,serializedPlayerJson:400,
      originalPairComparisonSlots:56,underlyingPairedPlayerJson:112,normalizedEqual:comparisons.filter((x:any)=>x.normalizedEqual).length,
      differingSlots:comparisons.filter((x:any)=>!x.normalizedEqual).length,completeOriginalSlotsDischarged:0,clientDeliveriesObserved:0},
    projectionBoundary:'Game state/secret captured and projected synchronously at actual checkpoint emission, before next begin. Outer room metadata/messages are actual request-entry context, not a completed room packet. Exact-slot obligations remain partially open.',
    normalization:'Only exact issued room/player/request/system-message identifiers at enumerated context fields and player dictionary keys. No timestamps/revision/deadline/message text/piece/effect omitted.',
    initialPairAudit,requests,runs,comparisons,sourceOraclesUnchanged:true,formalOriginal64Accepted:0,independentQA:false,featuresReady:false,scoring:'frozen',NET:'paused',
    publicReportContainsRawAuthorityOrPlayerPayload:false};
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  const dir=new URL('../../tests/fixtures/half-chaos-original/',import.meta.url),[a,b,c]=['INITIALIZATION_WITNESS_DATA.json','REPLAY_ACTION_DATA.json','HC51_PAIR_VIEW_CONTRACT.json'].map(x=>readFileSync(new URL(x,dir),'utf8'));
  const arg=(k:string)=>process.argv.find(x=>x.startsWith(k+'='))?.slice(k.length+1),raw=arg('--owner-raw'),out=arg('--output');
  if(raw)writeFileSync(raw,'');const r=runHalfChaosStageViews(a,b,c,raw?x=>appendFileSync(raw,JSON.stringify(x)+'\n'):undefined);
  if(out)writeFileSync(out,JSON.stringify(r)+'\n');console.log(JSON.stringify(r.totals));
}

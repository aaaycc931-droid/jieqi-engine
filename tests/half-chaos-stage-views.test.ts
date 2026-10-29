import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createOriginalHalfChaosSession } from '../scripts/research/original-half-chaos.ts';
import { runHalfChaosStageViews, normalizeDeclaredView, differingPaths } from '../scripts/research/half-chaos-stage-views.ts';
import { captureMechanismEvents, emitAuthorityCheckpoint, withoutMechanismEvents, withIsolatedMechanismEvents } from '../src/mechanism-observer.ts';
import { GAME_MODES } from '../src/modes.ts';

const dir=new URL('./fixtures/half-chaos-original/',import.meta.url);
const [initial,replays,slots]=['INITIALIZATION_WITNESS_DATA.json','REPLAY_ACTION_DATA.json','HC51_PAIR_VIEW_CONTRACT.json'].map(x=>readFileSync(new URL(x,dir),'utf8'));
const report=runHalfChaosStageViews(initial,replays,slots);
const source=()=>createOriginalHalfChaosSession(initial,replays,'MA-PD05-A').initial.game!;

for(const run of report.runs)test(`HC stage ${run.replayId}: exact live checkpoint projection precedes next begin and keeps entry envelope distinct`,()=>{
  assert.equal(run.initialPieceCount,32);assert.equal(run.checkpoints,run.rows.length);assert(run.rows.length>0);
  for(const row of run.rows){
    assert(row.eventIndex<row.nextBeginEventIndex);assert.equal(row.emittedBeforeRequestReturn,true);
    assert.equal(row.envelopeBasis,'ACTUAL_REQUEST_ENTRY_METADATA_NOT_COMMITTED_ROOM_DELIVERY');
    assert.equal(row.actualClientDelivery,false);assert(row.publicBytes>0&&row.redBytes>0&&row.blackBytes>0);
  }
});

for(const pairId of ['PAIR-PD05','PAIR-PD06'])test(`HC56 ${pairId}: all28 original viewer slots compared, raw hashes retained, client/full-envelope obligations open`,()=>{
  const initial=report.initialPairAudit.find((x:any)=>x.pairId===pairId)!;assert.equal(initial.actualDifferentPrivateIdentitySlots,2);assert.equal(initial.initialPublicStateIdentical,true);
  const rows=report.comparisons.filter((x:any)=>x.pairId===pairId);assert.equal(rows.length,28);
  assert.equal(rows.filter((x:any)=>x.viewerSide==='red').length,14);assert.equal(rows.filter((x:any)=>x.viewerSide==='black').length,14);
  for(const row of rows){
    assert.equal(row.normalizedEqual,true,JSON.stringify(row.changedPaths));assert.equal(row.exactGameProjectionComponentObserved,true);
    assert.equal(row.fullRoomEnvelopeObserved,false);assert.equal(row.completeOriginalSlotDischarged,false);assert.equal(row.actualClientDelivery,false);
    assert.match(row.leftRawSha256,/^[0-9a-f]{64}$/);assert.match(row.rightRawSha256,/^[0-9a-f]{64}$/);
  }
});

test('HC original12 stage projection totals are200 checkpoints/600 JSON payloads; complete56 slots and formal64 acceptance remain0',()=>{
  assert.equal(report.totals.requests,110);assert.equal(report.totals.mainAtoms,100);assert.equal(report.totals.formalSettlements,100);
  assert.equal(report.totals.exactGameStageCheckpoints,200);assert.equal(report.totals.serializedPublicJson,200);assert.equal(report.totals.serializedPlayerJson,400);
  assert.equal(report.totals.originalPairComparisonSlots,56);assert.equal(report.totals.underlyingPairedPlayerJson,112);assert.equal(report.totals.normalizedEqual,56);
  assert.equal(report.totals.completeOriginalSlotsDischarged,0);assert.equal(report.formalOriginal64Accepted,0);assert.equal(report.independentQA,false);
  assert.equal(GAME_MODES.half_chaos.featuresReady,false);assert.equal(report.requests.filter((x:any)=>x.disposition==='rejected').length,4);
});

test('HC56 original slot and replay inputs reject tampering rather than accepting synthetic replacement checkpoints',()=>{
  assert.throws(()=>runHalfChaosStageViews(initial,replays,slots+' '),/immutable original HC51/);
  assert.throws(()=>runHalfChaosStageViews(initial+' ',replays,slots),/hash mismatch/);
});

test('checkpoint projector runs synchronously on frozen isolated input and freezes a cloned output',()=>{
  const {state,secret}=source(),before=structuredClone({state,secret}),out={values:['observed']};let returned=false,calls=0;
  const r=captureMechanismEvents(()=>{
    emitAuthorityCheckpoint('main_action_atom_closed',state,secret,{side:'red'});returned=true;return'success';
  },{projectCheckpoint:e=>{
    calls++;assert.equal(returned,false);assert(Object.isFrozen(e));assert(Object.isFrozen(e.state));assert(Object.isFrozen(e.secret));
    assert.notEqual(e.state,state);assert.notEqual(e.secret,secret);return out;
  }});
  assert.equal(r.result,'success');assert.equal(calls,1);out.values[0]='later';
  assert.deepEqual(r.events[0].checkpointProjection,{values:['observed']});assert(Object.isFrozen(r.events[0].checkpointProjection));assert.deepEqual({state,secret},before);
});

for(const kind of ['throws','mutates','async','uncloneable'] as const)test(`checkpoint projector ${kind}: invalidates evidence without changing successful source result; stack restores`,()=>{
  const {state,secret}=source(),before=structuredClone({state,secret});
  const project=(e:any):any=>{if(kind==='throws')throw Error('probe');if(kind==='mutates'){e.state.pieces=[];return null;}if(kind==='async')return Promise.resolve('not synchronous');return{fn:()=>0};};
  const r=captureMechanismEvents(()=>{emitAuthorityCheckpoint('formal_turn_settled',state,secret,{side:'red'});return'source-accepted';},{projectCheckpoint:project});
  assert.equal(r.result,'source-accepted');assert.equal(r.evidenceValid,false);assert.deepEqual(r.events,[]);assert.deepEqual({state,secret},before);
  const next=captureMechanismEvents(()=>emitAuthorityCheckpoint('formal_turn_settled',state,secret,{}));assert.equal(next.events.length,1);assert.equal(next.evidenceValid,undefined);assert.equal(next.events[0].checkpointProjection,undefined);
});

test('failed candidate discards checkpoint projection together with its state evidence',()=>{
  const {state,secret}=source();let calls=0;
  const c=captureMechanismEvents(()=>assert.throws(()=>withIsolatedMechanismEvents(()=>{
    emitAuthorityCheckpoint('main_action_atom_closed',state,secret,{});throw Error('candidate refused');
  }),/candidate refused/),{projectCheckpoint:()=>{calls++;return'computed-only';}});
  assert.equal(calls,1);assert.deepEqual(c.events,[]);
});

test('query suppression and an already-invalid capture invoke no further checkpoint projector',()=>{
  const {state,secret}=source();let calls=0;
  const c=captureMechanismEvents(()=>{
    withoutMechanismEvents(()=>emitAuthorityCheckpoint('main_action_atom_closed',state,secret,{}));assert.equal(calls,0);
    emitAuthorityCheckpoint('formal_turn_settled',state,secret,{});
    emitAuthorityCheckpoint('formal_turn_settled',state,secret,{});
  },{projectCheckpoint:()=>{calls++;throw Error('first projection failed');}});
  assert.equal(calls,1);assert.equal(c.evidenceValid,false);assert.deepEqual(c.events,[]);
});

test('checkpoint projection suppresses recursively emitted events and never becomes a wire/game-state property',()=>{
  const {state,secret}=source();let calls=0;
  const c=captureMechanismEvents(()=>emitAuthorityCheckpoint('main_action_atom_closed',state,secret,{}),{projectCheckpoint:()=>{
    calls++;emitAuthorityCheckpoint('formal_turn_settled',state,secret,{});return{safe:true};
  }});
  assert.equal(calls,1);assert.equal(c.events.length,1);assert(!('checkpointProjection'in state));assert(!('checkpointProjection'in secret));
});

test('context normalizer maps only exact issued IDs at declared fields; clocks, revisions, reveal/effect/text differences remain visible',()=>{
  const s=createOriginalHalfChaosSession(initial,replays,'MA-PD05-A'),r=s.step('MA-PD05-A:R1:main'),v=r.views.red;
  const a=normalizeDeclaredView(v,s.binding,s.replay);assert.equal(a.value.roomId,'<room>');
  for(const field of ['updatedAt','state.turnDeadlineAt','state.revision','messages.0.text','state.pieces.0.type']){
    const changed=structuredClone(v) as any,keys=field.split('.');let node=changed;for(const k of keys.slice(0,-1))node=node[k];node[keys.at(-1)!]='SECRET_DIFFERENCE_SENTINEL';
    const paths=differingPaths(a.value,normalizeDeclaredView(changed,s.binding,s.replay).value);assert(paths.some(p=>p.endsWith('/'+keys.at(-1))),field);
  }
  const text=structuredClone(v);text.messages![0].text=s.binding.roomId;
  assert.equal(normalizeDeclaredView(text,s.binding,s.replay).value.messages[0].text,s.binding.roomId);
  const forged=structuredClone(v);forged.roomId=s.binding.roomId+':unissued';assert.equal(normalizeDeclaredView(forged,s.binding,s.replay).value.roomId,forged.roomId);
});

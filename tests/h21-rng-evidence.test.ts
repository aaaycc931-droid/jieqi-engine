import assert from 'node:assert/strict';
import test from 'node:test';
import { initializeFeatureGameState } from '../src/game.ts';
import { ascendGalakrond } from '../src/hero-descent.ts';
import { captureMechanismEvents } from '../src/mechanism-observer.ts';
import { gameState,revealed,secretState } from './helpers.ts';

function pair(n:number){const state=initializeFeatureGameState(gameState(Array.from({length:n},(_,i)=>revealed(`p${i}`,'red','pawn',i%9,5+Math.floor(i/9)))),
  {red:'devout_zealot'},undefined,undefined,{red:'invincible'});state.heroRuntime!.red!.omen=true;return{state,secret:secretState()};}
for(const n of [0,1,3,4,15])test(`RNG01 N=${n} selection records actual ordered pools, bounds and IDs once`,()=>{
  const a=pair(n);let calls=0;
  const c=captureMechanismEvents(()=>ascendGalakrond(a.state,a.secret,'red',max=>{calls++;return max-1;}));
  const events=c.events.filter(e=>e.kind==='authority_random_draw');
  assert.equal(calls,Math.min(4,n));assert.equal(events.length,calls);
  assert.deepEqual(events.map(e=>e.details.maxExclusive),Array.from({length:calls},(_,i)=>n-i));
  assert.equal(new Set(events.map(e=>e.details.selectedId)).size,calls);
  for(const e of events)assert.equal((e.details.orderedCandidateIds as string[])[e.details.index as number],e.details.selectedId);
  const after=structuredClone(a);ascendGalakrond(a.state,a.secret,'red',()=>{throw Error('duplicate descent draw');});assert.deepEqual(a,after);
});
for(const invalid of [-1,99,0.5,NaN,Infinity])test(`RNG02 malformed index ${invalid} is rejected finitely before descent state mutation`,()=>{
  const a=pair(4),before=structuredClone(a);let calls=0;
  assert.throws(()=>ascendGalakrond(a.state,a.secret,'red',()=>{if(++calls>1)throw Error('unbounded old draw loop');return invalid;}),RangeError);
  assert.equal(calls,1);assert.deepEqual(a,before);
});
test('RNG03 observation enabled and disabled preserve the same selected identities and authority result',()=>{
  const a=pair(15),b=pair(15),tape=[1,1,1,4];let i=0,j=0;
  const c=captureMechanismEvents(()=>ascendGalakrond(a.state,a.secret,'red',()=>tape[i++]));
  ascendGalakrond(b.state,b.secret,'red',()=>tape[j++]);assert.deepEqual(a,b);assert.equal(i,j);
  assert.deepEqual(c.events.filter(e=>e.kind==='authority_random_draw').map(e=>e.details.selectedId),['p1','p2','p3','p7']);
});
test('RNG04 mixed public ground/air/river/covered pool follows current controller, not secret color',()=>{
  const a=pair(2);
  a.state.pieces.push({...revealed('air','red','horse',4,7),layer:'air'},revealed('enemy','black','pawn',1,4),
    {...revealed('river','red','rook',0,5),layer:'river',river:{source:'test',spaceId:'r',cellId:'c'}},
    {id:'covered-red',faceDown:true,x:6,y:6},{id:'covered-black',faceDown:true,x:6,y:3});
  a.secret.identities['covered-red']={color:'black',type:'horse'};
  a.secret.identities['covered-black']={color:'red',type:'horse'};
  const c=captureMechanismEvents(()=>ascendGalakrond(a.state,a.secret,'red',()=>0));
  assert.deepEqual(c.events.filter(e=>e.kind==='authority_random_draw')[0].details.orderedCandidateIds,['p0','p1','air','covered-red']);
  assert.equal(a.state.pieces.find(p=>p.id==='covered-red')!.faceDown,false);
  assert.equal(a.state.pieces.find(p=>p.id==='covered-black')!.faceDown,true);
});
test('RNG05 snapshot failure invalidates evidence while preserving actual descent result and draw count',()=>{
  const a=pair(4),b=pair(4);let calls=0;ascendGalakrond(b.state,b.secret,'red',()=>0);
  const clone=globalThis.structuredClone;let c:ReturnType<typeof captureMechanismEvents>;
  try{globalThis.structuredClone=()=>{throw Error('observer snapshot unavailable');};
    c=captureMechanismEvents(()=>ascendGalakrond(a.state,a.secret,'red',()=>{calls++;return 0;}));
  }finally{globalThis.structuredClone=clone;}
  assert.equal(c!.evidenceValid,false);assert.equal(c!.events.length,0);assert.equal(calls,4);assert.deepEqual(a,b);
});

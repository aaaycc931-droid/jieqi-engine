import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createStandardNp32Session, createStandardNp32WindowSession, type NpWindowVariant } from '../scripts/research/standard-np32.ts';
import { qualifyPublicPathAction } from '../src/public-path-qualification.ts';
import { captureMechanismEvents } from '../src/mechanism-observer.ts';
import { GAME_MODES } from '../src/modes.ts';

const base=new URL('./fixtures/standard-np32/',import.meta.url);
const [contract,rng,guards]=['NP_CONTRACT.json','RNG_CONTRACT.json','OBSERVATION_GUARD_MATRIX.json'].map(x=>readFileSync(new URL(x,base),'utf8'));
const variants=['R8_USE','R8_EXPIRE','R7_CARRIER_MOVE'] as const;
const create=(branch:'AP'|'ES',variant:NpWindowVariant,withoutObservation=false)=>createStandardNp32WindowSession(contract,rng,guards,branch,variant,{withoutObservation});
const stealth=(state:any)=>state.effectsByPieceId?.['covered-15']?.stealth;
const state=(r:any)=>r.after.game.state;
function advance(s:ReturnType<typeof create>,until?:string){
  const out=[];
  for(const d of s.declarations){const r=s.step(d.id);assert.equal(r.disposition,'accepted',JSON.stringify(r.error));assert.equal(r.duplicate,false);out.push(r);if(d.turn===until)break;}
  return out;
}
function noSource(g:any){assert.equal(stealth(g),undefined);assert.equal(g.assassination.red.activePieceId,undefined);assert.equal(g.assassination.red.heroChargeAvailable,false);}
function normalize(v:any,binding:any):any{
  if(typeof v==='string'){if(v===binding.players.red)return '<red-player>';if(v===binding.players.black)return '<black-player>';return v.replaceAll(binding.roomId,'<room>');}
  if(Array.isArray(v))return v.map(x=>normalize(x,binding));
  if(v&&typeof v==='object')return Object.fromEntries(Object.entries(v).map(([k,x])=>[normalize(k,binding),normalize(x,binding)]));return v;
}

for(const branch of ['AP','ES'] as const){
  test(`NG12 ${branch}: real 32 opening preserves unused opportunity through R7/B7 and uses it at R8`,()=>{
    const s=create(branch,'R8_USE'),rows=advance(s),by=(turn:string)=>rows.find(r=>r.declarationId.includes(':'+turn+':'))!;
    assert.equal(s.initial.game!.state.pieces.length,32);assert(s.initial.game!.state.pieces.every(p=>!p.faceDown));
    assert.deepEqual(s.initial.game!.secret.identities,{});
    const r6=by('R6'),r7=by('R7'),b7=by('B7'),r8=by('R8');
    assert.equal(stealth(state(r6)).remainingOwnerTurns,2);assert.equal(stealth(state(r6)).activatedOnFormalTurn,6);
    assert.equal(stealth(state(r7)).remainingOwnerTurns,1);assert.equal(stealth(state(b7)).remainingOwnerTurns,1);
    assert.equal(stealth(r8.before.game!.state).strongStrikeAvailable,true);assert.deepEqual(r8.before.game!.state.formalTurns,{red:7,black:7});
    assert.equal(r8.command.pieceId,'covered-15');assert.equal((r8.command as any).useStrongStrike,true);
    noSource(state(r8));assert.deepEqual(state(r8).formalTurns,{red:8,black:7});
    const g=r8.events.find(e=>e.kind==='main_action_atom_closed')!.state;
    const pawn=g.pieces.find(p=>p.id==='covered-10'),horse=g.pieces.find(p=>p.id==='covered-01'),rook=g.pieces.find(p=>p.id==='covered-15')!;
    if(branch==='AP'){
      assert(pawn);assert.equal(g.effectsByPieceId!['covered-10'].dragonScale,undefined);assert.equal(horse,undefined);assert.deepEqual([rook.x,rook.y],[0,2]);
      assert.equal(g.lastMove!.captured!.id,'covered-01');assert.deepEqual(g.lastMove!.pathCrushed,[]);
    }else{
      assert.equal(pawn,undefined);assert(horse);assert.equal(g.effectsByPieceId!['covered-01'].dragonScale,undefined);assert.deepEqual([rook.x,rook.y],[0,4]);
      assert.equal(g.lastMove!.bouncedAgainstPieceId,'covered-01');assert.equal(g.lastMove!.landed,false);assert.equal(g.lastMove!.pathCrushed![0].id,'covered-10');
    }
    assert.equal(s.draws().length,5);assert.equal(GAME_MODES.xiangqi.featuresReady,false);
  });

  test(`NG12 ${branch}: unused second window expires after R8 atom, at R8 formal settlement`,()=>{
    const s=create(branch,'R8_EXPIRE'),rows=advance(s),r8=rows.find(r=>r.declarationId.includes(':R8:'))!;
    const closed=r8.events.find(e=>e.kind==='main_action_atom_closed')!,settled=r8.events.find(e=>e.kind==='formal_turn_settled')!;
    assert.equal(stealth(closed.state).remainingOwnerTurns,1);assert.equal(closed.state.assassination!.red.activePieceId,'covered-15');
    assert.deepEqual(closed.state.formalTurns,{red:7,black:7});noSource(settled.state);assert.deepEqual(settled.state.formalTurns,{red:8,black:7});
    assert(r8.events.indexOf(closed)<r8.events.indexOf(settled));
    assert.equal(settled.state.turnDeadlineAt,r8.before.game!.state.turnDeadlineAt);
    noSource(s.snapshot().game!.state);assert.equal(s.snapshot().game!.state.turn,'red');assert.equal(s.draws().length,5);
  });

  test(`NG12 ${branch}: using the carrier for a non-assassination move at R7 ends both source and unused chance`,()=>{
    const s=create(branch,'R7_CARRIER_MOVE'),rows=advance(s),r7=rows.find(r=>r.declarationId.includes(':R7:'))!;
    assert.equal((r7.command as any).useStrongStrike,undefined);assert.equal((r7.command as any).source,undefined);
    noSource(r7.events.find(e=>e.kind==='main_action_atom_closed')!.state);noSource(state(r7));
    const rook=state(r7).pieces.find((p:any)=>p.id==='covered-15');assert.deepEqual([rook.x,rook.y],[0,5]);
  });

  test(`NG12 ${branch}: R8 empty/king/foreign carrier, stale and outsider rejections preserve opportunity, authority, RNG and clock`,()=>{
    const s=create(branch,'R8_USE');advance(s,'B7');const before=s.snapshot(),draws=s.draws();
    for(const suffix of ['empty-target','king-target','other-carrier']){
      const id=s.probes!.find(x=>x.id.endsWith(suffix))!.id,r=s.step(id);
      assert.equal(r.disposition,'rejected');if(suffix==='king-target')assert.equal(r.error!.code,'ILLEGAL_TARGET');
      if(suffix==='other-carrier')assert.equal(r.error!.code,'ASSASSINATION_ACTIVE');
      assert.deepEqual(r.events,[]);assert.deepEqual(s.snapshot(),before);assert.deepEqual(s.draws(),draws);
    }
    const id=s.declarations.find(d=>d.turn==='R8')!.id;
    for(const opt of [{expectedRevision:-1},{playerId:'outsider'},{playerId:s.binding.players.black}]){
      const r=s.step(id,opt);assert.equal(r.disposition,'rejected');assert.deepEqual(r.events,[]);assert.deepEqual(s.snapshot(),before);
    }
    assert.equal(s.step(id).disposition,'accepted');noSource(s.snapshot().game!.state);
  });

  test(`NG12 ${branch}: R7/B7/R8 retransmissions do not decrement windows, refresh deadline, redraw or repeat settlement`,()=>{
    const s=create(branch,'R8_USE');
    for(const d of s.declarations){
      const r=s.step(d.id);assert.equal(r.disposition,'accepted');
      if(!['R7','B7','R8'].includes(d.turn))continue;
      const before=s.snapshot(),draws=s.draws(),replay=s.step(d.id,{expectedRevision:-99,now:r.now+100});
      assert.equal(replay.disposition,'accepted');assert.equal(replay.duplicate,true);assert.deepEqual(replay.events,[]);
      assert.deepEqual(s.snapshot(),before);assert.deepEqual(s.draws(),draws);
    }
  });

  test(`NG12 ${branch}: R8 actual timeout grants no main action, clock reset or settlement`,()=>{
    const s=create(branch,'R8_USE');advance(s,'B7');const before=s.snapshot(),g=before.game!.state;
    const r=s.step(s.declarations.find(d=>d.turn==='R8')!.id,{now:g.turnDeadlineAt});
    assert.equal(r.after.phase,'finished');assert.equal(state(r).reason,'timeout');assert.deepEqual(state(r).formalTurns,g.formalTurns);
    assert.deepEqual(stealth(state(r)),stealth(g));assert.equal(state(r).turnDeadlineAt,g.turnDeadlineAt);assert.equal(s.draws().length,5);
    assert(!r.events.some(e=>['main_action_atom_closed','formal_turn_settled','formal_turn_begin','formal_clock_start'].includes(e.kind)));
  });

  test(`NG12 ${branch}: R8 public qualification is legal without consuming the real window`,()=>{
    const s=create(branch,'R8_USE');advance(s,'B7');const before=s.snapshot(),g=before.game!.state;
    const r=captureMechanismEvents(()=>qualifyPublicPathAction(g,{pieceId:'covered-15',from:{x:0,y:4},to:{x:0,y:2}},'red',{kind:'assassination',useStrongStrike:true}));
    assert.deepEqual(r.result,{status:'legal',basis:'closed_authority_projection'});assert.deepEqual(r.events,[]);assert.deepEqual(s.snapshot(),before);
  });

  for(const variant of variants){
    test(`NG12 ${branch}/${variant}: all mains have one atom, one settlement and one next clock; spent chance stays unavailable`,()=>{
      const s=create(branch,variant),rows=advance(s);
      for(const r of rows){
        const before=r.before.game!.state,after=state(r),actor=before.turn,other=actor==='red'?'black':'red';
        const atoms=r.events.filter(e=>e.kind==='main_action_atom_closed'),settled=r.events.filter(e=>e.kind==='formal_turn_settled');
        assert.equal(atoms.length,1);assert.equal(settled.length,1);assert.equal(r.evidenceValid,true);assert(r.now<before.turnDeadlineAt!);
        assert.deepEqual(atoms[0].state.formalTurns,before.formalTurns);assert.equal(after.formalTurns[actor],before.formalTurns![actor]+1);
        assert.equal(after.formalTurns[other],before.formalTurns![other]);assert.equal(r.events.filter(e=>e.kind==='formal_turn_begin').length,1);
        assert.equal(r.events.filter(e=>e.kind==='formal_clock_start').length,1);assert.equal(after.turnStartedAt,r.now);assert.equal(after.turnDeadlineAt,r.now+60000);
      }
      const before=s.snapshot(),p=s.probes!.find(x=>x.id.endsWith('spent-opportunity'))!,r=s.step(p.id);
      assert.equal(r.disposition,'rejected');assert.equal(r.error!.code,'MISSING_ASSASSINATION_SOURCE');assert.deepEqual(r.events,[]);assert.deepEqual(s.snapshot(),before);noSource(state(r));
    });
    test(`NG12 ${branch}/${variant}: observers preserve actual authority/views/RNG and player outputs exclude private receipts`,()=>{
      const a=create(branch,variant),b=create(branch,variant,true);
      for(const d of a.declarations){
        const x=a.step(d.id),y=b.step(d.id);assert.equal(x.disposition,'accepted');assert.equal(y.disposition,'accepted');assert.deepEqual(y.events,[]);
        assert.deepEqual(normalize(x.after,a.binding),normalize(y.after,b.binding));assert.deepEqual(normalize(x.views,a.binding),normalize(y.views,b.binding));assert.deepEqual(a.draws(),b.draws());
        const wire=JSON.stringify(x.views);for(const key of ['authority_random_draw','orderedCandidateIds','destinyIdentities','processedActions','"identities"'])assert(!wire.includes(key),key);
      }
    });
  }
}

test('NG12 declared variants preserve original declarations, reject foreign plans and never accept injected room/move/RNG',()=>{
  const original=createStandardNp32Session(contract,rng,guards,'AP'),s=create('AP','R8_USE');
  assert.deepEqual(s.declarations.slice(0,12),original.declarations.slice(0,12));assert.equal(original.declarations.length,13);
  assert.equal(original.declarations.at(-1).type,'H02_later_assassination_with_M04_path');
  assert.equal(s.binding.evidenceKind,'DECLARED_NATURAL_EXTENSION_NOT_ORIGINAL_AS_AP_ES_PREFIX');
  assert.throws(()=>createStandardNp32WindowSession(contract,rng,guards,'AS' as any,'R8_USE'),/variant\/branch/);
  assert.throws(()=>create('AP','UNDECLARED' as any),/variant\/branch/);
  assert.throws(()=>createStandardNp32WindowSession(contract+' ',rng,guards,'AP','R8_USE'),/immutable source/);
  const before=s.snapshot();s.declarations[0].from=[8,8];s.probes![0].to=[0,0];
  assert.throws(()=>s.step('injected-request'),/absent/);assert.deepEqual(s.snapshot(),before);
  const originalPawn=before.game!.state.pieces.find(p=>p.x===0&&p.y===6)!;
  assert.equal(s.step('NP-AP:R1:main').disposition,'accepted');assert.equal(s.snapshot().game!.state.lastMove!.pieceId,originalPawn.id);
});

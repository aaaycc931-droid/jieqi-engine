import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { createStandardNp32WindowSession, ORIGINAL_NP32_SOURCE } from './standard-np32.ts';
import { qualifyPublicPathAction } from '../../src/public-path-qualification.ts';
import { captureMechanismEvents } from '../../src/mechanism-observer.ts';

const digest=(v:any)=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
const chance=(g:any)=>({formalTurns:g.formalTurns,active:g.assassination.red.activePieceId??null,
  heroCharge:g.assassination.red.heroChargeAvailable,stealth:g.effectsByPieceId?.['covered-15']?.stealth??null});
function normalize(v:any,binding:any):any{
  if(typeof v==='string'){if(v===binding.players.red)return '<red-player>';if(v===binding.players.black)return '<black-player>';return v.replaceAll(binding.roomId,'<room>');}
  if(Array.isArray(v))return v.map(x=>normalize(x,binding));
  if(v&&typeof v==='object')return Object.fromEntries(Object.entries(v).map(([k,x])=>[normalize(k,binding),normalize(x,binding)]));return v;
}

/** Public summaries only: raw room/secret/events remain in memory. The six
 * extensions reuse original inputs through B6, then follow declared new moves. */
export function runStandardNp32Windows(contract:string,rng:string,guards:string){
  const sequences=[];
  for(const branch of ['AP','ES'] as const)for(const variant of ['R8_USE','R8_EXPIRE','R7_CARRIER_MOVE'] as const){
    const s=createStandardNp32WindowSession(contract,rng,guards,branch,variant),rows=[],probes=[],duplicates=[],queries=[];
    for(const d of s.declarations){
      if(d.turn==='R8'&&variant!=='R7_CARRIER_MOVE'){
        for(const p of s.probes!.filter(x=>!x.id.endsWith('spent-opportunity'))){
          const before=s.snapshot(),draws=s.draws(),r=s.step(p.id);assert.equal(r.disposition,'rejected');assert.deepEqual(r.events,[]);
          assert.deepEqual(s.snapshot(),before);assert.deepEqual(s.draws(),draws);probes.push({id:p.id,disposition:r.disposition,code:r.error!.code,authorityRngClockUnchanged:true});
        }
        if(variant==='R8_USE'){
          const before=s.snapshot(),g=before.game!.state;
          const q=captureMechanismEvents(()=>qualifyPublicPathAction(g,{pieceId:'covered-15',from:{x:0,y:4},to:{x:0,y:2}},'red',{kind:'assassination',useStrongStrike:true}));
          assert.deepEqual(q.result,{status:'legal',basis:'closed_authority_projection'});assert.deepEqual(q.events,[]);assert.deepEqual(s.snapshot(),before);
          queries.push({turn:'R8',qualification:q.result,externalEvents:0,realWindowUnchanged:true});
        }
      }
      const r=s.step(d.id);assert.equal(r.disposition,'accepted',JSON.stringify(r.error));assert.equal(r.duplicate,false);assert.equal(r.evidenceValid,true);
      const atom=r.events.filter(e=>e.kind==='main_action_atom_closed'),settled=r.events.filter(e=>e.kind==='formal_turn_settled');
      assert.equal(atom.length,1);assert.equal(settled.length,1);
      rows.push({id:d.id,turn:d.turn,inputKind:d.provenance??'RETAINED_ORIGINAL_REQUEST_THROUGH_B6',command:r.command,
        now:r.now,before:chance(r.before.game!.state),atom:chance(atom[0].state),settled:chance(settled[0].state),returned:chance(r.after.game!.state),
        atomCount:atom.length,settlementCount:settled.length,clockStartCount:r.events.filter(e=>e.kind==='formal_clock_start').length,
        returnedDeadline:r.after.game!.state.turnDeadlineAt,drawCount:r.drawCount,
        lastMove:atom[0].state.lastMove,deathRecords:(atom[0].state.automaticEvents??[]).filter(x=>x.deathRecord).map(x=>({pieceId:x.pieceId,cause:x.deathRecord!.cause})),
        normalizedAuthoritySha256:digest(normalize(r.after,s.binding)),normalizedEventsSha256:digest(normalize(r.events,s.binding)),normalizedPlayerViewsSha256:digest(normalize(r.views,s.binding))});
      if(['R7','B7','R8'].includes(d.turn)){
        const before=s.snapshot(),draws=s.draws(),dup=s.step(d.id,{expectedRevision:-99,now:r.now+1});
        assert.equal(dup.disposition,'accepted');assert.equal(dup.duplicate,true);assert.deepEqual(dup.events,[]);assert.deepEqual(s.snapshot(),before);assert.deepEqual(s.draws(),draws);
        duplicates.push({id:d.id,duplicate:true,authorityRngClockUnchanged:true,events:0});
      }
    }
    const before=s.snapshot(),p=s.probes!.find(x=>x.id.endsWith('spent-opportunity'))!,r=s.step(p.id);
    assert.equal(r.disposition,'rejected');assert.equal(r.error!.code,'MISSING_ASSASSINATION_SOURCE');assert.deepEqual(r.events,[]);assert.deepEqual(s.snapshot(),before);
    probes.push({id:p.id,disposition:r.disposition,code:r.error!.code,authorityRngClockUnchanged:true});
    sequences.push({branch,variant,evidenceKind:s.binding.evidenceKind,originalRequestsRetained:12,initialPieceCount:s.initial.game!.state.pieces.length,
      mainRequests:rows.length,duplicateRequests:duplicates.length,rejectedProbes:probes.length,queries,rows,duplicates,probes,draws:s.draws()});
  }
  return {schema:'lezi.standard_np32.window_research.v1',id:'MAIN-STD-R8-NATURAL-WINDOW-20261028',executedLocalDate:'2026-10-29',
    engineParent:'1bda5bc9f7840d0d601a85fb0faeda842753a199',originalInputs:ORIGINAL_NP32_SOURCE,
    status:'SIX_DECLARED_FULL32_CONDITIONAL_TAPE_EXTENSIONS_EXECUTED',
    totals:{sequences:sequences.length,acceptedMainRequests:sequences.reduce((n,s)=>n+s.mainRequests,0),
      duplicateRequests:sequences.reduce((n,s)=>n+s.duplicateRequests,0),rejectedProbes:sequences.reduce((n,s)=>n+s.rejectedProbes,0),
      mainAtoms:sequences.reduce((n,s)=>n+s.rows.reduce((a,r)=>a+r.atomCount,0),0),formalSettlements:sequences.reduce((n,s)=>n+s.rows.reduce((a,r)=>a+r.settlementCount,0),0)},
    sequences,scope:{newGameSourceChanges:0,newGameplayApprovals:0,originalAsApEsPrefixesReplaced:false,productionRandomSampling:false,
      formalOrdinaryQualification:false,independentQA:false,featuresReady:false,UIOrTerminalConsumerMigration:false,scoring:'frozen',NET:'paused'},
    rawAuthoritySecretEventBodiesPublished:false};
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  const root=new URL('../../tests/fixtures/standard-np32/',import.meta.url),texts=['NP_CONTRACT.json','RNG_CONTRACT.json','OBSERVATION_GUARD_MATRIX.json'].map(x=>readFileSync(new URL(x,root),'utf8'));
  const r=runStandardNp32Windows(texts[0],texts[1],texts[2]),output=process.argv.find(x=>x.startsWith('--output='))?.slice(9);
  if(output)writeFileSync(output,JSON.stringify(r)+'\n');console.log(JSON.stringify({status:r.status,totals:r.totals}));
}

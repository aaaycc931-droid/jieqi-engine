import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { issueOriginalStandardNpTuple, withExactStandardNpTuple, registerExactResearchRoom } from '../../src/research-source-context.ts';
import { createRemoteRoom, joinRemoteRoom, submitRemoteHeroSelection, submitRemoteRps, completeRemoteHeroIntro,
  advanceRemoteRoomTime, submitRemoteMove, submitRemoteAssassination, submitRemoteHeroAbility, publicRemoteRoom, playerRoomView, type RemoteRoom } from '../../src/remote-room.ts';
import { captureMechanismEvents, withIsolatedMechanismEvents } from '../../src/mechanism-observer.ts';
import { validateHeroForms } from '../../src/hero-forms.ts';
import { isGeneralInCheck } from '../../src/rules.ts';
import type { AssassinationCommand, GameState, HeroAbilityCommand, MoveCommand, RandomInt, Side } from '../../src/types.ts';

export type NpBranch = 'AS' | 'AP' | 'ES';
export const ORIGINAL_NP32_SOURCE = Object.freeze({
  handoffCommit:'f631bad61b11f06070f5631a8a0ded7ea660bab1', engineParent:'570fdf189867ec93355f0eca66362deb72cca53c',
  contractSha256:'be1a9aff0b0f9e3f088afd0ee99c19a140f4690208cedf93f3fe39c3c61c945f',
  rngSha256:'99c58b51bc473cb58793b2ea7f3e5481e27a24608522d9d1da71a579a4ad0e55',
  guardsSha256:'91fb32892405ca7ecbe74d2666707dc50060302fb2f3947e2f1fb41f4bb34ae5',
});
const hash=(s:string)=>createHash('sha256').update(s).digest('hex');
const fail=(s:string):never=>{throw new Error('StandardNp32CoverageError: '+s);};
let serial=0;

/** Owns real room instances, real pre-RPS package locks and the original tape.
 * Accepts neither room/state JSON nor player-selected RNG callbacks. */
export function createStandardNp32Session(contractText:string,rngText:string,guardsText:string,branch:NpBranch,
  probe: {failDescent?:boolean;withoutObservation?:boolean} = {}) {
  if(hash(contractText)!==ORIGINAL_NP32_SOURCE.contractSha256 || hash(rngText)!==ORIGINAL_NP32_SOURCE.rngSha256 ||
    hash(guardsText)!==ORIGINAL_NP32_SOURCE.guardsSha256 || !['AS','AP','ES'].includes(branch)) fail('immutable source/branch mismatch');
  const contract=JSON.parse(contractText), rngContract=JSON.parse(rngText), guardMatrix=JSON.parse(guardsText);
  const branchGuard=guardMatrix.branch_cases.find((x:any)=>x.case_id===branch);
  const roomId=`std-np32:${branch}:${++serial}`, players={red:roomId+':host',black:roomId+':guest'};
  const capability=issueOriginalStandardNpTuple({roomId,tupleId:'STD-NP32-AS-AP-ES',branch,players},contractText,rngText);
  const tape=[{maxExclusive:8,index:3,stage:'mutation'},...rngContract.board_id_adapter.selection_tapes[branch==='AP'?'path_scale':'endpoint_scale'].map((x:any)=>({...x,stage:'B5-descent'}))];
  const draws:Array<{maxExclusive:number;index:number;stage:string}>=[];
  let cursor=0, room:RemoteRoom;
  const owned=new WeakSet<object>();
  const random:RandomInt=bound=>{
    const d=tape[cursor++];
    if(!d || d.maxExclusive!==bound || !Number.isInteger(d.index) || d.index<0 || d.index>=bound) return fail('RNG bound/tape mismatch');
    if(probe.failDescent && d.stage==='B5-descent') throw new RangeError('NP32 negative probe rejects descent RNG');
    draws.push({maxExclusive:bound,index:d.index,stage:d.stage}); return d.index;
  };
  const validate=(r:RemoteRoom)=>{
    if(r.roomId!==roomId || r.seats.host.playerId!==players.red || r.seats.guest && r.seats.guest.playerId!==players.black ||
      r.mode.baseMode!=='xiangqi' || !r.mode.heroesEnabled || !r.mode.mutationsEnabled) fail('room/seat/mode mismatch');
    if(r.game){
      const choices=validateHeroForms(r.game.state,r.game.secret);
      if(r.game.players.red!==players.red || r.game.players.black!==players.black || r.rps?.status!=='resolved' ||
        r.rps.assignments?.red!==players.red || r.rps.assignments?.black!==players.black || r.game.state.gameMode!=='xiangqi' ||
        r.game.state.featureRules?.mutation!=='war_chariot' || r.features?.mutation!=='war_chariot' ||
        choices.red?.packageId!=='rogue:front:v1' || choices.black?.packageId!=='devout_zealot:front:v1:invincible') fail('real RPS/tuple/package mismatch');
    }
  };
  const invoke=(operation:()=>RemoteRoom)=>{
    if(room && !owned.has(room)) fail('unissued authority instance');
    if(room) validate(room);
    const next=withExactStandardNpTuple(capability,()=>{
      const next=operation();validate(next);registerExactResearchRoom(next);return next;
    });owned.add(next);room=next;
  };
  invoke(()=>createRemoteRoom(roomId,players.red,'internal-original-np32',1000,{baseMode:'xiangqi',heroesEnabled:true,mutationsEnabled:true}));
  invoke(()=>joinRemoteRoom(room,players.black,'internal-original-np32',1100).room);
  invoke(()=>submitRemoteHeroSelection(room,players.red,'rogue',random,1200));
  invoke(()=>submitRemoteHeroSelection(room,players.black,'devout_zealot',random,1300,{variant:'invincible'}));
  invoke(()=>submitRemoteRps(room,players.red,'rock',1,random,1400));
  invoke(()=>submitRemoteRps(room,players.black,'scissors',1,random,1500));
  if(draws.length!==1 || room!.game!.state.pieces.length!==32 || room!.game!.state.pieces.some(p=>p.faceDown) || Object.keys(room!.game!.secret.identities).length) fail('ordinary public 32 opening mismatch');
  invoke(()=>completeRemoteHeroIntro(room,players.red,1600));
  invoke(()=>completeRemoteHeroIntro(room,players.black,1700));
  invoke(()=>advanceRemoteRoomTime(room,random,10000));
  if(room!.phase!=='playing' || room!.game!.state.turn!=='red') fail('natural preparation/start incomplete');
  const initial=structuredClone(room!);
  const declarations=[...contract.full_prefix.filter((x:any)=>x.type!=='H21_invincible_descent'),...contract.branches[branch].actions].map((x:any)=>{
    const turn=(x.formal_turn as string).replace('.action','');
    return {id:`NP-${branch}:${turn}:main`,turn,actor:turn.startsWith('R')?'red':'black',...x};
  });
  const index=new Map(declarations.map((x:any)=>[x.id,x]));
  const acceptedCommands=new Map<string,MoveCommand|HeroAbilityCommand|AssassinationCommand>();let requestCount=0;
  const views=()=>({public:publicRemoteRoom(room!),red:playerRoomView(room!,players.red),black:playerRoomView(room!,players.black)});
  return {
    binding:Object.freeze({...ORIGINAL_NP32_SOURCE,branch,tupleId:'STD-NP32-AS-AP-ES',roomId,players:Object.freeze({...players})}),
    initial, declarations:structuredClone(declarations), branchGuard:structuredClone(branchGuard),
    snapshot:()=>structuredClone(room!), draws:()=>structuredClone(draws), views,
    step(id:string,options:{playerId?:string;expectedRevision?:number;now?:number}={}){
      const d=index.get(id) as any;if(!d)fail('request absent from original NP32 source');
      const before=structuredClone(room!), current=room!, actor=d.actor as Side;
      const now=options.now??11000+requestCount++*1000, playerId=options.playerId??players[actor];
      const common={actionId:roomId+':'+id,expectedRevision:options.expectedRevision??current.game!.state.revision};
      let command:MoveCommand|HeroAbilityCommand|AssassinationCommand, kind:'move'|'invoke'|'assassination';
      const prior=acceptedCommands.get(id);
      if(prior){kind=d.type==='H21_prayer'?'invoke':d.type==='normal_move'?'move':'assassination';command=structuredClone(prior);if(options.expectedRevision!==undefined)command.expectedRevision=options.expectedRevision;}
      else if(d.type==='H21_prayer') {kind='invoke';command={...common,kind:'hero_ability',ability:'invoke'};}
      else {
        const from=d.from??d.source_rook,to=d.to??d.target;
        const piece=current.game!.state.pieces.find(p=>p.x===from[0]&&p.y===from[1]);
        if(!piece)fail('original request source no longer present');
        const move={...common,pieceId:piece.id,from:{x:from[0],y:from[1]},to:{x:to[0],y:to[1]}};
        if(d.type==='normal_move'){kind='move';command=move;}
        else {kind='assassination';command={...move,kind:'assassination',...(d.type==='H02_later_assassination_with_M04_path'?{useStrongStrike:true}:{source:'hero' as const})};}
      }
      try {
        let duplicate=false;
        const operation=()=>invoke(()=>{
          const result=kind==='invoke'?submitRemoteHeroAbility(current,playerId,command as HeroAbilityCommand,now,random)
            :kind==='assassination'?submitRemoteAssassination(current,playerId,command as AssassinationCommand,now,random)
            :submitRemoteMove(current,playerId,command as MoveCommand,now,random);
          duplicate=result.duplicate;return result.room;
        });
        const captured=probe.withoutObservation?{result:operation(),events:[],evidenceValid:true}:captureMechanismEvents(()=>withIsolatedMechanismEvents(operation));
        if(!duplicate)acceptedCommands.set(id,structuredClone(command));
        return {declarationId:id,kind,playerId,command,now,disposition:'accepted' as const,duplicate,before,after:structuredClone(room!),events:captured.events,evidenceValid:captured.evidenceValid!==false,views:views(),drawCount:draws.length};
      } catch(error){
        if(JSON.stringify(room!)!==JSON.stringify(before))fail('refusal mutated original authority');
        return {declarationId:id,kind,playerId,command,now,disposition:'rejected' as const,error:{name:(error as Error).name,code:(error as any).code,message:(error as Error).message},before,after:structuredClone(room!),events:[],evidenceValid:true,views:views(),drawCount:draws.length};
      }
    },
  };
}

/** Reconcile measured closed state with the original branch oracle. */
export function np32OutcomeIssues(session:ReturnType<typeof createStandardNp32Session>,results:any[]):string[]{
  const issues:string[]=[];
  const last=results.at(-1);if(!last || last.disposition!=='accepted')return ['original prefix did not complete'];
  const closed=last.events.find((e:any)=>e.kind==='main_action_atom_closed');if(!closed)return ['final closed main atom missing'];
  const state=closed.state as GameState, oracle=session.branchGuard.oracle;
  const actual=[['path_pawn','covered-10'],['horse','covered-01'],['red_rook','covered-15']] as const;
  for(const [name,id] of actual){
    const expected=oracle[name],p=state.pieces.find(p=>p.id===id),e=state.effectsByPieceId?.[id];
    if(Boolean(p)!==expected.alive || p && JSON.stringify([p.x,p.y])!==JSON.stringify(expected.at))issues.push(name+':alive/position');
    if(expected.dragonScale!==undefined && (e?.dragonScale??0)!==expected.dragonScale)issues.push(name+':dragon scale');
    if(expected.stealth!==undefined && Boolean(e?.stealth)!==expected.stealth)issues.push(name+':stealth');
    if(expected.destroyed_cause){
      const deaths=state.automaticEvents?.filter(x=>x.pieceId===id&&x.deathRecord?.cause===expected.destroyed_cause)??[];
      if(deaths.length!==1)issues.push(name+':actual destruction record');
    }
    if(expected.noDeathEvent && state.automaticEvents?.some(x=>x.pieceId===id&&x.deathRecord))issues.push(name+':unexpected death');
  }
  if(state.assassination?.red.heroChargeAvailable!==oracle.heroChargeAvailable || (state.assassination?.red.activePieceId??null)!==oracle.activePieceId)issues.push('H02 charge/active source');
  if(state.lastMove?.landed!==oracle.lastMove.landed || (state.lastMove?.bouncedAgainstPieceId??null)!==(oracle.lastMove.bouncedAgainstPieceId??null))issues.push('endpoint landing/rebound');
  const expectedPath=oracle.lastMove.pathCrushed_contains, paths=state.lastMove?.pathCrushed??[];
  if(expectedPath?paths.length!==1||paths[0].id!==expectedPath:paths.length!==0)issues.push('path actual deaths');
  if(oracle.lastMove.captured_id && state.lastMove?.captured?.id!==oracle.lastMove.captured_id)issues.push('endpoint actual death');
  if(isGeneralInCheck(state,'red') || isGeneralInCheck(state,'black') || !state.pieces.some(p=>p.id==='red-general') || !state.pieces.some(p=>p.id==='black-general'))issues.push('bounded final king oracle');
  return issues;
}

export function runStandardNp32(contractText:string,rngText:string,guardsText:string,branch:NpBranch){
  const session=createStandardNp32Session(contractText,rngText,guardsText,branch);const results=[];
  for(const d of session.declarations){
    const result=session.step(d.id);results.push(result);
    if(result.disposition!=='accepted'||result.duplicate||!result.evidenceValid||result.after.phase!=='playing')break;
  }
  const completed=results.length===session.declarations.length&&results.every(x=>x.disposition==='accepted'&&!x.duplicate&&x.evidenceValid);
  const issues=completed?np32OutcomeIssues(session,results):['original request prefix blocked'];
  return {schema:'lezi.standard_np32.actual_research.v1',binding:session.binding,initial:session.initial,draws:session.draws(),
    status:completed&&!issues.length?'ORIGINAL_NP32_CONDITIONAL_TAPE_PREFIX_EXECUTED':'BLOCKED_AT_ACTUAL_PREFIX',
    plannedRequests:session.declarations.length,actualRequests:results.length,results,oracleIssues:issues,
    sourceConditionalTape:true,productionRandomSampling:false,formalOrdinaryQualification:false,independentQA:false,featuresReady:false,score:'frozen',NET:'paused'};
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  const base=new URL('../../tests/fixtures/standard-np32/',import.meta.url);
  const texts=['NP_CONTRACT.json','RNG_CONTRACT.json','OBSERVATION_GUARD_MATRIX.json'].map(x=>readFileSync(new URL(x,base),'utf8'));
  const results=(['AS','AP','ES'] as const).map(b=>runStandardNp32(texts[0],texts[1],texts[2],b));
  const output=process.argv.find(x=>x.startsWith('--output='))?.slice(9);if(output)writeFileSync(output,JSON.stringify(results,null,2)+'\n');
  console.log(JSON.stringify(results.map(r=>({branch:r.binding.branch,status:r.status,requests:r.actualRequests,planned:r.plannedRequests,oracleIssues:r.oracleIssues,failures:r.results.filter(x=>x.disposition==='rejected').map(x=>({id:x.declarationId,error:x.error}))})),null,2));
}

import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { HALF_CHAOS_RESEARCH_TUPLES, issueOriginalHalfChaosTuple, registerExactResearchRoom, withExactHalfChaosTuple, type HalfChaosResearchTupleId } from '../../src/research-source-context.ts';
import { createRemoteRoom, joinRemoteRoom, submitRemoteHeroSelection, submitRemoteRps, completeRemoteHeroIntro,
  advanceRemoteRoomTime, submitRemoteMove, submitRemoteHeroAbility, playerRoomView, publicRemoteRoom, serializePublicRemoteRoom, type RemoteRoom } from '../../src/remote-room.ts';
import { captureMechanismEvents, withIsolatedMechanismEvents } from '../../src/mechanism-observer.ts';
import { validateHeroForms } from '../../src/hero-forms.ts';
import type { HeroAbilityCommand, MoveCommand, Side } from '../../src/types.ts';

export const ORIGINAL_HC_SOURCE = Object.freeze({
  handoffCommit: 'd1c946452532e58fbf23342ef200f2bee5ce5270',
  engineParent: 'b28535780a7c7427c0d715b46b0362d35a696d8f',
  initializationSha256: 'ba8f0a40e19230176df732e267d14b6070778d74886f4c007ea0ff1be4084836',
  replaySha256: '1e213fe2c6db48ab54d15a599023f57ab50f1ecda50e30601ae555fbf88fda68',
});
const hash = (s: string) => createHash('sha256').update(s).digest('hex');
const fail = (s: string): never => { throw new Error(`OriginalHalfChaosCoverageError: ${s}`); };
const replayTuples: Record<string, HalfChaosResearchTupleId> = {
  'MA-PD01':'HC-ADM-PD-M04','MA-PD04':'HC-ADM-PD-M04','MA-PD05-A':'HC-ADM-PD-M04','MA-PD05-B':'HC-ADM-PD-M04',
  'MA-PD02':'HC-ADM-PD-M01','MA-PD03':'HC-ADM-PD-M01','MA-PD06-A':'HC-ADM-PD-M01','MA-PD06-B':'HC-ADM-PD-M01',
  'MA-DS01-02':'HC-ADM-DS-D01','MA-DS03':'HC-ADM-DS-D01','MA-DS04':'HC-ADM-DS-D01','MA-DS05':'HC-ADM-DS-D01',
};
let nextRoom = 0;

/** Internal harness: owns real authority instances; accepts no room JSON or RNG callback. */
export function createOriginalHalfChaosSession(initializationText: string, replayText: string, replayId: string,
  probe: {stageProjections?:boolean;withoutObservation?:boolean} = {}) {
  if (hash(initializationText) !== ORIGINAL_HC_SOURCE.initializationSha256 || hash(replayText) !== ORIGINAL_HC_SOURCE.replaySha256)
    fail('immutable input hash mismatch');
  const tupleId = replayTuples[replayId]; if (!tupleId) fail('replay not in original twelve');
  const initialization = JSON.parse(initializationText), data = JSON.parse(replayText);
  const replay = data.replays.find((r: any) => r.replay_id === replayId), tuple = HALF_CHAOS_RESEARCH_TUPLES[tupleId];
  const world = initialization.worlds.find((w: any) => w.id === replay?.world_id);
  if (!world || !replay || replay.mutation !== ({iron_steed:'M01',war_chariot:'M04',end_time:'D01'})[tuple.mutation]) fail('tuple/world mismatch');
  const roomId = `hc-original:${replayId}:${++nextRoom}`, players = { red: `${roomId}:host`, black: `${roomId}:guest` };
  const context = issueOriginalHalfChaosTuple({ roomId, tupleId, players },initializationText,replayText,replayId);
  const issuedRooms = new WeakSet<object>(); let room: RemoteRoom;
  const drawTape = [...world.fisher_yates_draw_witness.map((d: any) => ({ bound:d.bound,value:d.value })),
    ...(tuple.mutation === 'iron_steed' ? [{bound:8,value:0}] : tuple.mutation === 'war_chariot' ? [{bound:8,value:3}] : [{bound:8,value:3},{bound:3,value:2}])];
  const draws: Array<{bound:number;value:number}> = []; let cursor = 0;
  const random = (bound: number) => {
    const d = drawTape[cursor++];
    if (!d || d.bound !== bound || !Number.isInteger(d.value) || d.value < 0 || d.value >= bound) fail('RNG tape mismatch/extra draw');
    draws.push({bound,value:d.value}); return d.value;
  };
  const validate = (r: RemoteRoom) => {
    if (r.roomId !== roomId || r.seats.host.playerId !== players.red || r.seats.guest && r.seats.guest.playerId !== players.black ||
        r.mode.baseMode !== 'half_chaos' || !r.mode.heroesEnabled || !r.mode.mutationsEnabled) fail('room/seat/mode provenance mismatch');
    if (r.game) {
      if (r.game.players.red !== players.red || r.game.players.black !== players.black || r.rps?.status !== 'resolved' ||
          r.rps.assignments?.red !== players.red || r.rps.assignments?.black !== players.black ||
          r.game.state.gameMode !== 'half_chaos' || r.game.state.featureRules?.mutation !== tuple.mutation ||
          r.features?.mutation !== tuple.mutation || r.features?.heroes?.red !== tuple.red || r.features?.heroes?.black !== tuple.black)
        fail('real RPS/side/tuple mismatch');
      const choices = validateHeroForms(r.game.state,r.game.secret);
      for (const side of ['red','black'] as const) if (choices[side]?.heroId !== tuple[side] || choices[side]?.form !== 'front' ||
        choices[side]?.variant !== undefined || choices[side]?.packageId !== `${tuple[side]}:front:v1`) fail('complete package mismatch');
    }
  };
  const invoke = (operation: () => RemoteRoom) => {
    if (room && !issuedRooms.has(room)) fail('unissued authority instance');
    if (room) validate(room);
    const next = withExactHalfChaosTuple(context,()=>{const next=operation();validate(next);registerExactResearchRoom(next);return next;}); issuedRooms.add(next); room = next;
  };
  invoke(()=>createRemoteRoom(roomId,players.red,'internal-original-witness',1000,{baseMode:'half_chaos',heroesEnabled:true,mutationsEnabled:true}));
  invoke(()=>joinRemoteRoom(room,players.black,'internal-original-witness',1100).room);
  invoke(()=>submitRemoteHeroSelection(room,players.red,tuple.red,random,1200));
  invoke(()=>submitRemoteHeroSelection(room,players.black,tuple.black,random,1300));
  invoke(()=>submitRemoteRps(room,players.red,'rock',1,random,1400));
  invoke(()=>submitRemoteRps(room,players.black,'scissors',1,random,1500));
  if (cursor !== drawTape.length || room!.game!.state.pieces.length !== 32) fail('initial draw/piece count mismatch');
  for (const [id,type] of Object.entries(world.true_type_by_stable_piece_id)) {
    const identity = room!.game!.secret.identities[id];
    if (identity?.type !== type || identity?.color !== world.all_initial_pieces_original_side[id]) fail('actual initial identity mismatch');
  }
  invoke(()=>completeRemoteHeroIntro(room,players.red,1600));
  invoke(()=>completeRemoteHeroIntro(room,players.black,1700));
  invoke(()=>advanceRemoteRoomTime(room,random,10000));
  if (room!.phase !== 'playing' || room!.game!.state.turn !== 'red') fail('natural preparation/start did not complete');
  const initial = structuredClone(room!);
  const requests = new Map<string, any>();
  for (const turn of replay.source_prescribed_turns) {
    for (const pre of turn.pre_main_requests) requests.set(pre.declaration_id,{turn,pre});
    requests.set(turn.normal_main.declaration_id,{turn,main:turn.normal_main});
  }
  let requestCount = 0;
  const views = () => ({public:publicRemoteRoom(room!),red:playerRoomView(room!,players.red),black:playerRoomView(room!,players.black)});
  return {
    binding: Object.freeze({ ...ORIGINAL_HC_SOURCE,tupleId,replayId,worldId:world.id,roomId,players:Object.freeze({...players}) }),
    replay: structuredClone(replay), initial,
    draws: structuredClone(draws),
    snapshot: () => structuredClone(room!),
    views,
    step(declarationId: string, options: {playerId?:string;expectedRevision?:number;now?:number} = {}) {
      const entry = requests.get(declarationId); if (!entry) fail('request absent from original source');
      const current = room!, before = structuredClone(current), side = entry.turn.actor as Side;
      const playerId = options.playerId ?? players[side], now = options.now ?? 11000 + requestCount++ * 1000;
      const common = {actionId:`${roomId}:${declarationId}`,expectedRevision:options.expectedRevision ?? current.game!.state.revision};
      let command: MoveCommand | HeroAbilityCommand;
      if (entry.main) {
        const r = entry.main.semantic_request; command = {...common,from:{x:r.semantic_from[0],y:r.semantic_from[1]},to:{x:r.semantic_to[0],y:r.semantic_to[1]}};
      } else if (entry.pre.semantic_request_kind === 'hourglass') command = {...common,kind:'hero_ability',ability:'hourglass'};
      else if (entry.pre.semantic_request_kind === 'dragon_bomb') {
        const p = entry.pre.semantic_caster_position;
        const caster = current.game!.state.pieces.find(pce=>pce.x===p[0]&&pce.y===p[1]&&!pce.faceDown);
        if (!caster) fail('bomb caster is not actually publicly revealed at source coordinate');
        const t = entry.pre.semantic_target_position;
        command = {...common,kind:'hero_ability',ability:'bomb',pieceId:caster.id,to:{x:t[0],y:t[1]}};
      } else return fail('unknown source ability');
      try {
        let duplicate = false;
        let operationReturned = false;
        const operation = ()=>{const result=withIsolatedMechanismEvents(()=>invoke(()=>{
          const r = 'ability' in command ? submitRemoteHeroAbility(current,playerId,command,now,random) : submitRemoteMove(current,playerId,command,now);
          duplicate = r.duplicate; return r.room;
        }));operationReturned=true;return result;};
        const captured = probe.withoutObservation ? {result:operation(),events:[],evidenceValid:true} : captureMechanismEvents(operation,
          probe.stageProjections ? { projectCheckpoint: checkpoint=>{
            if(operationReturned || !checkpoint.secret)fail('checkpoint is not a synchronous authority snapshot');
            // The game snapshot is exact. Outer room history/timestamps are the
            // actual request-entry envelope, NOT a newly committed room packet.
            const envelope:RemoteRoom={...before,game:{...before.game!,state:checkpoint.state,secret:checkpoint.secret}};
            return {schema:'lezi.original_hc.exact_game_stage_projection.v1',replayId,checkpointKind:checkpoint.kind,
              emittedBeforeRequestReturn:true,envelopeBasis:'ACTUAL_REQUEST_ENTRY_METADATA_NOT_COMMITTED_ROOM_DELIVERY',
              envelopeUpdatedAt:before.updatedAt,actualClientDelivery:false,
              publicJson:serializePublicRemoteRoom(envelope),
              redJson:JSON.stringify(playerRoomView(envelope,players.red)),blackJson:JSON.stringify(playerRoomView(envelope,players.black))};
          }} : {});
        return {declarationId,playerId,now,command,disposition:'accepted' as const,duplicate,before,after:structuredClone(room!),events:captured.events,evidenceValid:captured.evidenceValid!==false,views:views()};
      } catch(error) {
        if (JSON.stringify(room!)!==JSON.stringify(before)) fail('refusal mutated original authority');
        return {declarationId,playerId,now,command,disposition:'rejected' as const,error:{name:(error as Error).name,code:(error as any).code,message:(error as Error).message},before,after:structuredClone(room!),events:[],evidenceValid:true,views:views()};
      }
    },
  };
}

function requestOutcomeIssues(result: ReturnType<ReturnType<typeof createOriginalHalfChaosSession>['step']>, request: any): string[] {
  const issues: string[] = [], main = request.expected_result;
  if (!main) {
    if (result.disposition === 'rejected' && JSON.stringify(result.before) !== JSON.stringify(result.after)) issues.push('rejection mutated authority');
    if (result.disposition === 'accepted' && (result.before.game!.state.turn !== result.after.game!.state.turn ||
      result.before.game!.state.turnDeadlineAt !== result.after.game!.state.turnDeadlineAt ||
      JSON.stringify(result.before.game!.state.formalTurns) !== JSON.stringify(result.after.game!.state.formalTurns))) issues.push('before-main consumed turn or refreshed deadline');
    return issues;
  }
  if (result.disposition !== 'accepted') return ['main rejected'];
  const closed = result.events.filter(e=>e.kind==='main_action_atom_closed'), settled = result.events.filter(e=>e.kind==='formal_turn_settled');
  if (closed.length!==1 || settled.length!==1) return ['missing/duplicate actual closure checkpoint'];
  const state = closed[0].state, action = state.lastMove!, source = state.pieces.find(p=>p.id===action.pieceId);
  const position = main.source_position_after_full_atom;
  if (!source || source.x!==position[0] || source.y!==position[1] || source.faceDown!==main.source_face_down_after_full_atom) issues.push('source position/reveal mismatch');
  if (Boolean(action.bouncedAgainstPieceId)!==main.ordinary_defense_rebound) issues.push('endpoint rebound mismatch');
  if ((action.captured?.id??null)!==(main.endpoint_death?.initial_piece_id??null)) issues.push('endpoint death mismatch');
  if (JSON.stringify((action.pathCrushed??[]).map(p=>p.id).sort())!==JSON.stringify(main.path_deaths.map((p:any)=>p.initial_piece_id).sort())) issues.push('path death mismatch');
  const side = action.actingSide;
  if ((result.after.game!.state.formalTurns?.[side]??0)!==(result.before.game!.state.formalTurns?.[side]??0)+1) issues.push('main formal cost mismatch');
  return issues;
}

export function runOriginalHalfChaos(initializationText: string, replayText: string, replayId: string) {
  const session = createOriginalHalfChaosSession(initializationText,replayText,replayId);
  const results: Array<ReturnType<typeof session.step> & {outcomeIssues:string[]}> = []; let blocked: string | undefined;
  for (const turn of session.replay.source_prescribed_turns) {
    const entries = [...turn.pre_main_requests,turn.normal_main];
    for (const request of entries) {
      const result = {...session.step(request.declaration_id),outcomeIssues:[] as string[]};
      result.outcomeIssues = requestOutcomeIssues(result,request); results.push(result);
      const expected = request.expected_disposition ?? 'accepted';
      if (result.disposition !== expected || result.outcomeIssues.length || !result.evidenceValid || result.disposition==='accepted' && result.duplicate || result.after.phase!=='playing') {
        blocked = request.declaration_id; break;
      }
    }
    if (blocked) break;
  }
  const final = session.snapshot(), expectedLedger = session.replay.authority_only_expected_terminal_ledger;
  const ledgerMatched = !blocked && JSON.stringify(final.game!.state.pieces.map(p=>p.id).sort()) === JSON.stringify([...expectedLedger.living_initial_ids].sort());
  return {schema:'lezi.original_half_chaos_actual_research.v1',binding:session.binding,draws:session.draws,initial:session.initial,
    status:blocked?'BLOCKED_AT_ACTUAL_PREFIX':'ORIGINAL_REQUEST_SEQUENCE_EXECUTED',blockedAt:blocked??null,ledgerMatched,
    plannedRequests:session.replay.source_prescribed_turns.reduce((n:number,t:any)=>n+1+t.pre_main_requests.length,0),
    actualRequests:results.length,results,
    acceptance:'Original 64 specs remain UNRUN unless their full obligations are separately verified; sequence execution is not mode acceptance.',
    independentQA:false,featuresReady:false,score:'frozen',NET:'paused'};
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const initial = readFileSync(new URL('../../tests/fixtures/half-chaos-original/INITIALIZATION_WITNESS_DATA.json',import.meta.url),'utf8');
  const replays = readFileSync(new URL('../../tests/fixtures/half-chaos-original/REPLAY_ACTION_DATA.json',import.meta.url),'utf8');
  const ids = process.argv.slice(2).filter(x=>!x.startsWith('--output='));
  const results = (ids.length?ids:Object.keys(replayTuples)).map(id=>runOriginalHalfChaos(initial,replays,id));
  const output = process.argv.find(x=>x.startsWith('--output='))?.slice(9);
  if(output)writeFileSync(output,JSON.stringify(results,null,2)+'\n');
  console.log(JSON.stringify(results.map(r=>({id:r.binding.replayId,status:r.status,requests:r.actualRequests,planned:r.plannedRequests,blocked:r.blockedAt,ledgerMatched:r.ledgerMatched,errors:r.results.filter(x=>x.disposition==='rejected').map(x=>({id:x.declarationId,error:x.error}))})),null,2));
}

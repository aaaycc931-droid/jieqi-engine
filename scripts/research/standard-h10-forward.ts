import { readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { randomInt } from 'node:crypto';
import { issueOriginalStandardH10Forward, withExactStandardH10Forward, registerExactResearchRoom, STANDARD_H10_FORWARD_TAPE } from '../../src/research-source-context.ts';
import { createRemoteRoom, joinRemoteRoom, submitRemoteHeroSelection, submitRemoteRps, completeRemoteHeroIntro, submitRemoteHeroPreparationChoice,
  submitRemoteMove, submitRemoteAssassination, publicRemoteRoom, playerRoomView, type RemoteRoom } from '../../src/remote-room.ts';
import { captureMechanismEvents } from '../../src/mechanism-observer.ts';
import { isGeneralInCheck } from '../../src/rules.ts';

export const H10_FORWARD_MAPPING = Object.freeze({ red_pawn_0: 'covered-25', black_horse_1: 'covered-01', black_pawn_8: 'covered-14', black_pawn_6: 'covered-13', red_rook_0: 'covered-15', black_pawn_0: 'covered-10', black_pawn_2: 'covered-11', black_horse_7: 'covered-06' });
const sourceDir = new URL('../../tests/fixtures/standard-h10/', import.meta.url);
export const h10ForwardSources = () => ['PREFIX_CONTRACT.json', 'FIRST_SAMPLING_CONFIRMATION.json', 'ATOMIC_OBSERVATION_CONTRACT.json'].map(p => readFileSync(new URL(p, sourceDir), 'utf8'));

/** Real preparations; finite declared conditioning on an offer containing A/B.
 * No caller board, host, candidate or entropy tape. Third candidate is not forced.
 * Returned call owns only actual API instances, for bounded verification. */
export function prepareStandardH10Forward(maxAttempts = 512) {
  if (!Number.isInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > 512) throw new RangeError('1..512 attempts');
  const players = { red: 'h10-red', black: 'h10-black' }, roomId = 'std-h10-forward';
  const [prefix, confirmation, atomic] = h10ForwardSources();
  const cap = issueOriginalStandardH10Forward({ roomId, players, tupleId: 'STD-H10-FORWARD-PREFIX' }, prefix, confirmation, atomic);
  const call = <T extends RemoteRoom>(f: () => T): T => withExactStandardH10Forward(cap, () => { const r = f(); registerExactResearchRoom(r); return r; });
  const attempts: Array<{ draws: Array<{ bound: number; index: number }>; candidates: string[] }> = [];
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const draws: Array<{ bound: number; index: number }> = [];
    const entropy = (bound: number) => { const index = randomInt(bound); draws.push({ bound, index }); return index; };
    const mutation = (bound: number) => { if (bound !== 8) throw new Error('Unexpected mutation pool'); return 3; };
    let room = call(() => createRemoteRoom(roomId, players.red, 'h10-research', 1000, { baseMode: 'xiangqi', heroesEnabled: true, mutationsEnabled: true }));
    room = call(() => joinRemoteRoom(room, players.black, 'h10-research', 1100).room);
    room = call(() => submitRemoteHeroSelection(room, players.red, 'rogue', mutation, 1200));
    room = call(() => submitRemoteHeroSelection(room, players.black, 'wind', mutation, 1300));
    room = call(() => submitRemoteRps(room, players.red, 'rock', 1, mutation, 1400));
    room = call(() => submitRemoteRps(room, players.black, 'scissors', 1, mutation, 1500));
    room = call(() => completeRemoteHeroIntro(room, players.red, 1600, entropy));
    room = call(() => completeRemoteHeroIntro(room, players.black, 1700, entropy));
    const candidates = playerRoomView(room, players.black).ownWindPreparation!.candidates.map(p => p.pieceId);
    attempts.push({ draws, candidates });
    if (!['covered-10', 'covered-11'].every(id => candidates.includes(id))) continue;
    const prepared = room;
    const worlds = Object.fromEntries([['A','covered-10'], ['B','covered-11']].map(([world, windCandidateId]) =>
      [world, call(() => submitRemoteHeroPreparationChoice(prepared, players.black, { windCandidateId }, 1800))])) as Record<'A'|'B', RemoteRoom>;
    return { cap, call, players, prepared, worlds, attempts };
  }
  const error = new Error('Bounded actual offer search exhausted; no original A/B run');
  Object.assign(error, { attempts }); throw error;
}

export function h10ForwardCommand(i: number) {
  const [pieceId, fx, fy, tx, ty] = STANDARD_H10_FORWARD_TAPE[i];
  return { pieceId: pieceId as string, from: { x: fx as number, y: fy as number }, to: { x: tx as number, y: ty as number }, actionId: `h10-forward-${i}`, expectedRevision: i,
    ...(i === 6 ? { kind: 'assassination' as const, source: 'hero' as const } : i === 8 ? { kind: 'assassination' as const, useStrongStrike: true } : {}) };
}
export const h10ForwardViews = (room: RemoteRoom) => ({ public: publicRemoteRoom(room), red: playerRoomView(room, 'h10-red'), black: playerRoomView(room, 'h10-black') });
export function advanceStandardH10Forward(session: ReturnType<typeof prepareStandardH10Forward>, room: RemoteRoom, i: number) {
  const command = h10ForwardCommand(i), actor = session.players[i % 2 ? 'black' : 'red'];
  return session.call(() => (i === 6 || i === 8 ? submitRemoteAssassination : submitRemoteMove)(room, actor, command as any, 2000 + i * 1000, () => { throw new Error('Unexpected formal RNG'); }).room);
}
export function replayStandardH10Forward(session: ReturnType<typeof prepareStandardH10Forward>, world: 'A'|'B', observe = true, failObserver = false) {
  let room = session.worlds[world];
  const steps: any[] = [];
  for (let i = 0; i < 9; i++) {
    const before = structuredClone(room), run = () => advanceStandardH10Forward(session, room, i);
    const capture = observe ? captureMechanismEvents(run, failObserver ? { projectCheckpoint: () => { throw new Error('intentional observer failure'); } } : {}) : { result: run(), events: [] };
    room = capture.result;
    steps.push({ i, command: h10ForwardCommand(i), before, after: structuredClone(room), views: h10ForwardViews(room),
      events: capture.events, evidenceValid: capture.evidenceValid !== false,
      publicCheck: { red: isGeneralInCheck(room.game!.state, 'red'), black: isGeneralInCheck(room.game!.state, 'black') } });
  }
  return { world, steps, final: room };
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const s = prepareStandardH10Forward();
  const result = { kind: 'CONDITIONED_REAL_PREPARATION_ORIGINAL_PREFIX', mapping: H10_FORWARD_MAPPING, attempts: s.attempts,
    worlds: ['A','B'].map(w => replayStandardH10Forward(s,w as 'A'|'B')),
    limits: { independentQA: false, productionDistribution: false, exactPathIntermediateCheckpoint: false, clientWire: false, productModeOpened: false } };
  if (process.argv[2]) writeFileSync(process.argv[2], JSON.stringify(result, null, 2) + '\n');
  else process.stdout.write(JSON.stringify(result, null, 2) + '\n');
}

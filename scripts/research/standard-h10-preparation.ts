import { readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { randomInt as nodeRandomInt } from 'node:crypto';
import { issueOriginalStandardH10Preparation, withExactStandardH10Preparation, registerExactResearchRoom } from '../../src/research-source-context.ts';
import { createRemoteRoom, joinRemoteRoom, submitRemoteHeroSelection, submitRemoteRps, completeRemoteHeroIntro,
  submitRemoteHeroPreparationChoice, publicRemoteRoom, playerRoomView, type RemoteRoom } from '../../src/remote-room.ts';

export const H10_PREPARATION_SOURCES = Object.freeze({
  engineParent: '71145df45ad17215a3731e53150b6728e079e375',
  confirmationCommit: 'e7a581d1208479e5ab48d67dd96a77bc969cc0a5',
  prefixSha256: 'c98c1acc44734b92be785092e6239e28df56c95421f3a21c8e67ace3f21217f4',
  confirmationSha256: '78ec040f646f4cd30df341731e7b457870b26cf0a83616ac7425a89a5919121c',
});

/** Owns actual room API instances. No caller room, host ID, RNG tape, capability,
 * board, or formal move can be injected. Samples are NOT the original R5 A/B. */
export function runStandardH10Preparation(prefixText: string, confirmationText: string) {
  const roomId = 'std-h10-preparation-observation', players = { red: 'h10-red', black: 'h10-black' };
  const cap = issueOriginalStandardH10Preparation({ roomId, players, tupleId: 'STD-H10-PREPARATION' }, prefixText, confirmationText);
  let room: RemoteRoom | undefined;
  const stages: string[] = [], draws: Array<{ bound: number; index: number }> = [];
  const invoke = (operation: () => RemoteRoom) => withExactStandardH10Preparation(cap, () => {
    const next = operation(); registerExactResearchRoom(next); room = next; stages.push(next.phase); return next;
  });
  // Fix only the approved M04 background. H10 candidates use actual unbiased entropy.
  const mutation = (bound: number) => { if (bound !== 8) throw new Error('Unexpected mutation pool'); return 3; };
  const random = (bound: number) => { const index = nodeRandomInt(bound); draws.push({ bound, index }); return index; };
  invoke(() => createRemoteRoom(roomId, players.red, 'h10-research', 1000, { baseMode: 'xiangqi', heroesEnabled: true, mutationsEnabled: true }));
  invoke(() => joinRemoteRoom(room!, players.black, 'h10-research', 1100).room);
  invoke(() => submitRemoteHeroSelection(room!, players.red, 'rogue', mutation, 1200));
  invoke(() => submitRemoteHeroSelection(room!, players.black, 'wind', mutation, 1300));
  invoke(() => submitRemoteRps(room!, players.red, 'rock', 1, mutation, 1400));
  invoke(() => submitRemoteRps(room!, players.black, 'scissors', 1, mutation, 1500));
  invoke(() => completeRemoteHeroIntro(room!, players.red, 1600, random));
  invoke(() => completeRemoteHeroIntro(room!, players.black, 1700, random));
  const prepared = room!;
  const views = (r: RemoteRoom) => ({ public: publicRemoteRoom(r), red: playerRoomView(r, players.red), black: playerRoomView(r, players.black) });
  const candidates = playerRoomView(prepared, players.black).ownWindPreparation!.candidates;
  // Two legal choices from the SAME actual offer, not synthetic post-selection state.
  const controls = [0, 1].map(index => {
    const chosen = invoke(() => submitRemoteHeroPreparationChoice(prepared, players.black, { windCandidateId: candidates[index].pieceId }, 1800));
    return { id: `C${index}`, chosen: candidates[index].pieceId, authority: structuredClone(chosen), views: views(chosen) };
  });
  return { kind: 'ACTUAL_T0_PREPARATION_ONLY', sources: H10_PREPARATION_SOURCES, stages, draws,
    prepared: { authority: structuredClone(prepared), views: views(prepared) }, controls,
    limits: { originalR1R5Executed: false, originalCandidateExampleForced: false, trueRoyalQualified: false,
      wireOrUIImplemented: false, productModeOpened: false, shortagesTimeoutsInvalidation: 'COVERAGE_STOP_ONLY' } };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const base = new URL('../../tests/fixtures/standard-h10/', import.meta.url);
  const result = runStandardH10Preparation(readFileSync(new URL('PREFIX_CONTRACT.json', base), 'utf8'), readFileSync(new URL('FIRST_SAMPLING_CONFIRMATION.json', base), 'utf8'));
  if (process.argv[2]) writeFileSync(process.argv[2], JSON.stringify(result, null, 2) + '\n');
  else process.stdout.write(JSON.stringify(result, null, 2) + '\n');
}

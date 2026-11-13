import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { initializeFeatureGameState, initializeFeatureSecret, applyHeroAbility, applyAuthoritativeMove,
  getRelayPairs, createInitialGame, getLegalMoves, isGeneralInCheck } from "../../src/index.ts";
import { gameState, revealed, secretState } from "../../tests/helpers.ts";
import type { GameState, PublicPiece, Side } from "../../src/types.ts";

const cases: unknown[] = [];
function setup(pieces: PublicPiece[], side: Side = "red", turn: Side = side, skill = true) {
  let base = gameState(pieces, { turn });
  if (side === "black") {
    base.pieces = base.pieces.map(p => ({ ...p, x: 8-p.x, y: 9-p.y, ...(!p.faceDown ? { color: p.color === "red" ? "black" as const : "red" as const } : {}) }));
  }
  const state = initializeFeatureGameState(base, skill ? { [side]: "siheng" } : {}, undefined, undefined, undefined, true);
  const secret = secretState(); initializeFeatureSecret(state, secret); return { state, secret };
}
function move(f: ReturnType<typeof setup>, id: string, x: number, y: number) {
  const p = f.state.pieces.find(p => p.id === id)!;
  return applyAuthoritativeMove(f.state, f.secret, { from: { x:p.x,y:p.y }, to:{x,y}, pieceId:id, expectedRevision:f.state.revision, actionId:`move:${f.state.revision}:${id}` }, false, 1000+f.state.revision*1000, undefined, () => 0);
}
function relay(f: ReturnType<typeof setup>) {
  return applyHeroAbility(f.state, f.secret, {kind:"hero_ability",ability:"relay_swap",pieceId:"a",partnerId:"b",expectedRevision:f.state.revision,actionId:`relay:${f.state.revision}`},1000+f.state.revision*1000,()=>0);
}
for (const side of ["red","black"] as const) {
  const opponent: Side = side === "red" ? "black" : "red";
  const xy = (x:number,y:number) => side === "red" ? [x,y] as const : [8-x,9-y] as const;
  const pieces = [revealed("a","red","rook",0,6),revealed("b","red","pawn",4,6),revealed("horse1","black","horse",4,2),revealed("horse2","black","horse",8,6)];
  const original = setup(pieces,side), after = relay(original);
  assert.equal(after.state.turn,opponent); assert.equal(after.state.captured.length,0);
  // Opponent actively withdraws one fork target; the other can be taken next turn.
  const reply = move(after,"horse2",...xy(7,4));
  const capture = move(reply,"a",...xy(4,2));
  assert.equal(capture.state.captured[0].id,"horse1");
  const control = setup(pieces,side,side,false);
  const ordinary = move(control,"a",...xy(0,2)); // attacks the nearer horse, no skipped turn
  const response = move(ordinary,"horse1",...xy(2,3));
  assert.equal(response.state.captured.length,0);
  cases.push({id:`fork-${side}`,input:original.state,actions:["swap a/b","opponent horse2 retreats","a captures horse1"],skillMaterialGain:4,skillImmediateDestruction:0,opponentReplyLegal:true,control:["a moves to (0,2), rotated for black","horse1 retreats to (2,3), rotated"],controlMaterialGain:0,range2PairAvailable:false,range4PairAvailable:true,claim:"specific scripted tactical witness, not exhaustive minimax or global score"});

  const preempt = setup([revealed("a","red","rook",0,6),revealed("b","red","pawn",4,6),revealed("cutter","black","rook",4,0)],side,opponent);
  const cut = move(preempt,"cutter",...xy(4,6));
  assert.equal(getRelayPairs(cut.state,side).length,0);
  cases.push({id:`counter-partner-${side}`,input:preempt.state,action:"opponent captures b before the pilot turn",pairsAfter:0,normalMovesRemain:cut.state.pieces.filter(p=>!p.faceDown&&p.color===side).some(p=>getLegalMoves(cut.state,p.id,side).length>0)});

  const checked = setup([revealed("a","red","rook",0,6),revealed("b","red","pawn",4,6),revealed("checker","black","rook",3,5)],side);
  assert(isGeneralInCheck(checked.state,side));assert.equal(getRelayPairs(checked.state,side).length,0);
  cases.push({id:`counter-check-${side}`,input:checked.state,pairs:0,claim:"forcing check denies relay; normal check responses remain"});

  const ending = setup([revealed("a","red","rook",0,6)],side);
  assert.equal(getRelayPairs(ending.state,side).length,0);
  cases.push({id:`late-no-partner-${side}`,input:ending.state,pairs:0,claim:"two charges can be stranded in a sparse endgame"});
}
const opening=createInitialGame(max=>max-1);
opening.state=initializeFeatureGameState(opening.state,{red:"siheng"},undefined,undefined,undefined,true);
assert.equal(getRelayPairs(opening.state).length,0);
cases.push({id:"real-32-opening",pieces:32,hiddenPieces:30,pairs:0,claim:"skill cannot reveal or operate on covered pieces"});
writeFileSync("review/hero-pilot/SCENARIOS.json",JSON.stringify({scope:"synthetic legal positions except explicit real-32 opening; no reachability claim",cases},null,2)+"\n");
console.log(`${cases.length} scenario witnesses passed`);

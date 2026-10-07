import assert from "node:assert/strict";
import test from "node:test";
import { applyAuthoritativeAssassination, applyAuthoritativeMove, applyHeroAbility, beginFormalTurn, closeDirectDeaths, configureHeroPreparation, createBluetoothSnapshot, destroyPiece, finishFormalTurn, generateGhosts, getController, getHeroPackage, getLegalAssassinationMoves, getLegalMoves, initializeFeatureGameState, initializeFeatureSecret, isGeneralInCheck, landFlyingPiece, ownerHeroSecrets, playerRoomView, publicRemoteRoom, publicStateSnapshot, putGhostObject, queueLanding, recordAction, closeMainActionAtom, reconcileGhostInfections, relocatePiece, settleLandings, startFormalClock, validateHeroForms } from "../src/index.ts";
import { BluetoothHostRoom, BLUETOOTH_HOST_PLAYER as host, BLUETOOTH_GUEST_PLAYER as guest } from "../src/bluetooth-host-room.ts";
import type { GameState, HeroAbilityCommand, HeroId, HeroForm, GalakrondForm, RemoteRoom, SecretState, Side } from "../src/types.ts";
import { covered, gameState, move, revealed, secretState } from "./helpers.ts";
const skill=(state:GameState,ability:HeroAbilityCommand["ability"],rest:Partial<HeroAbilityCommand>={})=>({kind:"hero_ability" as const,ability,actionId:`r5:${ability}:${state.revision}`,expectedRevision:state.revision,...rest});
function pair(hero:HeroId,pieces:GameState["pieces"]=[],form:HeroForm="front",variant?:GalakrondForm) {
 const state=initializeFeatureGameState(gameState(pieces),{red:hero,black:"hunter"},undefined,{red:form},{red:variant}); return {state,secret:secretState()};
}
function end(state:GameState,secret:SecretState,side:Side,id:string) {
 beginFormalTurn(state,secret,()=>0);recordAction(state,{tier:1,keywords:["移动"],source:"ordinary",opportunity:"main",countsAsFormalTurn:true,actionId:id,actingSide:side});closeMainActionAtom(state,id);finishFormalTurn(state,secret,side,()=>0);delete state.lastMove;
}
function bt(red:HeroId,black:HeroId,redForm:HeroForm="front",variant?:GalakrondForm) {
 const room=new BluetoothHostRoom({roomId:"r5-transfer",admissionSecret:"test",now:()=>1000,randomInt:()=>0,mode:{heroesEnabled:true,mutationsEnabled:false}});
 room.handle(host,{kind:"hero",hero:red,form:redForm,variant});room.handle(guest,{kind:"hero",hero:black});
 room.handle(host,{kind:"rps",choice:"rock",round:1});room.handle(guest,{kind:"rps",choice:"scissors",round:1});return room;
}

test("R5-H02-01 activation attack is ordinary and barrier interception refunds the source",()=>{
 const a=pair("rogue",[revealed("actor","red","rook",0,7),revealed("target","black","pawn",0,6)]);
 a.state.effectsByPieceId!.target={barrier:{owner:"black",enemyTurnsRemaining:3}};
 const cmd={...move({x:0,y:7},{x:0,y:6},"activation"),kind:"assassination" as const,source:"hero" as const,useStrongStrike:false};
 const blocked=applyAuthoritativeAssassination(a.state,a.secret,cmd);assert.equal(blocked.state.assassination!.red.heroChargeAvailable,true);assert.equal(blocked.state.assassination!.red.activePieceId,undefined);assert.equal(blocked.state.lastMove!.landed,false);assert.equal(blocked.state.effectsByPieceId!.target?.barrier,undefined);
 const b=pair("rogue",[revealed("actor","red","rook",0,7),revealed("target","black","pawn",0,6)]),result=applyAuthoritativeAssassination(b.state,b.secret,cmd);
 assert.equal(result.state.captured[0].cause,"attack");assert.equal(result.state.effectsByPieceId!.actor.stealth!.remainingOwnerTurns,2);
});
test("R5-H02-02 activation cannot target intangible but a later source attack can bypass it and barrier",()=>{
 const a=pair("rogue",[revealed("actor","red","rook",0,7),revealed("target","black","pawn",0,6)]);a.state.effectsByPieceId!.target={intangible:true,barrier:{owner:"black",enemyTurnsRemaining:3}};
 assert.throws(()=>applyAuthoritativeAssassination(a.state,a.secret,{...move({x:0,y:7},{x:0,y:6},"activate"),kind:"assassination",source:"hero",useStrongStrike:false}),e=>e.code==="ILLEGAL_TARGET");
 a.state.assassination!.red.activePieceId="actor";a.state.effectsByPieceId!.actor={stealth:{owner:"red",remainingOwnerTurns:2,strongStrikeAvailable:true,source:"hero"}};
 const result=applyAuthoritativeAssassination(a.state,a.secret,{...move({x:0,y:7},{x:0,y:6},"strike"),kind:"assassination",useStrongStrike:true});assert.equal(result.state.captured[0].cause,"assassination");assert.equal(result.state.effectsByPieceId!.actor?.stealth,undefined);
});
test("R5-H02-03 activation carrier killed by landing trap does not retain a dangling stealth state",()=>{
 const a=pair("rogue",[revealed("actor","red","rook",0,7)]);a.secret.traps=[{id:"last",owner:"black",position:{x:0,y:6},opponentTurnsRemaining:1}];
 const r=applyAuthoritativeAssassination(a.state,a.secret,{...move({x:0,y:7},{x:0,y:6},"fatal"),kind:"assassination",source:"hero",useStrongStrike:false});assert.equal(r.state.pieces.some(p=>p.id==="actor"),false);assert.equal(r.state.assassination!.red.activePieceId,undefined);assert.equal(r.state.effectsByPieceId!.actor,undefined);
});
test("R5-H09-01 in-check destruction closes both batches before ghost triggers",()=>{
 const a=pair("deathwing",[revealed("attacker","black","rook",3,0),revealed("own","red","horse",0,7),covered("hidden",0,6)]);a.secret.identities.hidden={color:"red",type:"rook"};assert.equal(isGeneralInCheck(a.state,"red"),true);
 const r=applyHeroAbility(a.state,a.secret,skill(a.state,"destruction"),0,()=>1);assert.equal(r.state.destructionBatches!.length,2);assert.deepEqual(r.state.destructionBatches![0].destroyedIds,[]);assert.deepEqual(r.state.destructionBatches![1].destroyedIds,["own"]);assert.equal(r.state.pieces.some(p=>p.id==="hidden"),true);assert.equal(r.state.status,"execution");assert.equal(r.state.captured[0].cause,"destruction_penalty");
});
test("R5-H09-02 normal destruction has no self-clear penalty and duplicate preserves the committed draws",()=>{
 const a=pair("deathwing",[revealed("own","red","horse",0,7)]);const command=skill(a.state,"destruction"),r=applyHeroAbility(a.state,a.secret,command,0,()=>1);
 assert.equal(r.state.destructionBatches!.length,1);assert.equal(r.state.pieces.some(p=>p.id==="own"),true);
 const dup=applyHeroAbility(r.state,r.secret,command,0,()=>{throw Error("no redraw");});assert.equal(dup.duplicate,true);assert.deepEqual(dup.state,r.state);
});
test("R5-H12-01 flame uses public positional rank for covered center and targets, never their real rank",()=>{
 const a=pair("warlock",[covered("center",0,9),covered("low",1,9),revealed("rook","black","rook",1,8),{...revealed("air","black","horse",0,8),layer:"air"}]);a.secret.identities={center:{color:"black",type:"pawn"},low:{color:"red",type:"rook"}};
 const r=applyHeroAbility(a.state,a.secret,skill(a.state,"burning_flame",{pieceId:"center"}),0,()=>0);assert.deepEqual(new Set(r.state.captured.map(p=>p.id)),new Set(["center","low","rook","air"]));assert.equal(r.state.heroRuntime!.red!.used,true);assert.equal(r.state.destructionBatches![0].source,"warlock:burning_flame");
});
test("R5-H12-02 low public rank spares higher rank and rejects unknown general threshold atomically",()=>{
 const a=pair("warlock",[covered("center",0,6),revealed("rook","black","rook",1,5),revealed("pawn","black","pawn",1,6)]);a.secret.identities.center={color:"red",type:"rook"};const r=applyHeroAbility(a.state,a.secret,skill(a.state,"burning_flame",{pieceId:"center"}));assert.equal(r.state.pieces.some(p=>p.id==="rook"),true);assert.equal(r.state.pieces.some(p=>p.id==="pawn"),false);
 const b=pair("warlock",[revealed("pawn","red","pawn",3,8)]),before=structuredClone(b);assert.throws(()=>applyHeroAbility(b.state,b.secret,skill(b.state,"burning_flame",{pieceId:"red-general"})),e=>e.code==="DESIGN_REQUIRED_FLAME_GENERAL");assert.deepEqual(b,before);
});
test("R5-H14-01 even owner begin grants six only once; secret insight publishes fee without target",()=>{
 const a=pair("night",[covered("target",0,6)]);a.secret.identities.target={color:"black",type:"horse"};a.state.formalTurns!.red=1;beginFormalTurn(a.state,a.secret,()=>0);beginFormalTurn(a.state,a.secret,()=>0);assert.equal(a.state.heroRuntime!.red!.pupil,6);
 a.state.heroRuntime!.red!.pupil=10;const command=skill(a.state,"insight",{pieceId:"target",secretInsight:true}),r=applyHeroAbility(a.state,a.secret,command);assert.equal(r.state.heroRuntime!.red!.pupil,3);assert.equal(r.state.actionRecords![0].pieceId,undefined);assert.equal(r.state.effectsByPieceId!.target?.insightMark,undefined);assert.deepEqual(ownerHeroSecrets(r.secret,"red").insights![0].identity,{color:"black",type:"horse"});assert.equal(ownerHeroSecrets(r.secret,"black").insights,undefined);assert.equal(r.state.formalTurns!.red,1);
 assert.throws(()=>applyHeroAbility(r.state,r.secret,skill(r.state,"insight",{pieceId:"target"})),e=>e.code==="INSIGHT_TURN_LIMIT");assert.equal(applyHeroAbility(r.state,r.secret,command).duplicate,true);
});
test("R5-H14-02 normal insight marks target, shares increasing cost, and read does not reveal",()=>{
 const a=pair("night",[covered("target",0,6)]);a.secret.identities.target={color:"black",type:"cannon"};a.state.heroRuntime!.red!.pupil=20;const r=applyHeroAbility(a.state,a.secret,skill(a.state,"insight",{pieceId:"target"}));assert.equal(r.state.effectsByPieceId!.target.insightMark,true);assert.equal(r.state.pieces.find(p=>p.id==="target")!.faceDown,true);assert.equal(r.state.heroRuntime!.red!.pupil,16);assert.equal(r.state.actionRecords![0].pieceId,"target");
 r.state.formalTurns!.red=1;delete r.state.turnLifecycle;beginFormalTurn(r.state,r.secret,()=>0);const second=applyHeroAbility(r.state,r.secret,skill(r.state,"insight",{pieceId:"target",secretInsight:true}));assert.equal(second.state.heroRuntime!.red!.pupil,9);assert.equal(second.state.heroRuntime!.red!.insightCount,2);
});
test("R5-H14-03 private room views and public serialization contain only the owner's insight result",()=>{
 const a=pair("night",[covered("target",0,6)]);a.secret.identities.target={color:"black",type:"cannon"};a.state.heroRuntime!.red!.pupil=10;const r=applyHeroAbility(a.state,a.secret,skill(a.state,"insight",{pieceId:"target",secretInsight:true}));
 const room={roomId:"private",phase:"playing",updatedAt:0,seats:{host:{playerId:"a"},guest:{playerId:"b"}},mode:{heroesEnabled:true,mutationsEnabled:false},game:{...r,players:{red:"a",black:"b"}}} as unknown as RemoteRoom;
 assert.equal(JSON.stringify(publicRemoteRoom(room)).includes('"insights"'),false);assert.equal(playerRoomView(room,"b").ownHeroSecrets?.insights,undefined);assert.equal(playerRoomView(room,"a").ownHeroSecrets?.insights?.length,1);
});
test("R5-H13-01 weak side rejects outward ordinary action; strong-side move opens one child window",()=>{
 const a=pair("single_blade",[revealed("mover","red","rook",1,7),revealed("weak","red","rook",6,7)]);configureHeroPreparation(a.state,a.secret,"red",{blade:"left"});assert.equal(getLegalMoves(a.state,"weak").some(p=>p.x===7&&p.y===7),false);
 const r=applyAuthoritativeMove(a.state,a.secret,move({x:1,y:7},{x:1,y:6},"strong"));assert.equal(r.state.pendingHeroChild!.kind,"blade");assert.equal(r.state.formalTurns!.red,0);assert.equal(r.state.turn,"red");const shifted=applyHeroAbility(r.state,r.secret,skill(r.state,"blade_shift",{pieceId:"mover",to:{x:2,y:6}}));assert.equal(shifted.state.formalTurns!.red,1);assert.equal(shifted.state.turn,"black");assert.equal(shifted.state.pieces.find(p=>p.id==="mover")!.x,2);
});
test("R5-H13-02 attack does not grant shift, displacement ignores weak restriction, illegal child has no side effects",()=>{
 const a=pair("single_blade",[revealed("mover","red","rook",1,7),revealed("target","black","pawn",1,6),revealed("weak","red","rook",6,7)]);configureHeroPreparation(a.state,a.secret,"red",{blade:"left"});const r=applyAuthoritativeMove(a.state,a.secret,move({x:1,y:7},{x:1,y:6},"attack"));assert.equal(r.state.pendingHeroChild,undefined);assert.equal(relocatePiece(a.state,a.secret,"weak",{x:7,y:7},"source:displace"),true);
 const b=pair("single_blade",[revealed("mover","red","rook",3,7)]);configureHeroPreparation(b.state,b.secret,"red",{blade:"left"});const pending=applyAuthoritativeMove(b.state,b.secret,move({x:3,y:7},{x:3,y:6},"strong")),before=structuredClone(pending);assert.throws(()=>applyHeroAbility(pending.state,pending.secret,skill(pending.state,"blade_shift",{to:{x:4,y:6}})),e=>e.code==="INVALID_BLADE_SHIFT");assert.deepEqual(pending,before);
});
test("R5-H16-01 normal I main enemy kill earns three and one paid child attack does not create a formal turn",()=>{
 const a=pair("berserker",[revealed("mover","red","rook",0,7),revealed("first","black","pawn",0,6),revealed("second","black","pawn",1,6)]);a.state.heroRuntime!.red!.will=6;const r=applyAuthoritativeMove(a.state,a.secret,move({x:0,y:7},{x:0,y:6},"kill"));assert.equal(r.state.heroRuntime!.red!.will,9);assert.equal(r.state.pendingHeroChild!.kind,"charge");
 const charged=applyHeroAbility(r.state,r.secret,skill(r.state,"charge_attack",{to:{x:1,y:6}}));assert.equal(charged.state.formalTurns!.red,1);assert.equal(charged.secret.history!.length,1);assert.equal(charged.state.heroRuntime!.red!.chargeCount,1);assert.equal(charged.state.heroRuntime!.red!.will,6);assert.equal(charged.state.lastMove!.countsAsFormalTurn,false);
});
test("R5-H16-02 insufficient will is atomic and source skipping cannot reopen a charge",()=>{
 const a=pair("berserker",[revealed("mover","red","rook",0,7),revealed("first","black","pawn",0,6)]),r=applyAuthoritativeMove(a.state,a.secret,move({x:0,y:7},{x:0,y:6},"kill")),before=structuredClone(r);assert.throws(()=>applyHeroAbility(r.state,r.secret,skill(r.state,"charge_move",{to:{x:1,y:6}})),e=>e.code==="INSUFFICIENT_WILL");assert.deepEqual(r,before);
 const skipped=applyHeroAbility(r.state,r.secret,skill(r.state,"skip_child",{skip:true}));assert.equal(skipped.state.turn,"black");assert.equal(skipped.state.heroRuntime!.red!.chargeCount,undefined);
});
function shore(form:HeroForm="front") {
 const a=pair("jiang_he",[revealed("mover","red","rook",0,6),revealed("reply","black","rook",7,2)],form);
 const first=applyAuthoritativeMove(a.state,a.secret,move({x:0,y:6},{x:0,y:5},"shore"));return applyAuthoritativeMove(first.state,first.secret,move({x:7,y:2},{x:7,y:3},"reply",first.state.revision));
}
test("R5-H17-01 ordinary shore qualifies, entry counts current turn, arbitrary clear horizontal main and same-file exit",()=>{
 let r=shore();assert.equal(r.state.effectsByPieceId!.mover.riverQualified,true);r=applyHeroAbility(r.state,r.secret,skill(r.state,"river_enter",{pieceId:"mover"}));assert.equal(r.state.effectsByPieceId!.mover.riverTurns,2);
 r=applyAuthoritativeMove(r.state,r.secret,move({x:7,y:3},{x:7,y:2},"reply2",r.state.revision));r=applyHeroAbility(r.state,r.secret,skill(r.state,"river_move",{pieceId:"mover",to:{x:8,y:0}}));assert.equal(r.state.pieces.find(p=>p.id==="mover")!.river!.cellId,"8");assert.equal(r.state.effectsByPieceId!.mover.riverTurns,1);
 r=applyAuthoritativeMove(r.state,r.secret,move({x:7,y:2},{x:7,y:3},"reply3",r.state.revision));r=applyHeroAbility(r.state,r.secret,skill(r.state,"river_exit",{pieceId:"mover",to:{x:8,y:5}}));assert.equal(r.state.pieces.find(p=>p.id==="mover")!.layer,undefined);assert.equal(r.state.effectsByPieceId!.mover.riverTurns,undefined);
});
test("R5-H17-02 displace to shore does not qualify; occupied river blocks distant crossing atomically",()=>{
 const a=pair("jiang_he",[revealed("mover","red","rook",0,6)]);relocatePiece(a.state,a.secret,"mover",{x:0,y:5},"source:displace");assert.throws(()=>applyHeroAbility(a.state,a.secret,skill(a.state,"river_enter",{pieceId:"mover"})),e=>e.code==="RIVER_NOT_QUALIFIED");
 let r=shore();r=applyHeroAbility(r.state,r.secret,skill(r.state,"river_enter",{pieceId:"mover"}));r.state.turn="red";delete r.state.turnLifecycle;r.state.pieces.push({...revealed("block","black","pawn",3,4),layer:"river",river:{source:"jiang_he:front",spaceId:"jiang_he:river",cellId:"3"}});const before=structuredClone(r);assert.throws(()=>applyHeroAbility(r.state,r.secret,skill(r.state,"river_move",{pieceId:"mover",to:{x:8,y:0}})),e=>e.code==="INVALID_RIVER_PATH");assert.deepEqual(r,before);
});
test("R5-H18-01 inner package never dispatches front, traverses then grants optional move without advancing extra turn",()=>{
 let r=shore("inner");assert.equal(r.state.featureRules!.heroSelections!.red!.form,"inner");assert.throws(()=>applyHeroAbility(r.state,r.secret,skill(r.state,"river_enter",{pieceId:"mover"})),e=>e.code==="WRONG_HERO_FORM");r=applyHeroAbility(r.state,r.secret,skill(r.state,"inner_wave",{pieceId:"mover",to:{x:8,y:4}}));assert.equal(r.state.pendingHeroChild!.kind,"inner_wave");assert.equal(r.state.formalTurns!.red,1);r=applyHeroAbility(r.state,r.secret,skill(r.state,"wave_move",{to:{x:8,y:5}}));assert.equal(r.state.formalTurns!.red,2);assert.equal(r.state.turn,"black");assert.equal(r.state.pieces.find(p=>p.id==="mover")!.layer,undefined);assert.equal(r.state.heroRuntime!.red!.used,true);
});
test("R5-H19-01 entering from outside gets one infection per atom, supported-to-supported preserves, new ghost underfoot does not count entry",()=>{
 const a=pair("death_knight",[revealed("enemy","black","rook",0,3)]);for(const y of [4,5])putGhostObject(a.state,{kind:"ghost",source:"death_knight:death",owner:"red",position:{x:0,y},remaining:3},"replace");
 relocatePiece(a.state,a.secret,"enemy",{x:0,y:4},"source:displace");assert.equal(a.state.effectsByPieceId!.enemy.infection!.stacks,1);relocatePiece(a.state,a.secret,"enemy",{x:0,y:5},"source:displace");assert.equal(a.state.effectsByPieceId!.enemy.infection!.stacks,1);relocatePiece(a.state,a.secret,"enemy",{x:1,y:5},"source:displace");assert.equal(a.state.effectsByPieceId!.enemy.infection,undefined);
 putGhostObject(a.state,{kind:"ghost",source:"death_knight:death",owner:"red",position:{x:1,y:5},remaining:3},"replace");assert.equal(a.state.effectsByPieceId!.enemy.infection,undefined);
});
test("R5-H20-01 inner ghost air death makes persistent layer and ignores normal ticks",()=>{
 const a=pair("death_knight",[{...revealed("flyer","red","pawn",0,6),layer:"air"}],"inner");initializeFeatureSecret(a.state,a.secret);destroyPiece(a.state,a.secret,"flyer","black","destruction");generateGhosts(a.state);assert.equal(a.state.ghosts![0].kind,"inner_ghost");assert.equal(a.state.ghosts![0].persistent,true);assert.equal(a.state.ghosts![0].layers,1);end(a.state,a.secret,"red","end");assert.equal(a.state.ghosts![0].layers,1);assert.equal(a.state.ghosts![0].remaining,0);
});
test("R5-H20-02 pulse is cross5 only, no lasting sublethal infection, new death ghosts excluded from consumed snapshot",()=>{
 const a=pair("death_knight",[revealed("hit","black","rook",1,5),revealed("diagonal","black","rook",2,4)],"inner");putGhostObject(a.state,{kind:"inner_ghost",source:"death_knight:inner_death",owner:"red",position:{x:1,y:4},remaining:0,persistent:true,layers:3},"add_layers");const r=applyHeroAbility(a.state,a.secret,skill(a.state,"inner_ghost_burst"));assert.equal(r.state.pieces.some(p=>p.id==="hit"),false);assert.equal(r.state.pieces.some(p=>p.id==="diagonal"),false); // orthogonal right belongs to cross
 const b=pair("death_knight",[revealed("sublethal","black","rook",1,5),revealed("diagonal","black","rook",2,5)],"inner");putGhostObject(b.state,{kind:"inner_ghost",source:"death_knight:inner_death",owner:"red",position:{x:1,y:4},remaining:0,persistent:true,layers:2},"add_layers");const spared=applyHeroAbility(b.state,b.secret,skill(b.state,"inner_ghost_burst"));assert.equal(spared.state.pieces.some(p=>p.id==="sublethal"),true);assert.equal(spared.state.pieces.some(p=>p.id==="diagonal"),true);assert.equal(spared.state.effectsByPieceId!.sublethal?.infection,undefined);assert.equal(spared.state.ghosts!.length,0);
});
test("R5-H21-01 fixed variants lock before RPS and first intro publishes only selected package",()=>{
 const room=bt("devout_zealot","night","front","fel"),a=room.views().host,b=room.views().guest;assert.equal(a.phase,"hero_intro");assert.equal(a.state!.featureRules!.heroSelections!.red!.variant,"fel");assert.equal(b.state!.featureRules!.heroSelections!.red!.variant,"fel");
 const altered=structuredClone(a.state!);const pkg=getHeroPackage("devout_zealot","front","nightmare");altered.featureRules!.heroSelections!.red! = {heroId:pkg.heroId,form:pkg.form,packageId:pkg.packageId,variant:pkg.variant};assert.throws(()=>validateHeroForms(altered));
});
function descend(variant:GalakrondForm,pieces:GameState["pieces"]=[]) {const a=pair("devout_zealot",pieces,"front",variant);a.state.heroRuntime!.red!.invokeCount=4;a.state.heroRuntime!.red!.omen=true;beginFormalTurn(a.state,a.secret,()=>0);return a;}
test("R5-H21-02 unspeakable chooses up to four current revealed nonGenerals as one batch and leaves main opportunity",()=>{
 const a=descend("unspeakable",[revealed("enemy1","black","pawn",0,3),revealed("enemy2","black","rook",1,2),revealed("own","red","pawn",2,6)]);assert.equal(a.state.heroRuntime!.red!.omen,undefined);assert.equal(a.state.heroRuntime!.red!.descended,true);assert.equal(a.state.destructionBatches!.length,1);assert.deepEqual(a.state.destructionBatches![0].destroyedIds,["enemy1","enemy2"]);assert.equal(a.state.turnLifecycle!.phase,"before_main");assert.equal(a.state.formalTurns!.red,0);
 const r=applyAuthoritativeMove(a.state,a.secret,move({x:2,y:6},{x:2,y:5},"main"));assert.equal(r.state.formalTurns!.red,1);
});
test("R5-H21-03 nightmare deployment rejects final check and places selected pieces as atomic displacements",()=>{
 const a=descend("nightmare",[revealed("own","red","rook",0,7)]),before=structuredClone(a);assert.equal(a.state.pendingDescent!.variant,"nightmare");assert.throws(()=>applyAuthoritativeMove(a.state,a.secret,move({x:0,y:7},{x:0,y:6},"premature")),e=>e.code==="DESCENT_ACTION_REQUIRED");
 assert.throws(()=>applyHeroAbility(a.state,a.secret,skill(a.state,"ascension",{placements:[{pieceId:"own",to:{x:5,y:2}}]})),e=>e.code==="DESCENT_CHECK");assert.deepEqual(a,before);
 const r=applyHeroAbility(a.state,a.secret,skill(a.state,"ascension",{placements:[{pieceId:"own",to:{x:0,y:5}}]}));assert.equal(r.state.pendingDescent,undefined);assert.equal(r.state.formalTurns!.red,0);assert.equal(r.state.turnLifecycle!.phase,"before_main");assert.equal(r.state.pieces.find(p=>p.id==="own")!.y,5);
});
test("R5-H21-04 fel creates four genuine objects of allowed fixed own types and landings fire normally",()=>{
 const a=descend("fel"),pending=a.state.pendingDescent!;assert.equal(pending.pieces.length,4);a.secret.traps=[{id:"landing",owner:"black",position:{x:0,y:6},opponentTurnsRemaining:12}];const placements=pending.pieces.map((p,i)=>({pieceId:p.id,to:{x:i,y:6}}));
 const r=applyHeroAbility(a.state,a.secret,skill(a.state,"ascension",{placements}));assert.equal(r.state.captured[0].cause,"trap_ambush");assert.equal(r.state.pieces.filter(p=>p.id.startsWith("galakrond:")).length,3);assert.equal(r.state.pieces.filter(p=>p.id.startsWith("galakrond:")).every(p=>!p.faceDown&&p.color==="red"&&p.type==="pawn"),true);
});
test("R5-H21-05 storm new geometry is eight directions one step and two assaults are sequential child opportunities",()=>{
 const a=descend("storm",[revealed("target","black","pawn",0,4)]),pending=a.state.pendingDescent!,placements=pending.pieces.map((p,i)=>({pieceId:p.id,to:{x:i,y:6}}));let r=applyHeroAbility(a.state,a.secret,skill(a.state,"ascension",{placements}));assert.equal(r.state.pendingDescent!.assaultIds!.length,2);
 r=applyHeroAbility(r.state,r.secret,skill(r.state,"storm_assault",{to:{x:0,y:4}}));assert.equal(r.state.captured[0].id,"target");assert.equal(r.state.pendingDescent!.assaultIds!.length,1);r=applyHeroAbility(r.state,r.secret,skill(r.state,"storm_assault",{skip:true}));assert.equal(r.state.pendingDescent,undefined);assert.equal(r.state.formalTurns!.red,0);assert.equal(getLegalMoves(r.state,placements[0].pieceId).some(p=>p.x===0&&p.y===2),false);assert.equal(getLegalMoves(r.state,placements[0].pieceId).some(p=>p.x===1&&p.y===3),true);
});
test("R5-H21-06 invincible grants once scale but attack interception remains explicitly blocked without guessed placement",()=>{
 const a=descend("invincible",[revealed("own","red","rook",0,6),revealed("attacker","black","rook",0,2)]);assert.equal(a.state.effectsByPieceId!.own.dragonScale,1);assert.equal(a.state.effectsByPieceId!.own.dragonClaw,true);a.state.turn="black";delete a.state.turnLifecycle;const before=structuredClone(a);assert.throws(()=>applyAuthoritativeMove(a.state,a.secret,move({x:0,y:2},{x:0,y:6},"blocked")),e=>e.code==="DESIGN_REQUIRED_DRAGON_SCALE_PLACEMENT");assert.deepEqual(a,before);
});
test("R5-H15-01 true owner training is secret, advances on own begins, graduates then forces fourth flight turn landing",()=>{
 const a=pair("sky_admiral",[covered("trainee",0,6),revealed("mover","red","rook",2,7),revealed("reply","black","rook",6,2)]);a.secret.identities.trainee={color:"red",type:"pawn"};configureHeroPreparation(a.state,a.secret,"red",{trainingType:"pawn"},()=>0);assert.equal(JSON.stringify(publicStateSnapshot(a.state)).includes('"trainee"'),true);assert.equal(JSON.stringify(publicStateSnapshot(a.state)).includes('"training"'),false);
 let r=applyAuthoritativeMove(a.state,a.secret,move({x:2,y:7},{x:2,y:6},"first"));assert.equal(r.secret.training!.red!.progress,1);r=applyAuthoritativeMove(r.state,r.secret,move({x:6,y:2},{x:6,y:3},"reply1",r.state.revision));assert.equal(r.state.pieces.find(p=>p.id==="trainee")!.layer,"air");assert.equal(r.secret.training!.red!.graduated,true);
 for(let i=0;i<3;i++){r=applyAuthoritativeMove(r.state,r.secret,{...move({x:0,y:6-i},{x:0,y:5-i},`fly${i}`,r.state.revision),pieceId:"trainee"});r=applyAuthoritativeMove(r.state,r.secret,move({x:6,y:i%2===0?3:2},{x:6,y:i%2===0?2:3},`reply${i+2}`,r.state.revision));}
 assert.equal(r.state.effectsByPieceId!.trainee.flight!.forcedLanding,true);assert.equal(getLegalMoves(r.state,"mover").length,0);r=applyHeroAbility(r.state,r.secret,skill(r.state,"landing",{pieceId:"trainee"}));assert.equal(r.state.pieces.find(p=>p.id==="trainee")!.layer,undefined);assert.equal(r.state.effectsByPieceId!.trainee.flight,undefined);
});
test("R5-H15-02 pregraduation death restarts same breed from zero and no candidate fails privately",()=>{
 const a=pair("sky_admiral",[revealed("one","red","horse",0,6),revealed("two","red","horse",2,6)]);configureHeroPreparation(a.state,a.secret,"red",{trainingType:"horse"},()=>0);a.secret.training!.red!.progress=4;initializeFeatureSecret(a.state,a.secret);destroyPiece(a.state,a.secret,"one","black","destruction");closeDirectDeaths(a.state,a.secret,"black");assert.equal(a.secret.training!.red!.pieceId,"two");assert.equal(a.secret.training!.red!.progress,0);destroyPiece(a.state,a.secret,"two","black","destruction");closeDirectDeaths(a.state,a.secret,"black");assert.equal(a.secret.training!.red!.failed,true);assert.equal(ownerHeroSecrets(a.secret,"black").training,undefined);
});
test("R5-H11-01 shuffler swaps final colors once and two shufflers cancel",()=>{
 const one=bt("shuffler","night");assert.equal(one.views().host.viewerSide,"black");assert.equal(one.views().guest.viewerSide,"red");const both=bt("shuffler","shuffler");assert.equal(both.views().host.viewerSide,"red");assert.equal(both.views().guest.viewerSide,"black");
});
test("R5-H11-02 window A restores all initial dead, invalidates insight, preserves resources, and creates timeline break",()=>{
 const a=pair("night",[covered("hidden",0,6),revealed("red-mover","red","rook",1,7),revealed("black-mover","black","rook",7,2)]); // initialize selected shuffler canonically
 const state=initializeFeatureGameState(gameState(a.state.pieces.slice(2)),{red:"night",black:"shuffler"}),secret=secretState({hidden:{color:"red",type:"pawn"}});initializeFeatureSecret(state,secret,()=>0);state.heroRuntime!.red!.pupil=10;
 let r=applyHeroAbility(state,secret,skill(state,"insight",{pieceId:"hidden"}));r=applyAuthoritativeMove(r.state,r.secret,move({x:1,y:7},{x:1,y:6},"red",r.state.revision));destroyPiece(r.state,r.secret,"hidden","black","destruction");r=applyAuthoritativeMove(r.state,r.secret,move({x:7,y:2},{x:7,y:3},"black",r.state.revision));assert.equal(r.state.pendingShuffle!.window,"A");const command=skill(r.state,"shuffle"),shuffled=applyHeroAbility(r.state,r.secret,command,0,()=>0);assert.equal(shuffled.state.pieces.some(p=>p.id==="hidden"),true);assert.equal(shuffled.state.captured.some(p=>p.id==="hidden"),false);assert.equal(shuffled.secret.history!.length,0);assert.equal(shuffled.secret.insights!.red![0].valid,false);assert.equal(shuffled.state.effectsByPieceId!.hidden?.insightMark,undefined);assert.equal(shuffled.state.heroRuntime!.red!.pupil,12); // second night begin adds six, no spent-resource rewind
 assert.equal(shuffled.state.heroRuntime!.red!.insightCount,1);assert.equal(shuffled.state.turn,"red");assert.equal(shuffled.secret.timelineEpoch,1);assert.equal(applyHeroAbility(shuffled.state,shuffled.secret,command).duplicate,true);
});
test("R5-H11-03 skipping A preserves B before ordinary begin resources, B skip permanently loses shuffle",()=>{
 const state=initializeFeatureGameState(gameState([revealed("red-mover","red","rook",1,7),revealed("black-mover","black","rook",7,2)]),{red:"hunter",black:"shuffler"}),secret=secretState();initializeFeatureSecret(state,secret,()=>0);
 let r=applyAuthoritativeMove(state,secret,move({x:1,y:7},{x:1,y:6},"red"));r=applyAuthoritativeMove(r.state,r.secret,move({x:7,y:2},{x:7,y:3},"black",r.state.revision));r=applyHeroAbility(r.state,r.secret,skill(r.state,"shuffle",{skip:true}));r=applyAuthoritativeMove(r.state,r.secret,move({x:1,y:6},{x:1,y:7},"red2",r.state.revision));assert.equal(r.state.pendingShuffle!.window,"B");assert.equal(r.state.formalTurns!.black,1);r=applyHeroAbility(r.state,r.secret,skill(r.state,"shuffle",{skip:true}));assert.equal(r.state.heroRuntime!.black!.shuffleLost,true);assert.equal(r.state.turnLifecycle!.phase,"before_main");assert.equal(r.state.formalTurns!.black,1);
});

test("R5-CLOCK-01 blade child window and repeated UI clock calls retain the original budget",()=>{
 const a=pair("single_blade",[revealed("mover","red","rook",1,7)]);configureHeroPreparation(a.state,a.secret,"red",{blade:"left"});startFormalClock(a.state,1000,a.secret,()=>0);
 const r=applyAuthoritativeMove(a.state,a.secret,move({x:1,y:7},{x:1,y:6},"clock-main"),false,2000);assert.equal(r.state.pendingHeroChild!.kind,"blade");startFormalClock(r.state,20_000,r.secret,()=>0);assert.equal(r.state.turnDeadlineAt,61_000);assert.equal(r.state.formalTurns!.red,0);
});
test("R5-H01-01 last trap turn stays lethal through an optional movement child",()=>{
 const a=pair("single_blade",[revealed("mover","red","rook",1,7)]);configureHeroPreparation(a.state,a.secret,"red",{blade:"left"});a.secret.traps=[{id:"last",owner:"black",position:{x:2,y:6},opponentTurnsRemaining:1}];
 const main=applyAuthoritativeMove(a.state,a.secret,move({x:1,y:7},{x:1,y:6},"trap-main"));assert.equal(main.secret.traps![0].opponentTurnsRemaining,1);
 const child=applyHeroAbility(main.state,main.secret,skill(main.state,"blade_shift",{to:{x:2,y:6}}));assert.equal(child.state.pieces.some(p=>p.id==="mover"),false);assert.equal(child.state.captured[0].cause,"trap_ambush");assert.equal(child.state.formalTurns!.red,1);
});
test("R5-H21-07 dragon claw endpoint crush still resolves after ordinary barrier bounce",()=>{
 const a=pair("hunter",[revealed("claw","red","rook",0,7),revealed("target","black","pawn",0,6)]);a.state.effectsByPieceId!.claw={dragonClaw:true};a.state.effectsByPieceId!.target={barrier:{owner:"black",enemyTurnsRemaining:3}};
 const r=applyAuthoritativeMove(a.state,a.secret,move({x:0,y:7},{x:0,y:6},"claw"));assert.equal(r.state.pieces.find(p=>p.id==="claw")!.y,7);assert.equal(r.state.pieces.some(p=>p.id==="target"),false);assert.equal(r.state.captured[0].cause,"crush");
});

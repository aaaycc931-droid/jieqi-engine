import assert from "node:assert/strict";
import test from "node:test";
import { applyAuthoritativeMove, applyHeroAbility, beginFormalTurn, boardPieces, destroyPiece, destroyPieceBatch, enterRiverSpace, finishFormalTurn, generateGhosts, getController, getCurrentPieceType, getLegalMoves, getLegalAssassinationMoves, getPseudoMoves, getShadowRevealedTargets, initializeFeatureGameState, initializeFeatureSecret, isFlying, isGeneralInCheck, isGround, isInsideBoard, isRiver, landFlyingPiece, leaveRiverSpace, pieceAt, queueLanding, relocatePiece, resolveWindReturn, riverPieces, samePosition, settleLandings, validatePublicMove, publicStateSnapshot, BLUETOOTH_PROTOCOL_VERSION, encodeBluetoothEnvelope, parseBluetoothEnvelope } from "../src/index.ts";
import type { RiverLocation } from "../src/index.ts";
import { covered, gameState, move, revealed, secretState } from "./helpers.ts";
const location: RiverLocation = { source: "confirmed-test-source", spaceId: "source-space", cellId: "source-cell" };
const access = { source: "explicit-test-reader", readRiver: true as const };
const skill = (ability, state, extra = {}) => ({ kind: "hero_ability" as const, ability, expectedRevision: state.revision, actionId: `river:${ability}`, ...extra });

test("R4-RIVER-01 独立河道状态不占地面，不把保留棋盘位置当河格或第11行", () => {
 const s = gameState([revealed("water", "red", "rook", 0, 7)]), k = secretState();
 assert.equal(enterRiverSpace(s, k, "water", location), true);
 const p = s.pieces.find(p => p.id === "water")!;
 assert.equal(isRiver(p), true); assert.equal(isGround(p), false); assert.equal(isFlying(p), false);
 assert.equal(isInsideBoard(p), false); assert.equal(isInsideBoard({ x: 0, y: 10 }), false);
 assert.equal(pieceAt(s, { x: 0, y: 7 }), undefined);
 assert.equal(samePosition(p, { x: 0, y: 7 }), false);
 assert.equal(boardPieces(s).some(p => p.id === "water"), false);
 assert.deepEqual(riverPieces(s, access, { spaceId: location.spaceId, cellId: location.cellId }).map(p => p.id), ["water"]);
 assert.throws(() => riverPieces(s, { source: "", readRiver: true }), e => e.code === "RIVER_READ_PERMISSION");
});

test("R4-RIVER-02 河道与飞行互斥，飞行降落入口不能把河道棋自动拉回地面", () => {
 const s = gameState([{ ...revealed("fly", "red", "rook", 0, 7), layer: "air" }, revealed("water", "red", "horse", 2, 7)]), k = secretState();
 assert.throws(() => enterRiverSpace(s, k, "fly", location), e => e.code === "RIVER_FLIGHT_EXCLUSIVE");
 assert.equal(s.pieces[2].layer, "air");
 enterRiverSpace(s, k, "water", location);
 const before = structuredClone(s); landFlyingPiece(s, k, "water"); assert.deepEqual(s, before);
});

test("R4-RIVER-03 入河即时清除地面依赖感染与崩坏，保留无额外驱散的状态", () => {
 const s = gameState([revealed("water", "red", "rook", 0, 7)]), k = secretState();
 s.effectsByPieceId = { water: { infection: { owner: "black", stacks: 2 }, timeCollapse: { expiresAtOwnerTurnEnd: 1 }, barrier: { owner: "red", enemyTurnsRemaining: 3 }, intangible: true } };
 enterRiverSpace(s, k, "water", location);
 assert.equal(s.effectsByPieceId.water.infection, undefined); assert.equal(s.effectsByPieceId.water.timeCollapse, undefined);
 assert.ok(s.effectsByPieceId.water.barrier); assert.equal(s.effectsByPieceId.water.intangible, true);
});

test("R4-RIVER-04 普通主行动与刺杀不可通过ID或旧坐标操纵河道棋", () => {
 const s = gameState([revealed("water", "red", "rook", 0, 7)]), k = secretState(); enterRiverSpace(s, k, "water", location);
 const command = { ...move({ x: 0, y: 7 }, { x: 0, y: 6 }), pieceId: "water" };
 assert.equal(validatePublicMove(s, command).code, "RIVER_ACTION_REQUIRED");
 assert.deepEqual(getPseudoMoves(s, "water"), []); assert.deepEqual(getLegalMoves(s, "water"), []); assert.deepEqual(getLegalAssassinationMoves(s, "water", true), []);
 const before = structuredClone({s,k}); assert.throws(() => applyAuthoritativeMove(s, k, command), e => e.code === "RIVER_ACTION_REQUIRED"); assert.deepEqual({s,k}, before);
 assert.equal(relocatePiece(s, k, "water", { x: 1, y: 7 }, "ordinary_relocate"), false);
});

test("R4-RIVER-05 河道棋不作车路阻挡、炮架、马腿或象眼", () => {
 for (const [type, from, to, blocker] of [
  ["rook", {x:0,y:7}, {x:0,y:5}, {x:0,y:6}],
  ["horse", {x:0,y:7}, {x:2,y:6}, {x:1,y:7}],
  ["elephant", {x:0,y:7}, {x:2,y:5}, {x:1,y:6}],
 ]) {
  const s = gameState([revealed("mover", "red", type, from.x, from.y), revealed("water", "black", "pawn", blocker.x, blocker.y)]), k = secretState();
  assert.equal(validatePublicMove(s, {from,to}).ok, false);
  enterRiverSpace(s, k, "water", location); assert.equal(validatePublicMove(s, {from,to}).ok, true, type);
 }
 const s = gameState([revealed("cannon", "red", "cannon", 0, 7), revealed("screen", "red", "pawn", 0, 6), revealed("target", "black", "pawn", 0, 5)]), k = secretState();
 assert.equal(validatePublicMove(s, move({x:0,y:7},{x:0,y:5})).ok, true);
 enterRiverSpace(s,k,"screen",location); assert.equal(validatePublicMove(s, move({x:0,y:7},{x:0,y:5})).ok, false);
});

test("R4-RIVER-06 河道目标不被普通进攻与路径碾碎读取", () => {
 const s = initializeFeatureGameState(gameState([revealed("rook", "red", "rook", 0, 7), revealed("water", "black", "pawn", 0, 6), revealed("target", "black", "pawn", 0, 5)]), undefined, "war_chariot"), k = secretState();
 enterRiverSpace(s,k,"water",location);
 const r = applyAuthoritativeMove(s,k,move({x:0,y:7},{x:0,y:5}));
 assert.ok(r.state.pieces.some(p => p.id === "water" && isRiver(p))); assert.deepEqual(r.state.captured.map(p => p.id), ["target"]);
});

test("R4-RIVER-07 河道棋不形成棋盘将军；存活河道将帅不读旧锚点受攻击", () => {
 const s = gameState([revealed("threat", "black", "rook", 3, 5)]), k = secretState();
 assert.equal(isGeneralInCheck(s,"red"), true);
 enterRiverSpace(s,k,"threat",location); assert.equal(isGeneralInCheck(s,"red"), false);
 s.pieces.push(revealed("other", "black", "rook", 3, 5));
 enterRiverSpace(s,k,"red-general",location); assert.equal(isGeneralInCheck(s,"red"), false);
});

test("R4-RIVER-08 既有陷阱、亡魂、扭曲落位与回合末不读取河道棋", () => {
 const s = initializeFeatureGameState(gameState([revealed("water", "red", "rook", 0, 7)]), { red:"nozdormu", black:"hunter" }), k = secretState();
 enterRiverSpace(s,k,"water",location);
 k.traps=[{id:"trap",owner:"black",position:{x:0,y:7},opponentTurnsRemaining:8}];
 s.warps=[{x:0,y:7}]; s.ghosts=[{owner:"black",position:{x:0,y:7},remaining:3}];
 queueLanding(s,s.pieces[2],"red","ordinary");settleLandings(s,k);
 assert.equal(k.traps.length,1); assert.equal(s.effectsByPieceId?.water?.timeCollapse,undefined);
 s.effectsByPieceId={water:{barrier:{owner:"black",enemyTurnsRemaining:3},timeCollapse:{expiresAtOwnerTurnEnd:0}}};
 finishFormalTurn(s,k,"red");
 assert.ok(s.pieces.some(p=>p.id==="water"));assert.equal(s.effectsByPieceId.water.barrier!.enemyTurnsRemaining,3);assert.equal(s.effectsByPieceId.water.infection,undefined);
});

test("R4-RIVER-09 出河恢复地面再触发陷阱；占位或堡垒冲突不自动窒息", () => {
 const s = gameState([revealed("water","red","rook",0,7),revealed("block","black","pawn",1,7)]),k=secretState();enterRiverSpace(s,k,"water",location);
 assert.equal(leaveRiverSpace(s,k,"water",{x:1,y:7},"confirmed_leave"),false);assert.ok(isRiver(s.pieces[2]));assert.equal(s.captured.length,0);
 k.traps=[{id:"trap",owner:"black",position:{x:2,y:7},opponentTurnsRemaining:8}];
 assert.equal(leaveRiverSpace(s,k,"water",{x:2,y:7},"confirmed_leave"),true);assert.equal(s.pieces.some(p=>p.id==="water"),false);assert.equal(s.captured[0].cause,"trap_ambush");
 const f=initializeFeatureGameState(gameState([revealed("water","red","rook",0,7)]),undefined,"iron_wall");enterRiverSpace(f,secretState(),"water",location);assert.equal(leaveRiverSpace(f,secretState(),"water",{x:4,y:1},"confirmed_leave"),false);
});

test("R4-RIVER-10 暗置河道身份与控制须由来源定义，不读真实身份或旧棋位", () => {
 const s=gameState([covered("dark",0,6)]),k=secretState({dark:{color:"black",type:"horse"}});const before=structuredClone({s,k});
 assert.throws(()=>enterRiverSpace(s,k,"dark",location),e=>e.code==="UNDEFINED_RIVER_CONTROL");assert.deepEqual({s,k},before);
 const defined={...location,coveredIdentity:{type:"cannon" as const,controller:"red" as const}};
 enterRiverSpace(s,k,"dark",defined);const p=s.pieces[2];assert.equal(getCurrentPieceType(p),"cannon");assert.equal(getController(p),"red");assert.deepEqual(k.identities.dark,{color:"black",type:"horse"});assert.equal(p.faceDown,true);
 assert.equal(leaveRiverSpace(s,k,"dark",{x:0,y:6},"confirmed_leave"),true);assert.equal(getCurrentPieceType(p),"pawn");assert.equal(p.river,undefined);
});

test("R4-RIVER-11 全场毁灭与讳言随机池默认排除河道棋，不能读取未定义暗身份", () => {
 const s=initializeFeatureGameState(gameState([covered("river-dark",0,6),revealed("board","black","pawn",0,3)]),{red:"deathwing"}),k=secretState({"river-dark":{color:"red",type:"horse"}});
 s.pieces[2].layer="river";s.pieces[2].river=location;
 let rolls=0;const r=applyHeroAbility(s,k,skill("destruction",s),0,max=>{rolls++;return 0;});assert.equal(rolls,1);assert.deepEqual(r.state.captured.map(p=>p.id),["board"]);assert.ok(r.state.pieces.some(p=>p.id==="river-dark"));
 const t=initializeFeatureGameState(gameState([revealed("water","black","rook",0,7),revealed("board","black","pawn",0,3)]),{red:"devout_zealot"});t.heroRuntime!.red!.invokeCount=4;enterRiverSpace(t,secretState(),"water",location);
 t.heroRuntime!.red!.omen=true;beginFormalTurn(t,secretState(),()=>0);assert.deepEqual(t.captured.map(p=>p.id),["board"]);
});

test("R4-RIVER-12 风的明/暗承载池与混乱开始刷新默认排除河道棋", () => {
 const s=initializeFeatureGameState(gameState([revealed("water","red","rook",0,7),covered("dark",0,6)]),{red:"wind"},"chaos"),k=secretState({dark:{color:"red",type:"horse"}});
 enterRiverSpace(s,k,"water",location);enterRiverSpace(s,k,"dark",{...location,coveredIdentity:{type:"pawn",controller:"red"}});
 assert.equal(getShadowRevealedTargets(s,"red").some(p=>p.id==="water"),false);
 initializeFeatureSecret(s,k);beginFormalTurn(s,k,()=>{throw Error("不能对河道暗棋重掷");});assert.equal(k.identities.dark.color,"red");
 assert.throws(()=>applyHeroAbility(s,k,skill("shadow",s,{randomCovered:true}),0,()=>0),e=>e.code==="INVALID_SHADOW_TARGET");
});

test("R4-RIVER-13 时光之末沙漏不召回河道勇士、不给河道龙补弹", () => {
 const s=initializeFeatureGameState(gameState([revealed("warrior","red","pawn",0,6),revealed("dragon","black","pawn",0,3)]),{red:"nozdormu",black:"murozond"},"end_time"),k=secretState();initializeFeatureSecret(s,k);
 s.effectsByPieceId={dragon:{destiny:"infinite_dragon",ammunition:0}};
 enterRiverSpace(s,k,"warrior",location);enterRiverSpace(s,k,"dragon",location);
 const r=applyHeroAbility(s,k,skill("hourglass",s),0);
 assert.ok(isRiver(r.state.pieces.find(p=>p.id==="warrior")!));assert.equal(r.state.effectsByPieceId?.dragon.ammunition,0);
});

test("R4-RIVER-14 消灭默认无河道权限；明确来源批次只记录河道死亡，不在旧锚点生亡魂", () => {
 const s=initializeFeatureGameState(gameState([revealed("water","black","rook",0,3)]),{black:"death_knight"}),k=secretState();enterRiverSpace(s,k,"water",location);
 assert.equal(destroyPiece(s,k,"water","red","ordinary"),undefined);
 const blocked=destroyPieceBatch(s,k,"blocked","ordinary",[{pieceId:"water",by:"red",cause:"ordinary"}]);assert.deepEqual(blocked.destroyedIds,[]);
 const permitted=destroyPieceBatch(s,k,"allowed","explicit",[{pieceId:"water",by:"red",cause:"explicit"}],access);assert.deepEqual(permitted.destroyedIds,["water"]);
 assert.equal(s.captured[0].position,undefined);assert.deepEqual(s.captured[0].river,location);generateGhosts(s);assert.equal(s.ghosts?.length??0,0);
});

test("R4-RIVER-15 河道状态可公共协议恢复，消费层不创造同格容量或连通规则", () => {
 const s=gameState([revealed("a","red","rook",0,7),revealed("b","black","horse",0,3)]),k=secretState();enterRiverSpace(s,k,"a",location);enterRiverSpace(s,k,"b",location);
 // 基础转换不擅自规定河道容量，来源必须先校验自己的占用规则。
 assert.equal(riverPieces(s,access,{spaceId:location.spaceId,cellId:location.cellId}).length,2);
 const raw=encodeBluetoothEnvelope({v:BLUETOOTH_PROTOCOL_VERSION,type:"snapshot",id:"river",payload:publicStateSnapshot(s)});const restored=parseBluetoothEnvelope<typeof s>(raw).payload;assert.deepEqual(restored,publicStateSnapshot(s));assert.equal(pieceAt(restored,{x:0,y:7}),undefined);assert.deepEqual(getLegalMoves(restored,"a"),[]);assert.equal(raw.includes('"identities"'),false);
});

test("R4-RIVER-16 时间线不把河道目标退回棋盘，投弹不读取河道龙或旧锚点", () => {
 const s=initializeFeatureGameState(gameState([revealed("mover","red","rook",0,7)]),{black:"murozond"}),k=secretState();
 const h=applyAuthoritativeMove(s,k,move({x:0,y:7},{x:0,y:6}));enterRiverSpace(h.state,h.secret,"mover",location);
 const before=structuredClone(h);assert.throws(()=>applyHeroAbility(h.state,h.secret,skill("timeline_twist",h.state,{to:{x:0,y:8}})),e=>e.code==="NO_TARGET");assert.deepEqual(h,before);
 const t=initializeFeatureGameState(gameState([revealed("dragon","red","pawn",0,6),revealed("water","black","rook",1,6)]),{red:"murozond",black:"nozdormu"},"end_time"),q=secretState();initializeFeatureSecret(t,q);t.effectsByPieceId={dragon:{destiny:"infinite_dragon",ammunition:1}};
 enterRiverSpace(t,q,"water",location);const r=applyHeroAbility(t,q,skill("bomb",t,{pieceId:"dragon",to:{x:1,y:6}}),0);assert.equal(r.state.effectsByPieceId?.water?.timeCollapse,undefined);assert.ok(isRiver(r.state.pieces.find(p=>p.id==="water")!));
 enterRiverSpace(t,q,"dragon",location);assert.throws(()=>applyHeroAbility(t,q,skill("bomb",t,{pieceId:"dragon",to:{x:1,y:6}}),0),e=>e.code==="INVALID_BOMBER");
});

test("R4-RIVER-17 风归位不能把河道承载者拉回普通棋盘；出河允许与空中层共存", () => {
 const s=initializeFeatureGameState(gameState([revealed("host","red","rook",0,7),{...revealed("air","black","horse",2,7),layer:"air"}]),{red:"wind"}),k=secretState();initializeFeatureSecret(s,k);k.wind!.red!.hostId="host";
 enterRiverSpace(s,k,"host",location);destroyPiece(s,k,"red-general","black","test");
 assert.equal(resolveWindReturn(s,k),false);assert.ok(isRiver(s.pieces.find(p=>p.id==="host")!));assert.equal(s.captured.length,1);
 assert.equal(leaveRiverSpace(s,k,"host",{x:2,y:7},"source_leave"),true);assert.ok(isGround(s.pieces.find(p=>p.id==="host")!));assert.ok(isFlying(s.pieces.find(p=>p.id==="air")!));
});

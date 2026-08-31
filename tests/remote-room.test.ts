import assert from "node:assert/strict";
import test from "node:test";

import {
  RuleError,
  createRemoteRoom,
  joinRemoteRoom,
  playerRoomView,
  publicRemoteRoom,
  serializePublicRemoteRoom,
  initializeFeatureGameState,
  submitRemoteHeroSelection,
  submitRemoteAssassination,
  submitRemoteMove,
  submitRemoteRps,
  submitRemoteTrapSetup,
} from "../src/index.ts";
import type { RemoteRoom } from "../src/remote-room.ts";
import { gameState, move, revealed, secretState, seededRandomInt } from "./helpers.ts";

function joinedRoom(): RemoteRoom {
  return joinRemoteRoom(
    createRemoteRoom("room-1", "alice", "very-secret-token", 100),
    "bob",
    "very-secret-token",
    200,
  ).room;
}

test("ONLINE-01 邀请口令只能供加入验证，永不进入公开房间", () => {
  const room = joinedRoom();
  const text = serializePublicRemoteRoom(room);
  assert.equal(text.includes("very-secret-token"), false);
  assert.equal(text.includes("inviteTokenHash"), false);
  assert.throws(
    () => joinRemoteRoom(room, "mallory", "wrong-token", 300),
    (error) => error instanceof RuleError && error.code === "INVALID_INVITE",
  );
});

test("ONLINE-02 第二位玩家加入后自动开始秘密猜拳，重复加入幂等", () => {
  const room = joinedRoom();
  assert.equal(room.phase, "rps");
  assert.deepEqual(room.rps?.submitted, { alice: false, bob: false });
  const repeated = joinRemoteRoom(room, "bob", "very-secret-token", 300);
  assert.equal(repeated.alreadyJoined, true);
  assert.equal(repeated.room, room);
  assert.throws(
    () => joinRemoteRoom(room, "mallory", "very-secret-token", 300),
    (error) => error instanceof RuleError && error.code === "ROOM_FULL",
  );
});

test("ONLINE-03 猜拳胜者为红方，红方先走，未决选择不公开", () => {
  const first = submitRemoteRps(
    joinedRoom(),
    "alice",
    "scissors",
    1,
    seededRandomInt(11),
    300,
  );
  assert.equal(JSON.stringify(publicRemoteRoom(first)).includes("scissors"), false);
  const started = submitRemoteRps(
    first,
    "bob",
    "paper",
    1,
    seededRandomInt(11),
    400,
  );
  assert.equal(started.phase, "playing");
  assert.equal(started.game?.players.red, "alice");
  assert.equal(started.game?.state.turn, "red");
});

test("ONLINE-04 云端自动结算裁决，仅公开动画路线和最终状态", () => {
  const room: RemoteRoom = {
    ...joinedRoom(),
    phase: "playing",
    game: {
      players: { red: "alice", black: "bob" },
      state: gameState(
        [
          revealed("left-block", "black", "pawn", 3, 0),
          revealed("right-block", "black", "pawn", 5, 0),
          revealed("checker", "red", "rook", 4, 2),
          revealed("protector", "red", "rook", 4, 3),
          revealed("left-guard", "red", "rook", 3, 1),
          revealed("right-guard", "red", "rook", 5, 1),
        ],
        { redGeneral: { x: 3, y: 9 }, blackGeneral: { x: 4, y: 0 } },
      ),
      secret: secretState(),
    },
  };
  const result = submitRemoteMove(
    room,
    "alice",
    move({ x: 4, y: 2 }, { x: 4, y: 1 }, "mate", 0),
    500,
  );
  assert.equal(result.room.phase, "finished");
  assert.equal(result.room.game?.state.status, "finished");
  assert.equal(result.room.game?.state.reason, "checkmate");
  assert.deepEqual(result.room.terminalAnimation, {
    eventId: "server:mate:terminal",
    reason: "checkmate",
    plan: { pieceId: "checker", from: { x: 4, y: 1 }, to: { x: 4, y: 0 } },
  });
  const publicRoom = publicRemoteRoom(result.room);
  assert.equal(publicRoom.state?.pieces.some((piece) => piece.id === "black-general"), false);
  assert.equal(JSON.stringify(publicRoom).includes("identities"), false);
  assert.equal(publicRoom.phase, "finished");
});

test("ONLINE-05 客户端不能伪造服务端专用终局操作 ID", () => {
  const started = submitRemoteRps(
    submitRemoteRps(joinedRoom(), "alice", "rock", 1, seededRandomInt(3), 300),
    "bob",
    "scissors",
    1,
    seededRandomInt(3),
    400,
  );
  assert.throws(
    () => submitRemoteMove(started, "alice", move({ x: 0, y: 6 }, { x: 0, y: 5 }, "server:fake", 0)),
    (error) => error instanceof RuleError && error.code === "RESERVED_ACTION",
  );
});

test("MODE-01 双方锁定英雄前只公开锁定状态，本人可恢复自己的选择", () => {
  const room = joinedRoom();
  const rpsFirst = submitRemoteRps(room, "alice", "scissors", 1, seededRandomInt(5), 300);
  const selecting = submitRemoteRps(rpsFirst, "bob", "paper", 1, seededRandomInt(5), 400);
  assert.equal(selecting.phase, "playing");

  const heroRoom = joinRemoteRoom(
    createRemoteRoom(
      "hero-room",
      "alice",
      "token",
      100,
      { heroesEnabled: true, mutationsEnabled: true },
    ),
    "bob",
    "token",
    200,
  ).room;
  const heroRpsFirst = submitRemoteRps(heroRoom, "alice", "scissors", 1, seededRandomInt(5), 300);
  const selectingHeroes = submitRemoteRps(heroRpsFirst, "bob", "paper", 1, seededRandomInt(5), 400);
  assert.equal(selectingHeroes.phase, "hero_selection");

  const aliceLocked = submitRemoteHeroSelection(
    selectingHeroes,
    "alice",
    "hunter",
    seededRandomInt(5),
    500,
  );
  const shared = publicRemoteRoom(aliceLocked);
  assert.deepEqual(shared.features?.heroSelection?.locked, { red: true, black: false });
  assert.equal(JSON.stringify(shared).includes("hunter"), false);
  assert.equal(playerRoomView(aliceLocked, "alice").ownHeroChoice, "hunter");
  assert.equal(playerRoomView(aliceLocked, "bob").ownHeroChoice, undefined);
});

test("MODE-02 英雄公开后抽取唯一畸变，双猎人秘密布置后才进入走棋", () => {
  const fixedZero = (_maxExclusive: number) => 0;
  const rpsFirst = submitRemoteRps(
    joinRemoteRoom(
      createRemoteRoom(
        "setup-room",
        "alice",
        "token",
        100,
        { heroesEnabled: true, mutationsEnabled: true },
      ),
      "bob",
      "token",
      200,
    ).room,
    "alice",
    "rock",
    1,
    fixedZero,
    300,
  );
  const selecting = submitRemoteRps(rpsFirst, "bob", "scissors", 1, fixedZero, 400);
  const aliceHero = submitRemoteHeroSelection(selecting, "alice", "hunter", fixedZero, 500);
  const setup = submitRemoteHeroSelection(aliceHero, "bob", "hunter", fixedZero, 600);
  assert.equal(setup.phase, "trap_setup");
  assert.equal(setup.features?.mutation, "iron_steed");
  assert.deepEqual(setup.features?.heroes, { red: "hunter", black: "hunter" });

  const redSet = submitRemoteTrapSetup(setup, "alice", [{ x: 0, y: 6 }, { x: 0, y: 6 }], 700);
  assert.equal(redSet.phase, "trap_setup");
  assert.deepEqual(redSet.features?.trapSetup?.submitted, { red: true });
  const sharedAfterTrap = JSON.stringify(publicRemoteRoom(redSet));
  assert.equal(sharedAfterTrap.includes("trap:red"), false);
  assert.equal(sharedAfterTrap.includes("opponentTurnsRemaining"), false);
  assert.deepEqual(playerRoomView(redSet, "alice").ownTraps?.map((trap) => trap.position), [
    { x: 0, y: 6 },
    { x: 0, y: 6 },
  ]);
  assert.deepEqual(playerRoomView(redSet, "bob").ownTraps, []);

  const started = submitRemoteTrapSetup(redSet, "bob", [{ x: 8, y: 3 }, { x: 4, y: 3 }], 800);
  assert.equal(started.phase, "playing");
  assert.equal(started.features?.trapSetup, undefined);
  assert.equal(playerRoomView(started, "bob").ownTraps?.length, 2);
});

test("MODE-03 非猎人和越界坐标不能布置陷阱", () => {
  const rpsFirst = submitRemoteRps(
    joinRemoteRoom(
      createRemoteRoom(
        "trap-validation",
        "alice",
        "token",
        100,
        { heroesEnabled: true },
      ),
      "bob",
      "token",
      200,
    ).room,
    "alice",
    "rock",
    1,
    seededRandomInt(1),
    300,
  );
  const selecting = submitRemoteRps(rpsFirst, "bob", "scissors", 1, seededRandomInt(1), 400);
  const aliceHero = submitRemoteHeroSelection(selecting, "alice", "hunter", seededRandomInt(1), 500);
  const setup = submitRemoteHeroSelection(aliceHero, "bob", "rogue", seededRandomInt(1), 600);
  assert.throws(
    () => submitRemoteTrapSetup(setup, "bob", [{ x: 0, y: 3 }, { x: 2, y: 3 }], 700),
    (error) => error instanceof RuleError && error.code === "NOT_HUNTER",
  );
  assert.throws(
    () => submitRemoteTrapSetup(setup, "alice", [{ x: 0, y: 3 }, { x: 2, y: 3 }], 700),
    (error) => error instanceof RuleError && error.code === "INVALID_TRAP_POSITION",
  );
});

test("MODE-04 联机刺杀经房间事务结算，公开状态同步技能次数与隐身标记", () => {
  const room: RemoteRoom = {
    ...joinedRoom(),
    phase: "playing",
    features: { heroes: { red: "rogue", black: "warrior" }, mutation: "shadow_dance" },
    game: {
      players: { red: "alice", black: "bob" },
      state: initializeFeatureGameState(
        gameState([revealed("rogue-rook", "red", "rook", 0, 7)]),
        { red: "rogue", black: "warrior" },
        "shadow_dance",
      ),
      secret: secretState(),
    },
  };
  const result = submitRemoteAssassination(
    room,
    "alice",
    {
      kind: "assassination",
      from: { x: 0, y: 7 },
      to: { x: 0, y: 6 },
      source: "hero",
      useStrongStrike: false,
      actionId: "remote-rogue",
      expectedRevision: 0,
    },
    500,
  );
  assert.equal(result.duplicate, false);
  const state = publicRemoteRoom(result.room).state;
  assert.equal(state?.assassination?.red.heroChargeAvailable, false);
  assert.equal(state?.assassination?.red.mutationChargeAvailable, true);
  assert.equal(state?.effectsByPieceId?.["rogue-rook"]?.stealth?.remainingOwnerTurns, 2);
});

test("HUNTER-01 敌方落点触发一层陷阱，公开触发结果而不公开剩余坐标", () => {
  const room: RemoteRoom = {
    ...joinedRoom(),
    phase: "playing",
    features: { heroes: { red: "rogue", black: "hunter" } },
    featureSecret: { traps: [
      { id: "trap:black:0", owner: "black", position: { x: 0, y: 6 }, opponentTurnsRemaining: 10 },
      { id: "trap:black:1", owner: "black", position: { x: 8, y: 6 }, opponentTurnsRemaining: 10 },
    ] },
    game: {
      players: { red: "alice", black: "bob" },
      state: gameState([revealed("victim", "red", "rook", 0, 7)]),
      secret: secretState(),
    },
  };
  const result = submitRemoteMove(room, "alice", move({ x: 0, y: 7 }, { x: 0, y: 6 }, "trap-step", 0));
  assert.equal(result.room.game?.state.pieces.some((piece) => piece.id === "victim"), false);
  assert.deepEqual(result.room.lastTrapTrigger, {
    actionId: "trap-step",
    trapId: "trap:black:0", owner: "black", victimPieceId: "victim", position: { x: 0, y: 6 },
  });
  assert.equal(result.room.featureSecret?.traps.length, 1);
  assert.equal(JSON.stringify(publicRemoteRoom(result.room)).includes("trap:black:1"), false);
});

test("HUNTER-02 第十个敌方正式回合结束后未触发陷阱失效", () => {
  const room: RemoteRoom = {
    ...joinedRoom(), phase: "playing", features: { heroes: { red: "rogue", black: "hunter" } },
    featureSecret: { traps: [{ id: "trap:black:0", owner: "black", position: { x: 8, y: 6 }, opponentTurnsRemaining: 1 }] },
    game: { players: { red: "alice", black: "bob" }, state: gameState([revealed("red-rook", "red", "rook", 0, 7)]), secret: secretState() },
  };
  const result = submitRemoteMove(room, "alice", move({ x: 0, y: 7 }, { x: 0, y: 6 }, "expire", 0));
  assert.deepEqual(result.room.featureSecret?.traps, []);
});

test("HUNTER-03 将帅踏入敌方陷阱时直接以伏击结束", () => {
  const room: RemoteRoom = {
    ...joinedRoom(), phase: "playing", features: { heroes: { red: "hunter", black: "hunter" } },
    featureSecret: { traps: [{ id: "trap:black:0", owner: "black", position: { x: 4, y: 8 }, opponentTurnsRemaining: 10 }] },
    game: { players: { red: "alice", black: "bob" }, state: gameState([], { redGeneral: { x: 4, y: 9 } }), secret: secretState() },
  };
  const result = submitRemoteMove(room, "alice", move({ x: 4, y: 9 }, { x: 4, y: 8 }, "general-trap", 0));
  assert.equal(result.room.phase, "finished");
  assert.equal(result.room.game?.state.reason, "trap_ambush");
  assert.equal(result.room.game?.state.winner, "black");
});

test("HUNTER-04 撞上普通防御被弹回不触发起点陷阱，但仍消耗一个正式敌方回合", () => {
  const room: RemoteRoom = {
    ...joinedRoom(), phase: "playing", features: { heroes: { red: "rogue", black: "hunter" } },
    featureSecret: { traps: [{ id: "trap:black:0", owner: "black", position: { x: 0, y: 7 }, opponentTurnsRemaining: 10 }] },
    game: {
      players: { red: "alice", black: "bob" },
      state: initializeFeatureGameState(gameState([
        revealed("attacker", "red", "rook", 0, 7),
        revealed("guard", "black", "rook", 0, 6),
      ]), { red: "rogue", black: "hunter" }),
      secret: secretState(),
    },
  };
  room.game.state.effectsByPieceId = { guard: { barrier: { owner: "black", enemyHalfEntered: false, movesAfterEnemyHalfEntry: 0 } } };
  const result = submitRemoteMove(room, "alice", move({ x: 0, y: 7 }, { x: 0, y: 6 }, "bounce-trap", 0));
  assert.equal(result.room.lastTrapTrigger, undefined);
  assert.equal(result.room.game?.state.pieces.some((piece) => piece.id === "attacker"), true);
  assert.equal(result.room.featureSecret?.traps[0]?.opponentTurnsRemaining, 9);
});

test("HUNTER-05 战士铁甲后的额外应将不消耗陷阱回合", () => {
  const room: RemoteRoom = {
    ...joinedRoom(), phase: "playing", features: { heroes: { red: "warrior", black: "hunter" } },
    featureSecret: { traps: [] },
    game: {
      players: { red: "alice", black: "bob" },
      state: initializeFeatureGameState(gameState([
        { id: "turncoat", x: 4, y: 6, faceDown: true },
      ], { redGeneral: { x: 4, y: 9 } }), { red: "warrior", black: "hunter" }),
      secret: secretState({ turncoat: { color: "black", type: "rook" } }),
    },
  };
  const backstab = submitRemoteMove(room, "alice", move({ x: 4, y: 6 }, { x: 4, y: 5 }, "backstab", 0));
  const roomWithFreshTrap: RemoteRoom = {
    ...backstab.room,
    featureSecret: { traps: [{ id: "trap:black:late", owner: "black", position: { x: 0, y: 6 }, opponentTurnsRemaining: 1 }] },
  };
  const defended = submitRemoteMove(roomWithFreshTrap, "alice", move({ x: 4, y: 9 }, { x: 3, y: 9 }, "defend", 1));
  assert.equal(defended.room.game?.state.turn, "black");
  assert.equal(defended.room.game?.state.lastMove?.countsAsFormalTurn, false);
  assert.equal(defended.room.featureSecret?.traps[0]?.opponentTurnsRemaining, 1);
});

test("HUNTER-06 同格叠层一次只触发一层，其余层照常扣除本次敌方回合", () => {
  const room: RemoteRoom = {
    ...joinedRoom(), phase: "playing", features: { heroes: { red: "rogue", black: "hunter" } },
    featureSecret: { traps: [
      { id: "trap:black:0", owner: "black", position: { x: 0, y: 6 }, opponentTurnsRemaining: 10 },
      { id: "trap:black:1", owner: "black", position: { x: 0, y: 6 }, opponentTurnsRemaining: 10 },
    ] },
    game: { players: { red: "alice", black: "bob" }, state: gameState([revealed("victim", "red", "rook", 0, 7)]), secret: secretState() },
  };
  const result = submitRemoteMove(room, "alice", move({ x: 0, y: 7 }, { x: 0, y: 6 }, "stacked", 0));
  assert.equal(result.room.featureSecret?.traps.length, 1);
  assert.equal(result.room.featureSecret?.traps[0]?.id, "trap:black:1");
  assert.equal(result.room.featureSecret?.traps[0]?.opponentTurnsRemaining, 9);
});

test("HUNTER-07 暗子翻成陷阱主人控制的棋子时不触发，用于避免低成本验身", () => {
  const room: RemoteRoom = {
    ...joinedRoom(), phase: "playing", features: { heroes: { red: "rogue", black: "hunter" } },
    featureSecret: { traps: [{ id: "trap:black:0", owner: "black", position: { x: 0, y: 5 }, opponentTurnsRemaining: 10 }] },
    game: {
      players: { red: "alice", black: "bob" },
      state: gameState([{ id: "turncoat", x: 0, y: 6, faceDown: true }]),
      secret: secretState({ turncoat: { color: "black", type: "rook" } }),
    },
  };
  const result = submitRemoteMove(room, "alice", move({ x: 0, y: 6 }, { x: 0, y: 5 }, "switch-control", 0));
  assert.equal(result.room.lastTrapTrigger, undefined);
  assert.equal(result.room.game?.state.pieces.some((piece) => piece.id === "turncoat"), true);
  assert.equal(result.room.featureSecret?.traps[0]?.opponentTurnsRemaining, 9);
});

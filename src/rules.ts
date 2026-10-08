import { strongBladeSide } from "./hero-progress.ts";
import { selectedHeroId, validateHeroForms } from "./hero-forms.ts";
import { isBoardPiece, isGround, isRiver } from "./spaces.ts";
import {
  getController,
  getCurrentPieceType,
  getMovementIdentity,
  isAcrossRiver,
  isInPalace,
  isInsideBoard,
  otherSide,
} from "./slots.ts";
import type {
  GameState,
  MoveCommand,
  MoveValidation,
  PieceType,
  Position,
  PublicPiece,
  RevealedPiece,
  Side,
} from "./types.ts";

type MoveLike = Pick<MoveCommand, "from" | "to" | "pieceId">;

export interface PublicMoveOptions {
  allowStealthSource?: boolean;
  allowStealthTarget?: boolean;
  requireCapture?: boolean;
  allowGeneralTarget?: boolean;
  allowIntermediateCheck?: boolean;
  /** 权威来源的当前连带操控；不删除下一正式主行动的控制陷阱或强制降落。 */
  allowLinkedControl?: boolean;
  stormAssault?: boolean;
}

export function samePosition(first: Position, second: Position): boolean {
  return !isRiver(first) && !isRiver(second) && first.x === second.x && first.y === second.y;
}

export function pieceAt(
  state: Pick<GameState, "pieces">,
  position: Position,
): PublicPiece | undefined {
  return state.pieces.find((piece) => isGround(piece) && samePosition(piece, position));
}

export function pieceById(
  state: Pick<GameState, "pieces">,
  pieceId: string,
): PublicPiece | undefined {
  return state.pieces.find((piece) => piece.id === pieceId);
}

export function hasStealthEffect(
  state: Pick<GameState, "effectsByPieceId">,
  pieceId: string,
): boolean {
  return Boolean(state.effectsByPieceId?.[pieceId]?.stealth || state.effectsByPieceId?.[pieceId]?.intangible);
}

function blocksPath(
  state: Pick<GameState, "pieces" | "effectsByPieceId">,
  position: Position,
  layer?: "air" | "river",
): boolean {
  const piece = layer === "air" ? state.pieces.find(p => p.layer === "air" && samePosition(p, position)) : pieceAt(state, position);
  return Boolean(piece);
}

function countPiecesBetween(
  state: Pick<GameState, "pieces" | "effectsByPieceId">,
  from: Position,
  to: Position,
): number | undefined {
  const dx = Math.sign(to.x - from.x);
  const dy = Math.sign(to.y - from.y);
  if (dx !== 0 && dy !== 0) return undefined;
  if (dx === 0 && dy === 0) return undefined;

  let count = 0;
  let x = from.x + dx;
  let y = from.y + dy;
  while (x !== to.x || y !== to.y) {
    if (blocksPath(state, { x, y }, (from as PublicPiece).layer)) count += 1;
    x += dx;
    y += dy;
  }
  return count;
}

function isGeneralTarget(
  state: Pick<GameState, "pieces" | "effectsByPieceId">,
  position: Position,
): boolean {
  const target = pieceAt(state, position);
  return Boolean(
    target && !target.faceDown && target.type === "general",
  );
}

function movementGeometryLegal(
  state: Pick<GameState, "pieces" | "effectsByPieceId" | "featureRules" | "gameMode">,
  piece: PublicPiece,
  to: Position,
  forAttack = false,
  stormAssault = false,
): boolean {
  if (!isBoardPiece(piece) || !isInsideBoard(to) || samePosition(piece, to)) return false;

  const { side, type } = getMovementIdentity(piece);
  const mutation = state.featureRules?.mutation;
  const dx = to.x - piece.x;
  const dy = to.y - piece.y;
  const absX = Math.abs(dx);
  const absY = Math.abs(dy);

  if (mutation === "cavalry" && !piece.faceDown && type === "horse") {
    const forward = side === "red" ? -1 : 1;
    if (dx === 0 && dy === forward || isAcrossRiver(piece, side) && absX === 1 && dy === 0) return true;
  }

  switch (type) {
    case "storm_elemental": {
      const distance = Math.max(absX, absY);
      if (!(dx === 0 || dy === 0 || absX === absY) || distance < 1 || distance > (stormAssault ? 2 : 1)) return false;
      return distance === 1 || !blocksPath(state, { x: piece.x + Math.sign(dx), y: piece.y + Math.sign(dy) });
    }
    case "rook": {
      const between = countPiecesBetween(state, piece, to);
      if (between === 0) return true;
      // 战车只能指定实际目标；路径中恰好一枚非隐身棋时由结算层碾碎它。
      return state.featureRules?.mutation === "war_chariot" && Boolean(pieceAt(state, to)) && between === 1;
    }

    case "horse": {
      if (!((absX === 2 && absY === 1) || (absX === 1 && absY === 2))) {
        return false;
      }
      const leg =
        absX === 2
          ? { x: piece.x + Math.sign(dx), y: piece.y }
          : { x: piece.x, y: piece.y + Math.sign(dy) };
      return mutation === "iron_steed" || !blocksPath(state, leg, piece.layer);
    }

    case "cannon": {
      const between = countPiecesBetween(state, piece, to);
      if (between === undefined) return false;
      const occupied = piece.layer !== "air" && Boolean(pieceAt(state, to));
      return occupied || forAttack ? between === 1 : between === 0;
    }

    case "pawn": {
      const forward = side === "red" ? -1 : 1;
      if (dx === 0 && dy === forward) return true;
      if (isAcrossRiver(piece, side) && absX === 1 && (mutation === "jian_xie" ? dy === forward : dy === 0)) return true;
      return false;
    }

    case "general": {
      if (mutation === "expedition") {
        const between = countPiecesBetween(state, piece, to);
        return between === 0;
      }
      if (
        forAttack &&
        dx === 0 &&
        isGeneralTarget(state, to) &&
        countPiecesBetween(state, piece, to) === 0
      ) {
        return true;
      }
      return absX + absY === 1 && isInPalace(to, side);
    }

    case "advisor": {
      if (absX !== 1 || absY !== 1) return false;
      return piece.faceDown || state.gameMode === "xiangqi" ? isInPalace(to, side) : true;
    }

    case "elephant": {
      if (absX !== 2 || absY !== 2) return false;
      if (state.gameMode === "xiangqi" && isAcrossRiver(to, side)) return false;
      const eye = { x: piece.x + dx / 2, y: piece.y + dy / 2 };
      return !blocksPath(state, eye, piece.layer);
    }

    default: {
      const exhaustive: never = type;
      return exhaustive;
    }
  }
}

function targetEligible(
  state: Pick<GameState, "pieces" | "effectsByPieceId" | "featureRules" | "heroFormLock">,
  source: PublicPiece,
  to: Position,
  options: PublicMoveOptions = {},
): boolean {
  if (source.layer === "air") return !state.pieces.some(p => p.layer === "air" && samePosition(p, to));
  const target = source.layer === "air" ? undefined : pieceAt(state, to);
  if (!target) return true;
  if (hasStealthEffect(state, target.id) && !options.allowStealthTarget) return false;
  // 自残只限暗子：暗子身份未知，始终可吃；己方已揭明子不可吃。
  if (target.faceDown) return true;
  if (target.type === "general") {
    if (options.allowGeneralTarget && selectedHeroId(state, target.color) === "wind") return false;
    if (options.allowGeneralTarget) return getController(target) !== getController(source);
    // 战车的隔子冲锋是路径碾碎终局的唯一例外：允许把敌将帅作为终点，
    // 以便与路径上的己方将帅形成两败俱伤。
    return state.featureRules?.mutation === "war_chariot" && getCurrentPieceType(source) === "rook" && getController(target) !== getController(source);
  }
  return getController(target) !== getController(source);
}

export function getPseudoMoves(
  state: GameState,
  pieceId: string,
): Position[] {
  validateHeroForms(state);
  const source = pieceById(state, pieceId);
  if (!source || !isBoardPiece(source)) return [];
  const result: Position[] = [];
  for (let y = 0; y <= 9; y += 1) {
    for (let x = 0; x <= 8; x += 1) {
      const to = { x, y };
      if (
        targetEligible(state, source, to) &&
        movementGeometryLegal(state, source, to)
      ) {
        result.push(to);
      }
    }
  }
  return result;
}

export function canRevealedPieceAttack(
  state: Pick<GameState, "pieces" | "effectsByPieceId" | "featureRules" | "heroFormLock">,
  piece: RevealedPiece,
  position: Position,
): boolean {
  validateHeroForms(state);
  // 潜行者来源无形不产生有效将军；一般无形仅限制直接选取。
  if (!isGround(piece) || isRiver(position) || state.effectsByPieceId?.[piece.id]?.stealth) return false;
  if (princeProtects(state as GameState, otherSide(piece.color)) && ownHalf(otherSide(piece.color), piece)) return false;
  if (hasStealthEffect(state, pieceAt(state, position)?.id ?? "")) return false;
  if (state.featureRules?.mutation === "war_chariot" && getCurrentPieceType(piece) === "rook") {
    const ownGeneral = state.pieces.find(p => isGround(p) && !p.faceDown && p.color === piece.color && p.type === "general");
    const dx = Math.sign(position.x - piece.x), dy = Math.sign(position.y - piece.y);
    if (ownGeneral && countPiecesBetween(state, piece, position) === 1 &&
      (dx === 0 && ownGeneral.x === piece.x && (ownGeneral.y - piece.y) * dy > 0 && (position.y - ownGeneral.y) * dy > 0 ||
       dy === 0 && ownGeneral.y === piece.y && (ownGeneral.x - piece.x) * dx > 0 && (position.x - ownGeneral.x) * dx > 0)) return false;
  }
  if (state.featureRules?.mutation === "iron_steed" && getCurrentPieceType(piece) === "horse") {
    const dx = position.x - piece.x;
    const dy = position.y - piece.y;
    // 敌将帅处在马腿格时，只要该方向至少有一个可完成的日字落点，
    // 铁马即可在路径上碾碎它，构成有效将军。
    if ((Math.abs(dx) === 1 && dy === 0) || (dx === 0 && Math.abs(dy) === 1)) {
      const endpoints = Math.abs(dx) === 1
        ? [{ x: piece.x + dx, y: piece.y - 2 }, { x: piece.x + dx, y: piece.y + 2 }]
        : [{ x: piece.x - 2, y: piece.y + dy }, { x: piece.x + 2, y: piece.y + dy }];
      return endpoints.some((endpoint) => {
        if (!isInsideBoard(endpoint)) return false;
        const landing = pieceAt(state, endpoint);
        if (!landing) return true;
        if (hasStealthEffect(state, landing.id)) return false;
        if (landing.faceDown) return true;
        return getController(landing) !== getController(piece);
      });
    }
  }
  return movementGeometryLegal(state, piece, position, true);
}

export function isSquareAttacked(
  state: Pick<GameState, "pieces" | "effectsByPieceId" | "featureRules" | "heroFormLock">,
  position: Position,
  bySide: Side,
): boolean {
  return state.pieces.some((piece) => {
    if (piece.faceDown || piece.color !== bySide) return false;
    return canRevealedPieceAttack(state, piece, position);
  });
}

export function findGeneral(
  state: Pick<GameState, "pieces" | "effectsByPieceId" | "featureRules" | "heroFormLock">,
  side: Side,
): RevealedPiece {
  const general = state.pieces.find(
    (piece): piece is RevealedPiece =>
      !piece.faceDown && piece.color === side && piece.type === "general",
  );
  if (!general) throw new Error(`找不到${side}方将帅`);
  return general;
}

export function isGeneralInCheck(
  state: Pick<GameState, "pieces" | "effectsByPieceId" | "featureRules" | "heroFormLock">,
  side: Side,
): boolean {
  const general = findGeneral(state, side);
  if (isRiver(general)) return false;
  return isSquareAttacked(state, general, otherSide(side));
}

function simulatePublicMove(
  state: GameState,
  source: PublicPiece,
  to: Position,
): GameState {
  const target = source.layer === "air" ? undefined : pieceAt(state, to);
  if (target && state.effectsByPieceId?.[target.id]?.dragonScale) return state;
  const moved: PublicPiece = { ...source, x: to.x, y: to.y };
  return {
    ...state,
    effectsByPieceId: target
      ? Object.fromEntries(
        Object.entries(state.effectsByPieceId ?? {}).filter(([id]) => id !== target.id),
      )
      : state.effectsByPieceId,
    pieces: [
      ...state.pieces.filter(
        (piece) => piece.id !== source.id && piece.id !== target?.id,
      ),
      moved,
    ],
  };
}

export function validatePublicMove(
  state: GameState,
  move: MoveLike,
  actingSide: Side = state.turn,
  options: PublicMoveOptions = {},
): MoveValidation {
  validateHeroForms(state);
  if (state.status !== "playing") {
    return { ok: false, code: "GAME_FINISHED", message: "对局已经结束" };
  }
  if (state.turn !== actingSide) {
    return { ok: false, code: "WRONG_TURN", message: "还没有轮到该方" };
  }
  if (!isInsideBoard(move.from) || !isInsideBoard(move.to)) {
    return { ok: false, code: "OUT_OF_BOARD", message: "坐标超出棋盘" };
  }
  if (samePosition(move.from, move.to)) {
    return { ok: false, code: "SAME_SQUARE", message: "起点和终点相同" };
  }

  const source = move.pieceId ? pieceById(state, move.pieceId) : pieceAt(state, move.from);
  if (!source) {
    return { ok: false, code: "NO_PIECE", message: "起点没有棋子" };
  }
  if (!isBoardPiece(source)) return { ok: false, code: "RIVER_ACTION_REQUIRED", message: "河道棋须按来源专属规则行动" };
  if (!samePosition(source, move.from)) return { ok: false, code: "INVALID_SOURCE", message: "棋子ID与起点不符" };
  if (getController(source) !== actingSide) {
    return { ok: false, code: "NOT_CONTROLLED", message: "该棋子不由行动方控制" };
  }
  if (!options.allowLinkedControl && state.pieces.some(p => p.layer === "air" && getController(p) === actingSide && state.effectsByPieceId?.[p.id]?.flight?.forcedLanding)) return { ok: false, code: "FORCED_LANDING_REQUIRED", message: "第四个控制方回合必须原地降落" };
  if (selectedHeroId(state, actingSide) === "single_blade" && state.heroRuntime?.[actingSide]?.blade && source.x !== 4 && !strongBladeSide(state, actingSide, source.x) && Math.abs(move.to.x - 4) > Math.abs(source.x - 4)) return { ok: false, code: "WEAK_BLADE_OUTWARD", message: "弱侧普通行动不能离中轴更远" };
  const effects = state.effectsByPieceId?.[source.id];
  const target = source.layer === "air" ? undefined : pieceAt(state, move.to);
  if (!options.allowLinkedControl && effects?.controlTrap && effects.controlTrap.controller === actingSide &&
    effects.controlTrap.blockedFormalTurn === (state.formalTurns?.[actingSide] ?? 0) + 1) {
    return { ok: false, code: "CONTROL_TRAP", message: "该棋下一正式回合被封锁行动" };
  }
  if (source.layer === "air" && options.requireCapture) return { ok: false, code: "FLIGHT_NO_ATTACK", message: "飞行棋不能进攻" };
  if (target && princeProtects(state, otherSide(actingSide)) && (ownHalf(otherSide(actingSide), source) || ownHalf(otherSide(actingSide), move.to))) {
    return { ok: false, code: "CAREFREE", message: "无忧领域阻止此次进攻" };
  }
  if (!target && state.featureRules?.mutation === "end_time" && selectedHeroId(state, actingSide) === "nozdormu" && state.warps?.some(p => samePosition(p, move.to))) {
    return { ok: false, code: "WARP_EMPTY", message: "不能普通移动到空的时空扭曲格" };
  }
  if (state.featureRules?.mutation === "iron_wall") {
    const destinationOwner = actingSide;
    const startsInsideEnemy = isInPalace(move.from, otherSide(destinationOwner));
    const endsInsideEnemy = isInPalace(move.to, otherSide(destinationOwner));
    if (!startsInsideEnemy && endsInsideEnemy) {
      return { ok: false, code: "IRON_WALL", message: "堡垒阻止从九宫外进入敌方九宫" };
    }
  }
  if (hasStealthEffect(state, source.id) && source.layer !== "air" && !options.allowStealthSource) {
    return { ok: false, code: "STEALTH_ACTION_REQUIRED", message: "隐身棋必须通过刺杀行动移动" };
  }
  if (!targetEligible(state, source, move.to, options)) {
    return { ok: false, code: "ILLEGAL_TARGET", message: "目标棋子不可吃" };
  }
  if (options.requireCapture && !pieceAt(state, move.to)) {
    return { ok: false, code: "STRONG_STRIKE_NEEDS_TARGET", message: "强击必须选择一个目标棋子" };
  }
  if (!movementGeometryLegal(state, source, move.to, false, options.stormAssault)) {
    return { ok: false, code: "ILLEGAL_MOVEMENT", message: "棋子走法不合法" };
  }

  const simulated = simulatePublicMove(state, source, move.to);
  if (!options.allowIntermediateCheck && isGeneralInCheck(simulated, actingSide)) {
    return { ok: false, code: "SELF_CHECK", message: "该步会令己方将帅受攻击" };
  }

  return { ok: true };
}

export function getLegalMoves(
  state: GameState,
  pieceId: string,
  actingSide: Side = state.turn,
  options: PublicMoveOptions = {},
): Position[] {
  validateHeroForms(state);
  const source = pieceById(state, pieceId);
  if (!source || !isBoardPiece(source) || getController(source) !== actingSide) return [];
  return getPseudoMoves(state, pieceId).filter(
    (to) => validatePublicMove(state, { from: source, to, pieceId: source.id }, actingSide, options).ok,
  );
}

/** Candidate markers for the client when it is composing a server-authoritative
 * assassination command.  Final source/charge checks stay in game.ts. */
export function getLegalAssassinationMoves(
  state: GameState,
  pieceId: string,
  useStrongStrike: boolean,
  actingSide: Side = state.turn,
): Position[] {
  validateHeroForms(state);
  const source = pieceById(state, pieceId);
  if (!source || !isBoardPiece(source) || getController(source) !== actingSide) return [];
  if (source.faceDown || source.type === "general") return [];
  const activePieceId = state.assassination?.[actingSide]?.activePieceId;
  const continuing = activePieceId === source.id;
  if (activePieceId && !continuing) return [];
  const legal: Position[] = [];
  for (let y = 0; y <= 9; y += 1) {
    for (let x = 0; x <= 8; x += 1) {
      const to = { x, y };
      const target = pieceAt(state, to);
      if (!continuing && useStrongStrike) continue;
      if (useStrongStrike && (!target || !target.faceDown && target.type === "general")) continue;
      if (validatePublicMove(state, { from: source, to }, actingSide, {
        allowStealthSource: hasStealthEffect(state, source.id),
        allowStealthTarget: useStrongStrike,
        allowGeneralTarget: false,
        requireCapture: useStrongStrike,
      }).ok) legal.push(to);
    }
  }
  return legal;
}

export function hasAnyLegalMove(state: GameState, side: Side): boolean {
  // 已确认的占步技能与强制降落也是正式主行动机会；不能先按普通走子裁定困毙。
  const hero = selectedHeroId(state, side), runtime = state.heroRuntime?.[side];
  if (state.pieces.some(p => p.layer === "air" && getController(p) === side && state.effectsByPieceId?.[p.id]?.flight?.source === "sky_admiral")) return true;
  if (hero === "deathwing" && !runtime?.used) return true;
  if (hero === "devout_zealot" && (runtime?.invokeCount ?? 0) < 4 && !isGeneralInCheck(state, side)) return true;
  if (hero === "warlock" && !runtime?.used && state.pieces.some(p => isBoardPiece(p) && getController(p) === side)) return true;
  const selection = state.featureRules?.heroSelections?.[side];
  if (selection?.heroId === "death_knight" && selection.form === "inner" && !runtime?.used) return true;
  if (selection?.heroId === "jiang_he" && (selection.form === "front" || !runtime?.used) && state.pieces.some(p => getController(p) === side && (isRiver(p) || isGround(p) && [4,5].includes(p.y) && state.effectsByPieceId?.[p.id]?.riverQualified))) return true;

  const stateForSide: GameState = { ...state, status: "playing", turn: side };
  return stateForSide.pieces.some(
    (piece) =>
      isBoardPiece(piece) && getController(piece) === side &&
      getLegalMoves(stateForSide, piece.id, side).length > 0,
  );
}

export function isCheckmate(state: GameState, side: Side): boolean {
  return isGeneralInCheck(state, side) && !hasAnyLegalMove(state, side);
}

export function isStalemate(state: GameState, side: Side): boolean {
  return !isGeneralInCheck(state, side) && !hasAnyLegalMove(state, side);
}

export function getPieceTypeForMovement(piece: PublicPiece): PieceType {
  return getCurrentPieceType(piece);
}

function ownHalf(side: Side, position: Position): boolean { return side === "red" ? position.y >= 5 : position.y <= 4; }
export function princeProtects(state: GameState, side: Side): boolean {
  return selectedHeroId(state, side) === "prince" && Math.min(state.formalTurns?.red ?? 0, state.formalTurns?.black ?? 0) < 9 && !state.heroRuntime?.[side]?.carefreeSuspended;
}

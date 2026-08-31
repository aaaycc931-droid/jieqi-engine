import {
  getController,
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

type MoveLike = Pick<MoveCommand, "from" | "to">;

export interface PublicMoveOptions {
  allowStealthSource?: boolean;
  allowStealthTarget?: boolean;
  requireCapture?: boolean;
}

export function samePosition(first: Position, second: Position): boolean {
  return first.x === second.x && first.y === second.y;
}

export function pieceAt(
  state: Pick<GameState, "pieces">,
  position: Position,
): PublicPiece | undefined {
  return state.pieces.find((piece) => samePosition(piece, position));
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
  return Boolean(state.effectsByPieceId?.[pieceId]?.stealth);
}

function blocksPath(
  state: Pick<GameState, "pieces" | "effectsByPieceId">,
  position: Position,
): boolean {
  const piece = pieceAt(state, position);
  return Boolean(piece && !hasStealthEffect(state, piece.id));
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
    if (blocksPath(state, { x, y })) count += 1;
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
  state: Pick<GameState, "pieces" | "effectsByPieceId" | "featureRules">,
  piece: PublicPiece,
  to: Position,
  forAttack = false,
): boolean {
  if (!isInsideBoard(to) || samePosition(piece, to)) return false;

  const { side, type } = getMovementIdentity(piece);
  const mutation = state.featureRules?.mutation;
  const dx = to.x - piece.x;
  const dy = to.y - piece.y;
  const absX = Math.abs(dx);
  const absY = Math.abs(dy);

  // 骑兵保留原本棋种走法，并额外拥有马步。暗兵位和翻开后的兵/卒
  // 仍只能向真实前方使用马步；其余翻开棋种使用完整八方向马步。
  if (state.effectsByPieceId?.[piece.id]?.cavalry && ((absX === 2 && absY === 1) || (absX === 1 && absY === 2))) {
    if (piece.faceDown || type === "pawn") {
      if ((side === "red" && dy >= 0) || (side === "black" && dy <= 0)) return false;
    }
    const leg = absX === 2
      ? { x: piece.x + Math.sign(dx), y: piece.y }
      : { x: piece.x, y: piece.y + Math.sign(dy) };
    return !blocksPath(state, leg);
  }

  switch (type) {
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
      return mutation === "iron_steed" || !blocksPath(state, leg);
    }

    case "cannon": {
      const between = countPiecesBetween(state, piece, to);
      if (between === undefined) return false;
      const occupied = Boolean(pieceAt(state, to));
      return occupied || forAttack ? between === 1 : between === 0;
    }

    case "pawn": {
      const forward = side === "red" ? -1 : 1;
      if (dx === 0 && dy === forward) return true;
      if (isAcrossRiver(piece, side) && absX === 1 && dy === 0) return true;
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
      return piece.faceDown ? isInPalace(to, side) : true;
    }

    case "elephant": {
      if (absX !== 2 || absY !== 2) return false;
      const eye = { x: piece.x + dx / 2, y: piece.y + dy / 2 };
      return !blocksPath(state, eye);
    }

    default: {
      const exhaustive: never = type;
      return exhaustive;
    }
  }
}

function targetEligible(
  state: Pick<GameState, "pieces" | "effectsByPieceId" | "featureRules">,
  source: PublicPiece,
  to: Position,
  options: PublicMoveOptions = {},
): boolean {
  const target = pieceAt(state, to);
  if (!target) return true;
  if (hasStealthEffect(state, target.id) && !options.allowStealthTarget) return false;
  // 自残只限暗子：暗子身份未知，始终可吃；己方已揭明子不可吃。
  if (target.faceDown) return true;
  if (target.type === "general") {
    // 战车的隔子冲锋是路径碾碎终局的唯一例外：允许把敌将帅作为终点，
    // 以便与路径上的己方将帅形成两败俱伤。
    return state.featureRules?.mutation === "war_chariot" && getMovementIdentity(source).type === "rook" && getController(target) !== getController(source);
  }
  return getController(target) !== getController(source);
}

export function getPseudoMoves(
  state: GameState,
  pieceId: string,
): Position[] {
  const source = pieceById(state, pieceId);
  if (!source) return [];
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
  state: Pick<GameState, "pieces" | "effectsByPieceId" | "featureRules">,
  piece: RevealedPiece,
  position: Position,
): boolean {
  if (hasStealthEffect(state, piece.id)) return false;
  if (state.featureRules?.mutation === "iron_steed" && getMovementIdentity(piece).type === "horse") {
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
  state: Pick<GameState, "pieces" | "effectsByPieceId" | "featureRules">,
  position: Position,
  bySide: Side,
): boolean {
  return state.pieces.some((piece) => {
    if (piece.faceDown || piece.color !== bySide || hasStealthEffect(state, piece.id)) return false;
    return canRevealedPieceAttack(state, piece, position);
  });
}

export function findGeneral(
  state: Pick<GameState, "pieces" | "effectsByPieceId" | "featureRules">,
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
  state: Pick<GameState, "pieces" | "effectsByPieceId" | "featureRules">,
  side: Side,
): boolean {
  const general = findGeneral(state, side);
  return isSquareAttacked(state, general, otherSide(side));
}

function simulatePublicMove(
  state: GameState,
  source: PublicPiece,
  to: Position,
): GameState {
  const target = pieceAt(state, to);
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

  const source = pieceAt(state, move.from);
  if (!source) {
    return { ok: false, code: "NO_PIECE", message: "起点没有棋子" };
  }
  if (getController(source) !== actingSide) {
    return { ok: false, code: "NOT_CONTROLLED", message: "该棋子不由行动方控制" };
  }
  if (state.featureRules?.mutation === "iron_wall") {
    const destinationOwner = actingSide;
    const startsInsideEnemy = isInPalace(move.from, otherSide(destinationOwner));
    const endsInsideEnemy = isInPalace(move.to, otherSide(destinationOwner));
    if (!startsInsideEnemy && endsInsideEnemy) {
      return { ok: false, code: "IRON_WALL", message: "铁壁阻止从九宫外进入敌方九宫" };
    }
  }
  if (hasStealthEffect(state, source.id) && !options.allowStealthSource) {
    return { ok: false, code: "STEALTH_ACTION_REQUIRED", message: "隐身棋必须通过刺杀行动移动" };
  }
  if (!targetEligible(state, source, move.to, options)) {
    return { ok: false, code: "ILLEGAL_TARGET", message: "目标棋子不可吃" };
  }
  if (options.requireCapture && !pieceAt(state, move.to)) {
    return { ok: false, code: "STRONG_STRIKE_NEEDS_TARGET", message: "强击必须选择一个目标棋子" };
  }
  if (!movementGeometryLegal(state, source, move.to)) {
    return { ok: false, code: "ILLEGAL_MOVEMENT", message: "棋子走法不合法" };
  }

  const simulated = simulatePublicMove(state, source, move.to);
  if (isGeneralInCheck(simulated, actingSide)) {
    return { ok: false, code: "SELF_CHECK", message: "该步会令己方将帅受攻击" };
  }

  return { ok: true };
}

export function getLegalMoves(
  state: GameState,
  pieceId: string,
  actingSide: Side = state.turn,
): Position[] {
  const source = pieceById(state, pieceId);
  if (!source || getController(source) !== actingSide) return [];
  return getPseudoMoves(state, pieceId).filter(
    (to) => validatePublicMove(state, { from: source, to }, actingSide).ok,
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
  const source = pieceById(state, pieceId);
  if (!source || getController(source) !== actingSide) return [];
  if (source.faceDown || source.type === "general") return [];
  const legal: Position[] = [];
  for (let y = 0; y <= 9; y += 1) {
    for (let x = 0; x <= 8; x += 1) {
      const to = { x, y };
      const target = pieceAt(state, to);
      if (useStrongStrike && (!target || (!target.faceDown && target.type === "general"))) continue;
      if (validatePublicMove(state, { from: source, to }, actingSide, {
        allowStealthSource: hasStealthEffect(state, source.id),
        allowStealthTarget: useStrongStrike,
        requireCapture: useStrongStrike,
      }).ok) legal.push(to);
    }
  }
  return legal;
}

export function hasAnyLegalMove(state: GameState, side: Side): boolean {
  const stateForSide: GameState = { ...state, status: "playing", turn: side };
  return stateForSide.pieces.some(
    (piece) =>
      getController(piece) === side &&
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
  return getMovementIdentity(piece).type;
}

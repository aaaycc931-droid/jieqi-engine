import { isRiver } from "./spaces.js";
import { RuleError } from "./errors.js";










const backRank                                                   = [
  "rook",
  "horse",
  "elephant",
  "advisor",
  "general",
  "advisor",
  "elephant",
  "horse",
  "rook",
];

function sideSlots(side      )                {
  const backY = side === "black" ? 0 : 9;
  const cannonY = side === "black" ? 2 : 7;
  const pawnY = side === "black" ? 3 : 6;
  const slots                = [];

  backRank.forEach((type, x) => {
    if (type !== "general") slots.push({ x, y: backY, side, type });
  });

  for (const x of [1, 7]) {
    slots.push({ x, y: cannonY, side, type: "cannon" });
  }

  for (const x of [0, 2, 4, 6, 8]) {
    slots.push({ x, y: pawnY, side, type: "pawn" });
  }

  return slots;
}

export const COVERED_SLOTS                         = [
  ...sideSlots("black"),
  ...sideSlots("red"),
];

export const GENERAL_START                         = {
  black: { x: 4, y: 0 },
  red: { x: 4, y: 9 },
};

const slotMap = new Map(
  COVERED_SLOTS.map((slot) => [`${slot.x},${slot.y}`, slot]         ),
);

export function positionKey(position          )         {
  return `${position.x},${position.y}`;
}

export function getCoveredSlot(
  x        ,
  y        ,
)                          {
  return slotMap.get(`${x},${y}`);
}

export function requireCoveredSlot(x        , y        )              {
  const slot = getCoveredSlot(x, y);
  if (!slot) {
    throw new Error(`暗子不在标准暗子位置：(${x},${y})`);
  }
  return slot;
}

export function getController(piece             )       {
  if (piece.faceDown && isRiver(piece)) {
    const controller = piece.river?.coveredIdentity?.controller;
    if (!controller) throw new RuleError("UNDEFINED_RIVER_CONTROL", "河道暗子的公开控制关系须由来源定义");
    return controller;
  }
  return piece.faceDown
    ? requireCoveredSlot(piece.x, piece.y).side
    : piece.color;
}

/**
 * 【暗置身份】：只读取暗子当前位置对应的基础棋位，不读取隐藏真实身份。
 * 非基础棋位须由允许该特殊移置的来源定义；公共层不提供秘密身份兜底。
 */
export function getDarkIdentity(piece              )                                {
  if (isRiver(piece)) {
    const type = piece.river?.coveredIdentity?.type;
    if (!type) throw new RuleError("UNDEFINED_DARK_IDENTITY", "河道暗子的【暗置身份】须由来源定义");
    return type;
  }
  const slot = getCoveredSlot(piece.x, piece.y);
  if (!slot) {
    throw new RuleError(
      "UNDEFINED_DARK_IDENTITY",
      `当前位置无法确定【暗置身份】，须由特殊来源定义：(${piece.x},${piece.y})`,
    );
  }
  return slot.type;
}

/** 普通当前兵种判定的公共入口；揭示后使用已公开的真实兵种。 */
export function getCurrentPieceType(piece             )            {
  return piece.faceDown ? getDarkIdentity(piece) : piece.type;
}

export function getMovementIdentity(piece             )


  {
  const type = getCurrentPieceType(piece);
  return { side: getController(piece), type };
}

export function createGeneral(side      )                {
  return {
    id: `${side}-general`,
    ...GENERAL_START[side],
    faceDown: false,
    color: side,
    type: "general",
  };
}

export function isInsideBoard(position          )          {
  return !isRiver(position) && (
    Number.isInteger(position.x) &&
    Number.isInteger(position.y) &&
    position.x >= 0 &&
    position.x <= 8 &&
    position.y >= 0 &&
    position.y <= 9
  );
}

export function otherSide(side      )       {
  return side === "red" ? "black" : "red";
}

export function isInPalace(position          , side      )          {
  if (isRiver(position)) return false;
  if (position.x < 3 || position.x > 5) return false;
  return side === "red"
    ? position.y >= 7 && position.y <= 9
    : position.y >= 0 && position.y <= 2;
}

export function isAcrossRiver(position          , side      )          {
  if (isRiver(position)) return false;
  return side === "red" ? position.y <= 4 : position.y >= 5;
}

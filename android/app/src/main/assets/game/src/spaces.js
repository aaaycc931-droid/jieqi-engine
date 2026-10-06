import { RuleError } from "./errors.js";


/** x/y在河道期间只是上一棋盘位置，不能当作河道坐标或几何。 */
export function isRiver(piece          )          {
  const p = piece                        ;
  return p.layer === "river" || p.river !== undefined;
}
export const isGround = (piece             )          => piece.layer === undefined && !isRiver(piece);
export const isFlying = (piece             )          => piece.layer === "air" && !isRiver(piece);
export const isBoardPiece = (piece             )          => !isRiver(piece);
export function boardPieces(state                           )                { return state.pieces.filter(isBoardPiece); }
export function mayReadRiver(permission                      )          {
  return permission?.readRiver === true && typeof permission.source === "string" && Boolean(permission.source.trim());
}
/** 权限只由已确认来源的权威代码提供，普通客户端动作没有此字段。 */
export function riverPieces(state                           , permission                     , location                                            )                {
  if (!mayReadRiver(permission)) throw new RuleError("RIVER_READ_PERMISSION", "读取河道须由来源明确授权");
  return state.pieces.filter(p => isRiver(p) && p.river && (!location || p.river.spaceId === location.spaceId && p.river.cellId === location.cellId));
}

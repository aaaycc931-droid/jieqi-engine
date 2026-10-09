import { RuleError } from "./errors.ts";
import type { GameState, Position, PublicPiece, RiverLocation, RiverReadPermission } from "./types.ts";

/** x/y在河道期间只是上一棋盘位置，不能当作河道坐标或几何。 */
export function isRiver(piece: Position): boolean {
  const p = piece as Partial<PublicPiece>;
  return p.layer === "river" || p.river !== undefined;
}
export const isGround = (piece: PublicPiece): boolean => piece.layer === undefined && !isRiver(piece);
export const isFlying = (piece: PublicPiece): boolean => piece.layer === "air" && !isRiver(piece);
export const isBoardPiece = (piece: PublicPiece): boolean => !isRiver(piece);
export function boardPieces(state: Pick<GameState, "pieces">): PublicPiece[] { return state.pieces.filter(isBoardPiece); }
export function mayReadRiver(permission?: RiverReadPermission): boolean {
  return permission?.readRiver === true && typeof permission.source === "string" && Boolean(permission.source.trim());
}
/** 权限只由已确认来源的权威代码提供，普通客户端动作没有此字段。 */
export function riverPieces(state: Pick<GameState, "pieces">, permission: RiverReadPermission, location?: Pick<RiverLocation, "spaceId" | "cellId">): PublicPiece[] {
  if (!mayReadRiver(permission)) throw new RuleError("RIVER_READ_PERMISSION", "读取河道须由来源明确授权");
  return state.pieces.filter(p => isRiver(p) && p.river && (!location || p.river.spaceId === location.spaceId && p.river.cellId === location.cellId));
}

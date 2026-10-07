import { RuleError } from "./errors.ts";
import { selectedHeroSelection } from "./hero-forms.ts";
import { getController, getCurrentPieceType } from "./slots.ts";
import { isGround, isRiver } from "./spaces.ts";
import { enterRiverSpace, leaveRiverSpace } from "./settlement.ts";
import type { GameState, HeroAbilityCommand, PublicPiece, SecretState, Side } from "./types.ts";
export const JIANG_HE_RIVER = "jiang_he:river";
const requireRule = (ok: unknown, code: string, text: string) => { if (!ok) throw new RuleError(code, text); };
function clearPath(state: GameState, from: number, to: number, id: string): boolean {
  return !state.pieces.some(p => p.id !== id && isRiver(p) && p.river?.spaceId === JIANG_HE_RIVER && Number(p.river.cellId) >= Math.min(from, to) && Number(p.river.cellId) <= Math.max(from, to));
}
export function applyRiverAbility(state: GameState, secret: SecretState, side: Side, command: HeroAbilityCommand): PublicPiece | undefined {
  const selection = selectedHeroSelection(state, side);
  requireRule(selection?.heroId === "jiang_he", "WRONG_HERO", "必须选择江鹤完整技能包");
  const p = state.pieces.find(p => p.id === command.pieceId);
  requireRule(p && getController(p) === side && getCurrentPieceType(p) !== "general", "INVALID_RIVER_PIECE", "需要当前控制的非将帅棋");
  const effects = (state.effectsByPieceId ??= {})[p!.id] ??= {};
  if (command.ability === "river_enter" || command.ability === "inner_wave") {
    requireRule(isGround(p!) && [4, 5].includes(p!.y) && effects.riverQualified, "RIVER_NOT_QUALIFIED", "必须是普通行动获得资格且仍在岸上的地面棋");
    requireRule(clearPath(state, p!.x, p!.x, p!.id), "RIVER_OCCUPIED", "同一路河格已占用");
    if (command.ability === "inner_wave") {
      requireRule(selection!.form === "inner" && !state.heroRuntime?.[side]?.used, "SKILL_USED", "里清波每局一次且替换表包");
      const to = command.to;
      requireRule(to && Number.isInteger(to.x) && to.x >= 0 && to.x < 9 && [4, 5].includes(to.y) && clearPath(state, p!.x, to.x, p!.id), "INVALID_RIVER_PATH", "需要畅通河路与同路最终岸格");
      enterRiverSpace(state, secret, p!.id, { source: "jiang_he:inner", spaceId: JIANG_HE_RIVER, cellId: String(p!.x) });
      p!.river!.cellId = String(to!.x);
      requireRule(leaveRiverSpace(state, secret, p!.id, to!, "jiang_he:inner_exit"), "INVALID_RIVER_EXIT", "出河必须是合法空地面岸格");
      (state.heroRuntime![side] ??= {}).used = true;
    } else {
      requireRule(selection!.form === "front", "WRONG_HERO_FORM", "里包不能发动表入河");
      enterRiverSpace(state, secret, p!.id, { source: "jiang_he:front", spaceId: JIANG_HE_RIVER, cellId: String(p!.x) });
      effects.riverTurns = 3;
    }
  } else {
    requireRule(selection!.form === "front" && isRiver(p!) && p!.river?.spaceId === JIANG_HE_RIVER && command.to, "INVALID_RIVER_SOURCE", "必须操作当前河道内表清波棋");
    const file = Number(p!.river!.cellId), to = command.to!;
    if (command.ability === "river_move") {
      requireRule(Number.isInteger(to.x) && to.x >= 0 && to.x < 9 && file !== to.x && clearPath(state, file, to.x, p!.id), "INVALID_RIVER_PATH", "河道横移目标必须为空且全路畅通");
      p!.river!.cellId = String(to.x);
    } else {
      requireRule(command.ability === "river_exit" && to.x === file && [4, 5].includes(to.y), "INVALID_RIVER_EXIT", "只能出到当前同一路岸格");
      requireRule(leaveRiverSpace(state, secret, p!.id, to, "jiang_he:exit"), "INVALID_RIVER_EXIT", "出河落位不合法");
      delete effects.riverTurns;
    }
  }
  return state.pieces.find(q => q.id === p!.id);
}

import { RuleError } from "./errors.js";
import { HERO_CATALOG, HERO_IDS } from "./heroes.js";


const sides = ["red", "black"]         ;
const clone =    (value   )    => structuredClone(value);
const fail = (message        )        => { throw new RuleError("INVALID_HERO_SELECTION", message); };

/** 只表达全局命名语法，不表示该形态的技能包已经可用。 */
export function heroSkillLabel(heroName        , skillName        , form          )         {
  if (form !== "front" && form !== "inner") return fail("未知英雄形态");
  return form === "inner" ? `里·${heroName}｜【里·${skillName}】` : `${heroName}｜【${skillName}】`;
}

/** 本次移交的19英雄及两个独立里包；迦拉克隆五子包在英雄确认时固定。 */
export function getHeroPackage(heroId        , form           = "front", variant                ) {
  if (!HERO_IDS.includes(heroId)) return fail("未知英雄");
  if (form !== "front" && form !== "inner") return fail("未知英雄形态");
  if (form === "inner" && !["jiang_he", "death_knight"].includes(heroId)) throw new RuleError("HERO_FORM_UNAVAILABLE", "该英雄没有正式移交的里形态完整包");
  if (variant !== undefined && (heroId !== "devout_zealot" || form !== "front" || !["nightmare", "invincible", "fel", "storm", "unspeakable"].includes(variant))) return fail("未知或不适用的迦拉克隆完整形态");
  const selectedVariant = heroId === "devout_zealot" ? variant ?? "unspeakable" : undefined;
  const selection                = { heroId, form, packageId: `${heroId}:${form}:v1${selectedVariant ? ":" + selectedVariant : ""}`, ...(selectedVariant ? { variant: selectedVariant } : {}) };
  return Object.freeze({ ...selection, name: `${form === "inner" ? "里·" : ""}${HERO_CATALOG[heroId].name}`,
    skillLabels: Object.freeze(HERO_CATALOG[heroId].skills.map(s => heroSkillLabel(HERO_CATALOG[heroId].name, s.name, form))) });
}

function requireSideMap(value         )       {
  if (value === undefined) return;
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).some(key => !sides.includes(key        ))) fail("英雄选择必须按红黑双方分别指定");
}

export function createHeroSelections(heroes                                , forms                                  , variants                                       )                 {
  requireSideMap(heroes); requireSideMap(forms); requireSideMap(variants);
  const selections                 = {};
  for (const side of sides) {
    const hero = heroes?.[side], form = forms?.[side];
    if (hero === undefined) { if (form !== undefined || variants?.[side] !== undefined) fail("没有英雄时不能指定形态"); continue; }
    const pkg = getHeroPackage(hero, form === undefined ? "front" : form, variants?.[side]);
    selections[side] = { heroId: pkg.heroId, form: pkg.form, packageId: pkg.packageId, ...(pkg.variant ? { variant: pkg.variant } : {}) };
  }
  return selections;
}

function readSelections(value                )                 {
  requireSideMap(value);
  const result                 = {};
  for (const side of sides) {
    const choice = value[side];
    if (choice === undefined) continue;
    if (!choice || typeof choice !== "object" || Array.isArray(choice) || !["form,heroId,packageId", "form,heroId,packageId,variant"].includes(Object.keys(choice).sort().join(","))) fail("每方必须选择一个完整英雄形态包");
    if (choice.form !== "front" && choice.form !== "inner") fail("完整技能包必须指定形态");
    const pkg = getHeroPackage(choice.heroId, choice.form, choice.variant);
    if (choice.packageId !== pkg.packageId) fail("英雄形态与技能包标识不一致");
    result[side] = { heroId: pkg.heroId, form: pkg.form, packageId: pkg.packageId, ...(pkg.variant ? { variant: pkg.variant } : {}) };
  }
  return result;
}

/** 纯公开判定：旧快照仅缺省为既有表包，显式未知/里包不降级。 */
export function validateHeroForms(state                                                  , secret              )                 {
  const rules = state.featureRules;
  const legacy = createHeroSelections(rules?.heroes);
  const selections = rules?.heroSelections === undefined ? legacy : readSelections(rules.heroSelections);
  if (rules?.heroes !== undefined && sides.some(side => legacy[side]?.heroId !== selections[side]?.heroId)) fail("英雄ID与完整形态选择冲突");
  for (const lock of [state.heroFormLock, secret?.heroFormLock]) {
    if (lock !== undefined && JSON.stringify(readSelections(lock)) !== JSON.stringify(selections)) {
      throw new RuleError("HERO_FORM_LOCKED", "一局只能使用开局所选的完整英雄形态");
    }
  }
  return selections;
}

/** 权威首次读取/旧快照迁移时固定选择；先校验再写入，拒绝不留下半初始化。 */
export function initializeHeroForms(state           , secret              )       {
  const selections = validateHeroForms(state, secret);
  if (state.featureRules || Object.keys(selections).length) {
    state.featureRules ??= {};
    state.featureRules.heroSelections = clone(selections);
    state.featureRules.heroes = Object.fromEntries(sides.filter(side => selections[side]).map(side => [side, selections[side] .heroId]));
  }
  state.heroFormLock = clone(selections);
  if (secret) secret.heroFormLock = clone(selections);
}

/** 表技能分派入口，里包仅由独立选择入口分派，显式形态必须先匹配已注册的完整包。 */
export function selectedHeroId(state                                                  , side      )                     {
  const selection = validateHeroForms(state)[side];
  return selection?.form === "front" ? selection.heroId : undefined;
}

export function selectedHeroSelection(state                                                  , side      )                            { return validateHeroForms(state)[side]; }

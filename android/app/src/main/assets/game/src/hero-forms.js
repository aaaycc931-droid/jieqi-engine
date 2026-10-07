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

/** 当前已移交的十二个表技能包；不合成、继承或注册未移交的里技能。 */
export function getHeroPackage(heroId        , form           = "front") {
  if (!HERO_IDS.includes(heroId)) return fail("未知英雄");
  if (form !== "front" && form !== "inner") return fail("未知英雄形态");
  if (form === "inner") throw new RuleError("HERO_FORM_UNAVAILABLE", "该英雄的里形态完整技能包尚未正式移交");
  const selection                = { heroId, form, packageId: `${heroId}:front:v1` };
  return Object.freeze({ ...selection, name: HERO_CATALOG[heroId].name,
    skillLabels: Object.freeze(HERO_CATALOG[heroId].skills.map(s => heroSkillLabel(HERO_CATALOG[heroId].name, s.name, form))) });
}

function requireSideMap(value         )       {
  if (value === undefined) return;
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).some(key => !sides.includes(key        ))) fail("英雄选择必须按红黑双方分别指定");
}

export function createHeroSelections(heroes                                , forms                                  )                 {
  requireSideMap(heroes); requireSideMap(forms);
  const selections                 = {};
  for (const side of sides) {
    const hero = heroes?.[side], form = forms?.[side];
    if (hero === undefined) { if (form !== undefined) fail("没有英雄时不能指定形态"); continue; }
    const pkg = getHeroPackage(hero, form === undefined ? "front" : form);
    selections[side] = { heroId: pkg.heroId, form: pkg.form, packageId: pkg.packageId };
  }
  return selections;
}

function readSelections(value                )                 {
  requireSideMap(value);
  const result                 = {};
  for (const side of sides) {
    const choice = value[side];
    if (choice === undefined) continue;
    if (!choice || typeof choice !== "object" || Array.isArray(choice) || Object.keys(choice).sort().join(",") !== "form,heroId,packageId") fail("每方必须选择一个完整英雄形态包");
    if (choice.form !== "front" && choice.form !== "inner") fail("完整技能包必须指定形态");
    const pkg = getHeroPackage(choice.heroId, choice.form);
    if (choice.packageId !== pkg.packageId) fail("英雄形态与技能包标识不一致");
    result[side] = { heroId: pkg.heroId, form: pkg.form, packageId: pkg.packageId };
  }
  return result;
}

/** 纯公开判定：旧快照仅缺省为既有表包，显式未知/里包不降级。 */
export function validateHeroForms(state                                                  , secret              )                 {
  const rules = state.featureRules;
  const legacy = createHeroSelections(rules?.heroes);
  const selections = rules?.heroSelections === undefined ? legacy : readSelections(rules.heroSelections);
  if (rules?.heroes !== undefined && JSON.stringify(legacy) !== JSON.stringify(selections)) fail("英雄ID与完整形态选择冲突");
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

/** 现有表技能分派唯一入口，显式形态必须先匹配已注册的完整包。 */
export function selectedHeroId(state                                                  , side      )                     {
  const selection = validateHeroForms(state)[side];
  if (selection && selection.form !== "front") throw new RuleError("HERO_FORM_DISPATCH_PENDING", "里形态必须使用其独立完整技能包，不能分派表技能");
  return selection?.heroId;
}

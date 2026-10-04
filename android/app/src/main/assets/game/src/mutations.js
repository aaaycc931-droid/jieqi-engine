












export const MUTATION_RARITIES                            = [
  "common",
  "rare",
  "epic",
  "legendary",
];

export const MUTATION_RARITY_LABELS                                           = {
  common: "普通",
  rare: "稀有",
  epic: "史诗",
  legendary: "传说",
};

/**
 * Current public rarity assignments. Internal balance scores stay in the
 * design document and are deliberately not part of the player-facing model.
 */
export const MUTATION_DEFINITIONS                                                   = {
  iron_wall: {
    id: "iron_wall",
    name: "堡垒",
    rarity: "common",
    summary: "棋子不能从外部进入敌方九宫。",
    rules: "棋子不能从敌方九宫外进入九宫；已经位于九宫内的棋子仍可在内部行动或离开，离开后不能重新进入。攻击线与将军判定不受边界阻断。",
  },
  cavalry: {
    id: "cavalry",
    name: "骑兵",
    rarity: "rare",
    rarityStatus: "provisional",
    summary: "双方真实马在揭示后升级为骑兵。",
    rules: "真实身份为马的棋在揭示后升级，暗置时不标记、不启用额外走法。保留八方向日字与马腿，己方半场增加向前一步，敌方半场增加向前、左右一步；新增步不能后退。骑兵最终评分与稀有度仍待确认。",
  },
  expedition: {
    id: "expedition",
    name: "亲征",
    rarity: "epic",
    summary: "双方将帅获得车式移动与攻击。",
    rules: "双方将帅解除九宫限制，可沿无阻挡的横线或竖线移动与攻击，并可离宫、跨河。行动仍须保证最终落点安全。",
  },
  iron_steed: {
    id: "iron_steed",
    name: "铁马",
    rarity: "epic",
    summary: "马可碾碎马腿位置的棋子后继续行动。",
    rules: "适用的马不再被马腿阻挡；马腿位置存在地面棋子时，按原本资格结算碾碎，再完成马步。地面马腿棋无论敌友、明暗、无形或壁垒都可能被碾碎，飞行棋及免疫碾碎棋不能被碾碎。",
  },
  shadow_dance: {
    id: "shadow_dance",
    name: "暗影之舞",
    rarity: "epic",
    summary: "双方各获得一次完整刺杀机会。",
    rules: "双方各获得一次刺杀：选择己方非将帅明棋，发动回合仅可移动到合法空位；随后获得无形，敌方完整一回合后，下个己方回合可强击包括将帅的合法非无形目标。潜行者的英雄次数与畸变次数独立记录。",
  },
  war_chariot: {
    id: "war_chariot",
    name: "战车",
    rarity: "legendary",
    summary: "车可隔一枚地面路径棋冲锋并碾碎路径。",
    rules: "适用的车可选择同一直线目标；路径中恰有一枚地面棋子（包括无形）时发动冲锋，按顺序碾碎路径棋后处理最终目标。路径防御无效，并可能触发乱杀、两败俱伤或“碾碎他们！”终局。",
  },
  chaos: { id: "chaos", name: "混乱", rarity: "legendary", summary: "未揭暗子每个正式回合秘密刷新阵营。", rules: "未揭暗子在权威端各自独立50%红/蓝刷新，真实兵种不变，公开控制规则不变；正常揭示时阵营锁定，暗子死亡只公开兵种，不公开秘密阵营。" },
  jian_xie: { id: "jian_xie", name: "尖斜", rarity: "rare", summary: "过河兵卒横移改为斜前一步。", rules: "过河前保持普通兵卒；过河后保留正前一步，左右横移替换为左前/右前斜一步。不能后退，到底线无法移动时不自动死亡或升变。" },
  end_time: { id: "end_time", name: "时光之末", rarity: "legendary", summary: "诺兹多姆与姆诺兹多的宿命时间战争。", rules: "仅在对应羁绊成立且传说内部抽中时启用。替换普通时间技能：已现身时光勇士可由五次沙漏回归/复活；已现身无限龙每个回合全军最多投放一枚距离3的扭曲炸弹。首个正式回合各75秒。" },
};

export const MUTATION_IDS                        = [
  "iron_steed",
  "iron_wall",
  "shadow_dance",
  "war_chariot",
  "expedition",
  "cavalry",
  "chaos",
  "jian_xie",
];

export function mutationDefinition(id            )                     {
  return MUTATION_DEFINITIONS[id];
}

export function standardMutationsForRarity(rarity                )                                {
  return MUTATION_IDS
    .map((id) => MUTATION_DEFINITIONS[id])
    .filter((definition) => definition.rarity === rarity);
}

export const NORMAL_FORMAL_TURN_DURATION_MS = 60_000;
export const DESTINY_FIRST_FORMAL_TURN_BONUS_MS = 15_000;
export const DESTINY_FIRST_FORMAL_TURN_DURATION_MS =
  NORMAL_FORMAL_TURN_DURATION_MS + DESTINY_FIRST_FORMAL_TURN_BONUS_MS;














/**
 * Intentionally empty until concrete hero bonds, destiny IDs and effects are
 * confirmed. Adding entries here changes only the legendary internal pool;
 * it must never alter the outer rarity weights.
 */
export const DESTINY_MUTATION_DEFINITIONS                                       = [{
  id: "destiny:end_time", name: "时光之末", rarity: "legendary", destiny: true,
  heroBond: ["nozdormu", "murozond"], summary: MUTATION_DEFINITIONS.end_time.summary,
  rules: MUTATION_DEFINITIONS.end_time.rules, firstFormalTurnBonusMs: DESTINY_FIRST_FORMAL_TURN_BONUS_MS,
}];





export function isDestinyUnlocked(
  definition                           ,
  heroes                      ,
)          {
  const [first, second] = definition.heroBond;
  return (heroes.red === first && heroes.black === second)
    || (heroes.red === second && heroes.black === first);
}

/** Build the internal legendary pool after the outer draw chose legendary. */
export function legendaryMutationCandidates(
  heroes                      ,
  destinyDefinitions                                       = DESTINY_MUTATION_DEFINITIONS,
)                                        {
  return [
    ...standardMutationsForRarity("legendary"),
    ...destinyDefinitions.filter((definition) => isDestinyUnlocked(definition, heroes)),
  ];
}

/** 精确外层权重尚未确认：保留兼容抽取，不伪造最终概率；宿命只在传说内部加入。 */
export function drawRuntimeMutation(randomInt                         , heroes                       )             {
  const outer = randomInt(MUTATION_IDS.length);
  if (!Number.isInteger(outer) || outer < 0 || outer >= MUTATION_IDS.length) throw new RangeError("畸变随机数超出范围");
  const standard = MUTATION_IDS[outer];
  if (!heroes || mutationDefinition(standard).rarity !== "legendary") return standard;
  const candidates = legendaryMutationCandidates(heroes);
  if (!candidates.some(c => "destiny" in c)) return standard;
  const inner = randomInt(candidates.length);
  if (!Number.isInteger(inner) || inner < 0 || inner >= candidates.length) throw new RangeError("传说内部随机数超出范围");
  return candidates[inner].id === "destiny:end_time" ? "end_time" : candidates[inner].id              ;
}













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
    summary: "双方三个指定兵位获得额外马步。",
    rules: "双方开局三个指定兵位的棋子获得骑兵效果。暗子第一次行动可使用向前的马步；揭开后继续保留骑兵效果，非兵种可使用完整马步，兵卒仍不能向后或后侧行动。",
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
    rules: "适用的马不再被马腿阻挡；马腿位置存在棋子时，先清除其效果并将其碾碎，再完成马步。马腿棋无论敌友、明暗、隐身或防御状态都可能被碾碎。",
  },
  shadow_dance: {
    id: "shadow_dance",
    name: "暗影之舞",
    rarity: "epic",
    summary: "双方各获得一次完整刺杀机会。",
    rules: "双方各获得一次刺杀：选择己方非将帅明棋，首次可移动到合法空位并保留强击，或立即强击；随后隐身到下一个己方回合结束。潜行者的英雄次数与畸变次数独立记录。",
  },
  war_chariot: {
    id: "war_chariot",
    name: "战车",
    rarity: "legendary",
    summary: "车可隔一枚普通路径棋冲锋并碾碎路径。",
    rules: "适用的车可选择同一直线目标；路径中恰有一枚非隐身棋子时发动冲锋，按顺序碾碎路径棋后处理最终目标。路径防御无效，并可能触发乱杀、两败俱伤或“碾碎他们！”终局。",
  },
};

export const MUTATION_IDS                        = [
  "iron_steed",
  "iron_wall",
  "shadow_dance",
  "war_chariot",
  "expedition",
  "cavalry",
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
export const DESTINY_MUTATION_DEFINITIONS                                       = [];





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

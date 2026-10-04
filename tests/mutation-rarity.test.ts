import assert from "node:assert/strict";
import test from "node:test";

import {
  DESTINY_FIRST_FORMAL_TURN_BONUS_MS,
  DESTINY_FIRST_FORMAL_TURN_DURATION_MS,
  DESTINY_MUTATION_DEFINITIONS,
  MUTATION_RARITY_LABELS,
  NORMAL_FORMAL_TURN_DURATION_MS,
  legendaryMutationCandidates,
  mutationDefinition,
  standardMutationsForRarity,
  type DestinyMutationDefinition,
} from "../src/index.ts";

test("RARITY-01 六项畸变按确认稿映射到四种稀有度", () => {
  assert.deepEqual(
    ["iron_wall", "cavalry", "expedition", "iron_steed", "shadow_dance", "war_chariot"]
      .map((id) => [id, mutationDefinition(id as Parameters<typeof mutationDefinition>[0]).rarity]),
    [
      ["iron_wall", "common"],
      ["cavalry", "rare"],
      ["expedition", "epic"],
      ["iron_steed", "epic"],
      ["shadow_dance", "epic"],
      ["war_chariot", "legendary"],
    ],
  );
  assert.deepEqual(MUTATION_RARITY_LABELS, {
    common: "普通",
    rare: "稀有",
    epic: "史诗",
    legendary: "传说",
  });
});

test("RARITY-02 稀有度池保留全部标准畸变且不重复", () => {
  assert.deepEqual(standardMutationsForRarity("common").map(({ id }) => id), ["iron_wall"]);
  assert.deepEqual(standardMutationsForRarity("rare").map(({ id }) => id), ["cavalry"]);
  assert.deepEqual(standardMutationsForRarity("epic").map(({ id }) => id), ["iron_steed", "shadow_dance", "expedition"]);
  assert.deepEqual(standardMutationsForRarity("legendary").map(({ id }) => id), ["war_chariot"]);
});

test("DESTINY-01 未定义具体宿命时传说池只包含普通传说畸变", () => {
  assert.deepEqual(DESTINY_MUTATION_DEFINITIONS, []);
  assert.deepEqual(
    legendaryMutationCandidates({ red: "hunter", black: "warrior" }).map(({ id }) => id),
    ["war_chariot"],
  );
});

test("DESTINY-02 宿命候选只在对应英雄羁绊成立后加入传说内部池", () => {
  const destiny: DestinyMutationDefinition = {
    id: "destiny:test-bond",
    name: "测试宿命",
    rarity: "legendary",
    destiny: true,
    heroBond: ["hunter", "rogue"],
    summary: "仅用于验证候选池。",
    rules: "仅用于验证候选池。",
    firstFormalTurnBonusMs: DESTINY_FIRST_FORMAL_TURN_BONUS_MS,
  };
  assert.deepEqual(
    legendaryMutationCandidates(
      { red: "rogue", black: "hunter" },
      [destiny],
    ).map(({ id }) => id),
    ["war_chariot", "destiny:test-bond"],
  );
  assert.deepEqual(
    legendaryMutationCandidates(
      { red: "warrior", black: "hunter" },
      [destiny],
    ).map(({ id }) => id),
    ["war_chariot"],
  );
});

test("DESTINY-03 宿命只定义首个正式回合增加十五秒的时间边界", () => {
  assert.equal(DESTINY_FIRST_FORMAL_TURN_BONUS_MS, 15_000);
  assert.equal(NORMAL_FORMAL_TURN_DURATION_MS, 60_000);
  assert.equal(DESTINY_FIRST_FORMAL_TURN_DURATION_MS, 75_000);
});

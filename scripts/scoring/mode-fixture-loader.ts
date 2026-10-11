import { createIdentityPool } from "../../src/setup.ts";
import { COVERED_SLOTS } from "../../src/slots.ts";
import type { RandomInt } from "../../src/types.ts";

/** Construct a legal Fisher-Yates draw witness; never inject post-setup state. */
export function halfChaosFixtureRandom(world: { true_type_by_stable_piece_id: Record<string, string>; all_initial_pieces_original_side: Record<string, string> }): RandomInt {
  const tape: Array<{ bound: number; value: number }> = [];
  const ids = COVERED_SLOTS.map((_, i) => `covered-${String(i).padStart(2, "0")}`);
  if (Object.keys(world.true_type_by_stable_piece_id).length !== 30 || Object.keys(world.all_initial_pieces_original_side).length !== 30) throw new Error("fixture_inventory_mismatch");
  for (const side of ["black", "red"] as const) {
    const slots = COVERED_SLOTS.map((slot, i) => ({ slot, id: ids[i] })).filter(({ slot }) => slot.side === side);
    const pool = createIdentityPool().filter(p => p.color === side);
    const desired = slots.map(({ id }) => {
      if (world.all_initial_pieces_original_side[id] !== side) throw new Error("fixture_original_side_mismatch");
      return world.true_type_by_stable_piece_id[id];
    });
    for (let i = pool.length - 1; i > 0; i--) {
      const j = pool.findIndex((p, k) => k <= i && p.type === desired[i]);
      if (j < 0) throw new Error("fixture_inventory_mismatch");
      tape.push({ bound: i + 1, value: j }); [pool[i], pool[j]] = [pool[j], pool[i]];
    }
    if (pool.some((p, i) => p.type !== desired[i])) throw new Error("fixture_inventory_mismatch");
  }
  let index = 0;
  return bound => {
    const draw = tape[index++];
    if (!draw || draw.bound !== bound) throw new Error("fixture_random_domain_mismatch");
    return draw.value;
  };
}

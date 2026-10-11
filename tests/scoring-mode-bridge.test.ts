import test from "node:test";
import { MODE_QUALIFICATION_CASES } from "../scripts/scoring/mode-qualification-cases.ts";
for (const item of MODE_QUALIFICATION_CASES) test(item.id, () => item.run({ sessions: [] }));

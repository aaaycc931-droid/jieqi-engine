// Fixed audited P0 worker: no authority imports, filesystem/network calls,
// plugin evaluation or environment inputs. Invoked in a permission-limited child.
const chunks: Buffer[] = [];
for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk));
const { input, memory, randomBytes } = JSON.parse(Buffer.concat(chunks).toString("utf8"));
function freeze(v: any): any { if (v && typeof v === "object") { for (const c of Object.values(v)) freeze(c); Object.freeze(v); } return v; }
freeze(input); freeze(memory); freeze(randomBytes);
if (input.decision_budget.profile !== "P0" || !Array.isArray(randomBytes) || randomBytes.length !== 4 || randomBytes.some((n: number) => !Number.isInteger(n) || n < 0 || n > 255)) throw new Error("Invalid P0 input");
// Flow coverage only: no strength evaluation, hidden-state search or learned PU.
const catalog = input.command_catalog;
let choices = catalog.filter((i: any) => i.kind === "shuffle");
if (!choices.length) choices = catalog.filter((i: any) => i.kind === "insight");
if (!choices.length) choices = catalog;
const word = randomBytes.reduce((n: number, b: number) => n * 256 + b, 0);
const intent = choices[word % choices.length] ?? { kind: "wait" };
const learned = input.projection.own_insights ?? [];
const knownThen = (memory.known_then ?? []).map((row: any) => ({ ...row }));
for (const row of input.visible_history.filter((row: any) => row.kind === "observation")) {
  for (const item of row.projection.own_insights ?? []) if (!knownThen.some((known: any) => known.pieceId === item.pieceId && known.revision === item.revision)) {
    knownThen.push({ ...item, mapping_epoch: row.mapping_epoch });
  }
}
const nextMemory = { decisions: (memory.decisions ?? 0) + 1, known_then: knownThen,
  current_constraints: learned.filter((i: any) => i.valid).map((i: any) => ({ ...i, mapping_epoch: input.mapping_epoch })) };
process.stdout.write(JSON.stringify({ intent, nextMemory, decisionUsage: { catalog_entries: catalog.length, random_bytes: 4, profile: "P0", strength_qualified: false } }));

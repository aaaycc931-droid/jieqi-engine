import { readFile } from "node:fs/promises";
import { reviewHeroProposal } from "../../src/proposal-review.ts";
const proposalPath = process.argv[2];
if (!proposalPath) throw new Error("Usage: node scripts/review/validate-hero-proposal.ts proposal.json [comma-separated-changed-rule-ids]");
const baseline = JSON.parse(await readFile(new URL("../../rules/confirmed/BASELINE.json", import.meta.url), "utf8"));
const proposal = JSON.parse(await readFile(proposalPath, "utf8"));
const result = reviewHeroProposal(proposal, baseline, (process.argv[3] ?? "").split(",").filter(Boolean));
console.log(JSON.stringify(result, null, 2));
if (result.status !== "ready_for_review" && result.status !== "draft") process.exitCode = 1;

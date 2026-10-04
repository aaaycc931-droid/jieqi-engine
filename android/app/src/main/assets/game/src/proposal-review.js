/** 只校验提案，不写正式规则或代码。用户的实际确认和导入指令仍由实现对话核对。 */
















export function reviewHeroProposal(proposal              , baseline                  , changedRuleIds                    = [])                                                                                                                 {
  const issues           = [];
  if (proposal.schema_version !== 1) issues.push("unsupported_schema");
  if (!/^hero-proposal-[\w-]+$/.test(proposal.proposal_id ?? "")) issues.push("missing_unique_proposal_id");
  if (!/^[a-z][a-z0-9_]+$/.test(proposal.hero_id ?? "")) issues.push("invalid_hero_id");
  if (proposal.baseline_id !== baseline.baseline_id || proposal.baseline_digest !== baseline.baseline_digest) issues.push("baseline_mismatch_requires_rebase");
  const changes = proposal.changes ?? [];
  if (!changes.length || changes.some(c => !c.rule_id || !c.after?.trim() || !c.touches?.length)) issues.push("incomplete_rule_delta");
  if (new Set(changes.map(c => c.rule_id)).size !== changes.length) issues.push("duplicate_rule_id");
  const overlaps = (a        , b        ) => a === b || a.startsWith(`${b}.`) || b.startsWith(`${a}.`);
  if (changes.some(c => c.touches?.some(id => changedRuleIds.some(changed => overlaps(id, changed))))) issues.push("overlapping_rule_changes");
  if (baseline.heroes.includes(proposal.hero_id) && changes.every(c => c.kind === "addition")) issues.push("existing_hero_id_collision");
  if (!proposal.ability || !proposal.acceptance_cases?.length) issues.push("missing_ability_or_acceptance_cases");
  if (proposal.open_questions?.length) issues.push("unresolved_design_questions");
  if (proposal.approval_status === "user_confirmed" && !proposal.user_confirmation_quote?.trim()) issues.push("missing_confirmation_evidence");
  const conflict = issues.some(i => ["baseline_mismatch_requires_rebase", "overlapping_rule_changes", "existing_hero_id_collision"].includes(i));
  return { status: conflict ? "conflict" : issues.length ? "incomplete" : proposal.approval_status === "user_confirmed" ? "ready_for_review" : "draft", issues, writesPerformed: false };
}

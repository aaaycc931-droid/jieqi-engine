import { spawnSync, execFileSync } from 'node:child_process';
import { readFileSync, readdirSync, mkdirSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve, relative } from 'node:path';

// Evidence is generated from real named test executions. A related passing case
// never certifies the entire general statement, exceptions, UI or real devices.
const root = resolve(import.meta.dirname, '../..');
const read = path => readFileSync(resolve(root, path), 'utf8');
const contractPath = 'handoff/current/qa/INVARIANTS.json';
const contracts = JSON.parse(read(contractPath));
const mapping = JSON.parse(read('review/invariants/CASE_MAP.json'));
const rows = ['invariants', 'anti_invariants', 'supplements'].flatMap(group => contracts[group].map(c => ({ ...c, group })));
if (new Set(rows.map(c => c.id)).size !== rows.length) throw new Error('Duplicate contract ID');
for (const id of Object.keys(mapping.cases)) if (!rows.some(c => c.id === id)) throw new Error(`Unknown contract ${id}`);
const files = readdirSync(resolve(root, 'tests')).filter(f => f.endsWith('.test.ts')).sort();
const outcomes = [];
let executionFailed = false;
for (const file of files) {
  const path = `tests/${file}`;
  const run = spawnSync(process.execPath, ['--test', '--test-reporter=tap', path], { cwd: root, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 });
  const results = [...(run.stdout ?? '').matchAll(/^(ok|not ok) \d+ - (.+)$/gm)].map(m => ({ file: path, name: m[2], passed: m[1] === 'ok' }));
  if (run.status !== 0 || results.length === 0) {
    executionFailed = true;
    process.stderr.write(`${path} failed:\n${run.stdout}\n${run.stderr}\n`);
  }
  outcomes.push(...results);
}
const evidence = rows.map(contract => {
  const selectors = mapping.cases[contract.id] ?? [];
  const relatedCases = selectors.flatMap(selector => {
    const matches = outcomes.filter(c => c.file === selector.file && c.name.startsWith(selector.namePrefix));
    if (!matches.length) throw new Error(`Stale case selector ${contract.id}: ${selector.namePrefix}`);
    return matches;
  }).filter((c, i, all) => all.findIndex(x => x.file === c.file && x.name === c.name) === i);
  const nonRuntime = mapping.nonRuntime[contract.id];
  return {
    id: contract.id, group: contract.group,
    statement: contract.statement ?? contract.prohibited_global_claim,
    status: relatedCases.some(c => !c.passed) ? 'failed_cases' : relatedCases.length ? 'partial_evidence_passed' : nonRuntime ? 'non_runtime_contract' : 'missing_tests',
    relatedCases,
    verificationLimit: mapping.limits[contract.id] ?? nonRuntime ?? '已列用例只验证具体情景，尚未覆盖本陈述的全部来源、例外、边界和客户端流程。',
    fullyAccepted: false,
  };
});
const sourceFiles = execFileSync('git', ['ls-files'], { cwd: root, encoding: 'utf8' }).trim().split('\n').filter(p => /^(src\/|tests\/|web\/|scripts\/|\.github\/|package.json$|review\/invariants\/CASE_MAP.json$)/.test(p));
// Include new tests/scripts before they are committed, too.
for (const p of [...files.map(f => `tests/${f}`), 'scripts/review/verify-invariant-evidence.mjs', 'review/invariants/CASE_MAP.json']) if (!sourceFiles.includes(p)) sourceFiles.push(p);
const digest = createHash('sha256');
for (const p of sourceFiles.sort()) digest.update(p + '\0').update(readFileSync(resolve(root, p))).update('\0');
const counts = Object.fromEntries(['partial_evidence_passed', 'failed_cases', 'missing_tests', 'non_runtime_contract'].map(status => [status, evidence.filter(e => e.status === status).length]));
const report = {
  authority: 'execution_evidence_non_normative',
  generatedAt: new Date().toISOString(),
  sourceCommitAtRun: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
  sourceDigest: digest.digest('hex'), sourceDigestPaths: sourceFiles,
  ruleRevision: contracts.current_rule_revision,
  contractDigest: createHash('sha256').update(read(contractPath)).digest('hex'),
  runtime: process.version,
  testSummary: { passed: outcomes.filter(c => c.passed).length, failed: outcomes.filter(c => !c.passed).length, executionFailed },
  contractSummary: { total: rows.length, ...counts, fullyAccepted: 0 },
  limits: ['相关用例重新运行通过不等于全称不变量已经证明。', '静态源码/布局检查、引擎运行时、浏览器和实体双机证据不能互相替代。', '未更改规则 revision、稀有度、评分或用户验收状态。'],
  contracts: evidence,
};
const output = resolve(root, 'review/invariants'); mkdirSync(output, { recursive: true });
writeFileSync(resolve(output, 'LATEST.json'), JSON.stringify(report, null, 2) + '\n');
const lines = ['# 规则合同逐项运行证据', '', `规则：${report.ruleRevision}；运行时：${process.version}；时间：${report.generatedAt}。`, '', `测试 ${report.testSummary.passed} 通过 / ${report.testSummary.failed} 失败。${rows.length} 项合同：${counts.partial_evidence_passed} 项有部分通过证据，${counts.missing_tests} 项缺专属测试，${counts.non_runtime_contract} 项属于规范/概念检查；完整验收仍为 0 项。`, '', '本表关联具体情景用例，不把相关用例通过写成整条规则的完整证明。精确用例名称、源码摘要与限制见 LATEST.json。', '', '| 合同 ID | 状态 | 证据文件 | 剩余限制 |', '| --- | --- | --- | --- |'];
for (const e of evidence) lines.push(`| ${e.id} | ${e.status} | ${[...new Set(e.relatedCases.map(c => c.file))].join(', ') || '—'} | ${e.verificationLimit.replaceAll('|', '/')} |`);
writeFileSync(resolve(output, 'LATEST.md'), lines.join('\n') + '\n');
console.log(JSON.stringify({ output: relative(root, output), tests: report.testSummary, contracts: report.contractSummary }));
if (executionFailed || report.testSummary.failed) process.exitCode = 1;

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

// Run only the new bounded repair controls against an immutable external checkout.
const root = resolve(process.env.HC_PR24_FIXED_ROOT ?? 'missing-fixed-checkout');
const commit = '6ba35636ecf5c69203225149a7b746893299b39b';
assert.equal(execFileSync('git', ['-C', root, 'rev-parse', 'HEAD'], {encoding:'utf8'}).trim(), commit);
assert.equal(execFileSync('git', ['-C', root, 'status', '--porcelain', '--untracked-files=no'], {encoding:'utf8'}), '');
const source = 'scripts/research/main-authority-result-prototype.ts';
const sourceBytes = readFileSync(resolve(root, source));
assert.deepEqual(sourceBytes, execFileSync('git', ['-C', root, 'show', `${commit}:${source}`]));
const { OfflineAuthorityResultPrototype: Prototype } = await import(pathToFileURL(resolve(root, source)).href);
const { createRemoteRoom, joinRemoteRoom } = await import(pathToFileURL(resolve(root, 'src/remote-room.ts')).href);
const H = 'bluetooth:host', G = 'bluetooth:guest';
const scope = {authorityId:'hc-r60-authority', roomId:'hc-r60-room', matchEpoch:'match-1'};
const action = {kind:'hero', hero:'hunter'};
const cases: any[] = [];
function fixture() {
  return joinRemoteRoom(createRemoteRoom(scope.roomId,H,'synthetic-local-only',100,
    {baseMode:'jieqi',heroesEnabled:true,mutationsEnabled:false}),G,'synthetic-local-only',100).room;
}
const p = new Prototype({scope, room:fixture(), randomInt:()=>0});
p.handle({actor:H,transportId:'first',action},100);
const before = p.inspectForResearch();
assert.deepEqual(p.query(H,{scope,transportId:'first',action}),{query:'valid',outcome:'accepted'});
cases.push({id:'F1-FIX-01',case:'complete own scope retains legitimate accepted result',passed:true});
for (const field of ['authorityId','matchEpoch']) {
  const malformed:any = {...scope}; delete malformed[field];
  const room=fixture(), original=structuredClone(room);
  assert.throws(()=>new Prototype({scope:malformed,room,randomInt:()=>0}),{message:'Exact jieqi scope required'});
  assert.deepEqual(room,original);
  const answer=p.query(H,{scope:malformed,transportId:'first',action});
  assert.deepEqual(answer,{query:'invalid'});
  cases.push({id:field==='authorityId'?'F1-FIX-02':'F1-FIX-03',case:`original missing ${field} variant`,
    constructor:'rejected before room mutation',query:answer,passed:true});
}
const answer=p.query(H,{transportId:'first',action});
assert.deepEqual(answer,{query:'invalid'});
assert.deepEqual(p.inspectForResearch(),before);
cases.push({id:'F1-FIX-04',case:'query.scope omitted',answer,queryChangedAuthority:false,passed:true});
const result={schema:'lezi.hc.r60.f1_fix_review.v1',dependencyCommit:commit,dependencySource:source,
  dependencySourceSha256:createHash('sha256').update(sourceBytes).digest('hex'),node:process.version,
  command:'HC_PR24_FIXED_ROOT=/absolute/path/to/fixed-pr24 node scripts/research/hc-result-f1-fix-review.ts',
  casesRun:cases.length,passed:cases.length,failed:0,cases,
  limits:['New repair controls only; old r59 observations remain unchanged.',
    'Trusted offline caller and intentionally malformed scope; no remote exploit claim.',
    'No old 13/29/32/34/935 suites, PR26 runtime tests, original mode matrices or devices run.',
    'No production or main research implementation changed; not full independent QA.']};
writeFileSync('review/hc-result-evidence/F1_FIX_RESULTS_20261113.json',JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify({casesRun:cases.length,passed:cases.length,failed:0}));

import { createServer } from 'node:http';
import { readFile, stat, mkdir, writeFile } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import assert from 'node:assert/strict';
import { initializeFeatureGameState, beginFormalTurn, applyHeroAbility, applyAuthoritativeMove, configureHeroPreparation, putGhostObject } from '../../src/index.ts';
import { gameState, secretState, revealed, covered, move } from '../../tests/helpers.ts';

const root = resolve(import.meta.dirname, '../..');
const { chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE || 'playwright');
// Synthetic prepared states are injected only in this test server's response.
// This fixture API is never written into product assets or the APK.
const fixture = `globalThis.__heroReview = {
 load(s,k) { resetMatch();gameState=structuredClone(s);gameSecret=structuredClone(k);localHeroes=gameState.featureRules.heroes;localTraps=gameSecret.traps??[];localPrivateViewerSide=gameState.turn;rpsPublic.assignments={red:'玩家一',black:'玩家二'};openingActive=false;localPreparationActive=false;trapSetupSide=undefined;selectedPieceId=undefined;heroView.hidden=true;rpsView.hidden=true;gameView.hidden=false;renderGame(); },
 open:openTransferredHeroAbility, handoff:localGameHandoff,
 read:()=>structuredClone(gameState)
};`;
const server = createServer(async (req,res) => {
 try {
  const url=new URL(req.url,'http://localhost');if(url.pathname==='/favicon.ico'){res.writeHead(204).end();return;}
  const base=resolve(root,'dist');let path=resolve(base,'.'+decodeURIComponent(url.pathname));
  if(!path.startsWith(base+'/'))throw Error('path');if((await stat(path)).isDirectory())path=resolve(path,'index.html');
  let bytes=await readFile(path);if(path===resolve(base,'web/app.js'))bytes=Buffer.concat([bytes,Buffer.from(fixture)]);
  res.writeHead(200,{'Content-Type':({'.js':'text/javascript','.html':'text/html','.css':'text/css','.svg':'image/svg+xml','.png':'image/png'})[extname(path)]??'application/octet-stream'}).end(bytes);
 }catch{res.writeHead(404).end();}
});
await new Promise(done=>server.listen(0,'127.0.0.1',done));
const browser=await chromium.launch({headless:true});
const report={authority:'prepared_browser_execution_non_normative',ruleRevision:'LEZI-FUNCTION-2026-10-07-r5',sourceCommitAtRun:execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim(),workingTreeDirty:!!execFileSync('git',['status','--porcelain'],{cwd:root,encoding:'utf8'}).trim(),appDigest:createHash('sha256').update(await readFile(resolve(root,'dist/web/app.js'))).digest('hex'),browser:browser.version(),viewport:{width:390,height:845},cases:[],errors:[],limits:['Synthetic prepared fixtures exercise actual compiled DOM controls and authority calls.','Not natural full matches, Bluetooth transport, physical devices or complete hero acceptance.','No product debug API, APK or paused random-match queue.']};
const context=await browser.newContext({viewport:report.viewport,isMobile:true,hasTouch:true});const page=await context.newPage();
page.on('pageerror',e=>report.errors.push(e.message));page.on('requestfailed',r=>report.errors.push(r.url()));page.on('response',r=>{if(r.status()>=400)report.errors.push(`${r.status()} ${r.url()}`);});
const pair=(hero,pieces=[],form='front',variant)=>({state:initializeFeatureGameState(gameState(pieces),{red:hero,black:'hunter'},undefined,{red:form},{red:variant}),secret:secretState()});
const skill=(s,ability,rest={})=>({kind:'hero_ability',ability,actionId:`browser:${ability}:${s.revision}`,expectedRevision:s.revision,...rest});
const load=async p=>{await page.reload({waitUntil:'networkidle'});await page.evaluate(({s,k})=>globalThis.__heroReview.load(s,k),{s:p.state,k:p.secret});};
const read=()=>page.evaluate(()=>globalThis.__heroReview.read());
const open=ability=>page.evaluate(a=>globalThis.__heroReview.open(a),ability);
const confirm=()=>page.locator('#dialog-action').click();
const coordinates=async(x,y,i=0)=>{await page.getByLabel('目标列（0–8）',{exact:true}).nth(i).fill(String(x));await page.getByLabel('目标行（0–9）',{exact:true}).nth(i).fill(String(y));};
const done=name=>report.cases.push({name,passed:true});
try {
 await page.goto(`http://127.0.0.1:${server.address().port}/web/`,{waitUntil:'networkidle'});
 await page.locator('#local-game-button').click();assert.equal(await page.locator('#hero-grid button').count(),19);done('nineteen hero selection entries');
 const n=pair('night',[covered('insight-target',0,6)]);n.secret.identities['insight-target']={color:'black',type:'cannon'};n.state.formalTurns.red=1;
 await load(n);await open('insight');await page.getByLabel('技能棋子',{exact:true}).selectOption('insight-target');await confirm();
 let s=await read();assert.equal(s.heroRuntime.red.pupil,2);assert.equal(s.effectsByPieceId['insight-target'].insightMark,true);assert.match(await page.locator('#transferred-hero-controls').textContent(),/洞察快照.*黑方[炮砲]/);
 await page.evaluate(()=>globalThis.__heroReview.handoff());assert.equal(await page.locator('#transferred-hero-controls').textContent(),'');done('public insight fee, private result and device handoff clearing');
 let b=pair('single_blade',[revealed('blade','red','rook',1,7)]);configureHeroPreparation(b.state,b.secret,'red',{blade:'left'});b=applyAuthoritativeMove(b.state,b.secret,move({x:1,y:7},{x:1,y:6},'blade-main'));
 await load(b);await page.getByRole('button',{name:'顺锋移置',exact:true}).click();await coordinates(2,6);await confirm();s=await read();assert.equal(s.pieces.find(p=>p.id==='blade').x,2);assert.equal(s.formalTurns.red,1);assert.equal(s.turn,'black');done('blade displacement child ends only its original formal turn');
 let charge={state:initializeFeatureGameState(gameState([revealed('charger','red','rook',0,7),revealed('charge-first','black','pawn',0,6),revealed('charge-defender','black','horse',1,6),revealed('other-defender','black','horse',7,3)]),{red:'berserker',black:'warrior'}),secret:secretState()};
 charge.state.heroRuntime.red.will=6;
 for(const id of ['charge-defender','other-defender'])charge.state.effectsByPieceId[id]={barrier:{owner:'black',enemyTurnsRemaining:3}};
 charge=applyAuthoritativeMove(charge.state,charge.secret,move({x:0,y:7},{x:0,y:6},'charge-parent'));
 await load(charge);await page.getByRole('button',{name:'冲锋·斩',exact:true}).click();await coordinates(1,6);await confirm();s=await read();
 assert.deepEqual(s.formalTurns,{red:1,black:0});assert.equal(s.turn,'black');assert.equal(s.pendingHeroChild,undefined);assert.equal(s.lastCompletedFormalTurn.mainActionId,'charge-parent');
 assert.equal(s.heroRuntime.red.will,3);assert.equal(s.heroRuntime.red.chargeCount,1);assert.equal(s.effectsByPieceId['charge-defender']?.barrier,undefined);assert.equal(s.effectsByPieceId['other-defender'].barrier.enemyTurnsRemaining,2);
 assert.equal(s.lastMove.countsAsFormalTurn,false);assert.equal(s.lastMove.bouncedAgainstPieceId,'charge-defender');assert.equal(s.pieces.find(p=>p.id==='charger').x,0);assert(s.pieces.some(p=>p.id==='charge-defender'));done('charge barrier bounce closes parent turn and durations once');
 const river=pair('jiang_he',[{...revealed('river','red','rook',0,4),layer:'river',river:{source:'jiang_he:front',spaceId:'jiang_he:river',cellId:'0'}}]);river.state.effectsByPieceId.river={riverTurns:2};
 await load(river);await open('river_move');await page.getByLabel('技能棋子',{exact:true}).selectOption('river');await coordinates(8,0);await confirm();s=await read();assert.equal(s.pieces.find(p=>p.id==='river').river.cellId,'8');done('river arbitrary distance horizontal operation');
 const inner=pair('death_knight',[revealed('victim','black','rook',0,6)],'inner');putGhostObject(inner.state,{owner:'red',position:{x:0,y:6},kind:'inner_ghost',source:'death_knight:inner_death',layers:3,remaining:0,persistent:true},'add_layers');
 await load(inner);await open('inner_ghost_burst');await confirm();s=await read();assert(s.captured.some(p=>p.id==='victim'));assert.equal(s.heroRuntime.red.used,true);done('inner ghost committed pulse operation');
 for(const variant of ['nightmare','fel','storm']) {
  const p=pair('devout_zealot',[revealed('nightmare-piece','red','rook',0,6)],'front',variant);p.state.heroRuntime.red.invokeCount=4;p.state.heroRuntime.red.omen=true;beginFormalTurn(p.state,p.secret,()=>0);
  await load(p);await page.getByRole('button',{name:'完成迦拉克隆部署',exact:true}).click();
  const count=variant==='nightmare'?1:variant==='fel'?4:2;
  if(variant==='nightmare')await page.getByLabel('待部署棋子',{exact:true}).nth(0).selectOption('nightmare-piece');
  for(let i=0;i<count;i++)await coordinates(i,7,i);await confirm();s=await read();
  if(variant==='storm')for(let i=0;i<2;i++){await page.getByRole('button',{name:'结算下一枚风暴元素突袭',exact:true}).click();await page.getByRole('checkbox').check();await confirm();}
  s=await read();assert.equal(s.pendingDescent,undefined);assert.equal(s.formalTurns.red,0);assert.equal(s.turnLifecycle.phase,'before_main');
  if(variant==='nightmare')assert.equal(s.pieces.find(p=>p.id==='nightmare-piece').y,7);else assert.equal(s.pieces.filter(p=>p.id.startsWith('galakrond:')).length,count);
  done(`${variant} descent deployment and main opportunity preservation`);
 }
 assert.deepEqual(report.errors,[]);report.passed=true;
} catch(e){report.passed=false;report.failure=e.stack;throw e;}
finally{await mkdir(resolve(root,'review/invariants'),{recursive:true});await writeFile(resolve(root,'review/invariants/HERO_TRANSFER_BROWSER_2026-10-07.json'),JSON.stringify(report,null,2)+'\n');await browser.close();await new Promise(done=>server.close(done));}
console.log(JSON.stringify({passed:report.passed,cases:report.cases.length,errors:report.errors.length}));

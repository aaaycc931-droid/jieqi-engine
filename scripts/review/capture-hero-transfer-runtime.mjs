import { createServer } from 'node:http';
import { readFile, stat, mkdir, writeFile } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import assert from 'node:assert/strict';
import { initializeFeatureGameState, beginFormalTurn, applyHeroAbility, applyAuthoritativeMove, configureHeroPreparation, putGhostObject, initializeFeatureSecret, getGhostObjects, markRevealed, startFormalClock } from '../../src/index.ts';
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
function flightWindow(flyerMoves) {
 const state=initializeFeatureGameState(gameState([covered('flight-trainee',0,6),revealed('flight-mover','red','rook',2,7),revealed('flight-reply','black','rook',6,2),...(flyerMoves?[revealed('flight-return-ground','red','horse',0,4),revealed('flight-destination-ground','black','pawn',1,4)]:[])]),{red:'sky_admiral',black:'murozond'}),secret=secretState({'flight-trainee':{color:'red',type:'pawn'}});
 configureHeroPreparation(state,secret,'red',{trainingType:'pawn'},()=>0);let r=applyAuthoritativeMove(state,secret,move({x:2,y:7},{x:2,y:6},'flight-prep'));
 r=applyAuthoritativeMove(r.state,r.secret,move({x:6,y:2},{x:6,y:3},'flight-prep-reply',r.state.revision));
 for(let i=0;i<3;i++){r=applyAuthoritativeMove(r.state,r.secret,{...move(flyerMoves?{x:0,y:6-i}:{x:2,y:i%2===0?6:7},flyerMoves?{x:0,y:5-i}:{x:2,y:i%2===0?7:6},`flight-main-${i}`,r.state.revision),pieceId:flyerMoves?'flight-trainee':'flight-mover'});if(i<2)r=applyAuthoritativeMove(r.state,r.secret,move({x:6,y:i%2===0?3:2},{x:6,y:i%2===0?2:3},`flight-reply-${i}`,r.state.revision));}
 return r;
}
const skill=(s,ability,rest={})=>({kind:'hero_ability',ability,actionId:`browser:${ability}:${s.revision}`,expectedRevision:s.revision,...rest});
// The board is a CSS background loaded lazily when the game becomes visible.
// Decode it before fixture navigation so reload cannot cancel its first request.
const readyBoard=()=>page.evaluate(async()=>{const image=new Image();image.src=new URL('assets/gameplay-v4/runtime/board-clean-no-center.png',location.href).href;await image.decode();});
const load=async p=>{await page.waitForLoadState('networkidle');await page.reload({waitUntil:'networkidle'});await readyBoard();await page.evaluate(({s,k})=>globalThis.__heroReview.load(s,k),{s:p.state,k:p.secret});await page.waitForLoadState('networkidle');};
const read=()=>page.evaluate(()=>globalThis.__heroReview.read());
const open=ability=>page.evaluate(a=>globalThis.__heroReview.open(a),ability);
const confirm=()=>page.locator('#dialog-action').click();
const coordinates=async(x,y,i=0)=>{await page.getByLabel('目标列（0–8）',{exact:true}).nth(i).fill(String(x));await page.getByLabel('目标行（0–9）',{exact:true}).nth(i).fill(String(y));};
const done=name=>report.cases.push({name,passed:true});
try {
 await page.goto(`http://127.0.0.1:${server.address().port}/web/`,{waitUntil:'networkidle'});
 await readyBoard();
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
 const sealed={state:initializeFeatureGameState(gameState([revealed('sealed-horse','red','horse',0,6)]),{red:'devout_zealot',black:'hunter'},'iron_wall',undefined,{red:'nightmare'}),secret:secretState()};
 sealed.state.heroRuntime.red.invokeCount=4;sealed.state.heroRuntime.red.omen=true;beginFormalTurn(sealed.state,sealed.secret,()=>0);
 await load(sealed);const sealedBefore=await read();await page.getByRole('button',{name:'完成迦拉克隆部署',exact:true}).click();await page.getByLabel('待部署棋子',{exact:true}).nth(0).selectOption('sealed-horse');await coordinates(4,1);await confirm();s=await read();
 assert.deepEqual(s,sealedBefore);assert.equal(await page.getByRole('button',{name:'完成迦拉克隆部署',exact:true}).count(),1);done('nightmare fortress seal rejects deployment without consuming its window');
 const finalTrap=pair('devout_zealot',[revealed('checking-rook','red','rook',0,6)],'front','nightmare');finalTrap.state.heroRuntime.red.invokeCount=4;finalTrap.state.heroRuntime.red.omen=true;finalTrap.secret.traps=[{id:'final-check-trap',owner:'black',position:{x:5,y:3},opponentTurnsRemaining:12}];beginFormalTurn(finalTrap.state,finalTrap.secret,()=>0);
 await load(finalTrap);await page.getByRole('button',{name:'完成迦拉克隆部署',exact:true}).click();await page.getByLabel('待部署棋子',{exact:true}).nth(0).selectOption('checking-rook');await coordinates(5,3);await confirm();s=await read();assert.equal(s.captured.find(p=>p.id==='checking-rook').cause,'trap_ambush');assert.equal(s.pendingDescent,undefined);assert.equal(s.turnLifecycle.phase,'before_main');assert.equal(s.formalTurns.red,0);done('nightmare final check is evaluated after landing trap destruction');
 const emptyStorm=pair('devout_zealot',[revealed('storm-main','red','rook',0,7)],'front','storm');emptyStorm.state.heroRuntime.red.invokeCount=4;emptyStorm.state.heroRuntime.red.omen=true;emptyStorm.secret.traps=[0,1].map(x=>({id:`empty-storm-trap-${x}`,owner:'black',position:{x,y:6},opponentTurnsRemaining:12}));beginFormalTurn(emptyStorm.state,emptyStorm.secret,()=>0);
 await load(emptyStorm);await page.getByRole('button',{name:'完成迦拉克隆部署',exact:true}).click();for(let i=0;i<2;i++)await coordinates(i,6,i);await confirm();s=await read();assert.equal(s.captured.length,2);assert.equal(s.pendingDescent,undefined);assert.equal(s.turnLifecycle.phase,'before_main');assert.equal(s.formalTurns.red,0);assert.equal(await page.getByRole('button',{name:'结算下一枚风暴元素突袭',exact:true}).count(),0);done('storm summons killed on landing release the normal main opportunity');
 for(const mode of ['attack','skip']) {
  let w={state:initializeFeatureGameState(gameState([revealed('wind-host','black','horse',6,4),revealed('second-target','black','pawn',8,4)],{turn:'black',blackGeneral:{x:4,y:4}}),{red:'devout_zealot',black:'wind'},'expedition',undefined,{red:'storm'}),secret:secretState()};
  initializeFeatureSecret(w.state,w.secret);w=applyHeroAbility(w.state,w.secret,skill(w.state,'shadow',{pieceId:'wind-host'}));w.state.turn='red';w.state.heroRuntime.red.invokeCount=4;w.state.heroRuntime.red.omen=true;beginFormalTurn(w.state,w.secret,()=>0);
  await load(w);await page.getByRole('button',{name:'完成迦拉克隆部署',exact:true}).click();await coordinates(6,5,0);await coordinates(8,5,1);await confirm();
  await page.getByRole('button',{name:'结算下一枚风暴元素突袭',exact:true}).click();await coordinates(6,4);await confirm();s=await read();assert.equal(s.status,'playing');assert.equal(s.pendingDescent.assaultIds.length,1);assert.equal(s.formalTurns.red,0);assert.equal(s.turnLifecycle.phase,'turn_start');
  await page.getByRole('button',{name:'结算下一枚风暴元素突袭',exact:true}).click();if(mode==='skip')await page.getByRole('checkbox').check();else await coordinates(8,4);await confirm();s=await read();assert.equal(s.status,'finished');assert.equal(s.winner,'red');assert.equal(s.pendingDescent,undefined);assert.equal(s.formalTurns.red,0);assert.equal(s.captured.some(p=>p.id==='second-target'),mode==='attack');done(`storm candidate terminal waits for second assault ${mode}`);
 }
 const ghosts={state:initializeFeatureGameState(gameState([revealed('ghost-first','black','pawn',0,4),revealed('ghost-second','black','pawn',2,4)]),{red:'devout_zealot',black:'death_knight'},undefined,undefined,{red:'storm'}),secret:secretState()};initializeFeatureSecret(ghosts.state,ghosts.secret);ghosts.state.heroRuntime.red.invokeCount=4;ghosts.state.heroRuntime.red.omen=true;beginFormalTurn(ghosts.state,ghosts.secret,()=>0);
 await load(ghosts);await page.getByRole('button',{name:'完成迦拉克隆部署',exact:true}).click();await coordinates(0,5,0);await coordinates(2,5,1);await confirm();
 for(let i=0;i<2;i++){await page.getByRole('button',{name:'结算下一枚风暴元素突袭',exact:true}).click();await coordinates(i*2,4);await confirm();s=await read();assert.equal(getGhostObjects(s,{kind:'ghost',owner:'black'}).length,i+1);}
 assert.equal(s.pendingDescent,undefined);assert.equal(s.turnLifecycle.phase,'before_main');assert.equal(s.formalTurns.red,0);assert(getGhostObjects(s,{kind:'ghost',owner:'black'}).every(g=>g.remaining===3));assert.deepEqual(s.automaticEvents.filter(e=>e.kind.startsWith('destroy:')).map(e=>e.pieceId),['ghost-first','ghost-second']);done('storm preserves both death events and generates both unticked ghosts');
 const mate={state:initializeFeatureGameState(gameState([2,3,4].map(x=>revealed(`mate-rook-${x}`,'black','rook',x,0))),{red:'devout_zealot',black:'hunter'},undefined,undefined,{red:'storm'}),secret:secretState()};initializeFeatureSecret(mate.state,mate.secret);mate.state.heroRuntime.red.invokeCount=4;mate.state.heroRuntime.red.omen=true;beginFormalTurn(mate.state,mate.secret,()=>0);
 await load(mate);await page.getByRole('button',{name:'完成迦拉克隆部署',exact:true}).click();await coordinates(0,7,0);await coordinates(1,7,1);await confirm();
 for(let i=0;i<2;i++){await page.getByRole('button',{name:'结算下一枚风暴元素突袭',exact:true}).click();await page.getByRole('checkbox').check();await confirm();s=await read();if(i===0)assert.equal(s.status,'playing');}
 assert(['execution','finished'].includes(s.status));assert.equal(s.winner,'black');assert.equal(s.pendingDescent,undefined);assert.equal(s.formalTurns.red,0);done('storm exhausted source checks final unavoidable check before normal main');
 const bombArmy={state:initializeFeatureGameState(gameState([revealed('bomb-dragon','black','pawn',0,3),revealed('bomb-second','black','pawn',2,3),revealed('bomb-victim','red','pawn',0,6)],{turn:'black'}),{red:'nozdormu',black:'murozond'},'end_time'),secret:secretState()};
 initializeFeatureSecret(bombArmy.state,bombArmy.secret);for(const id of ['bomb-dragon','bomb-second'])markRevealed(bombArmy.state,bombArmy.secret,id);
 await load(bombArmy);const beforeBomb=await read();await page.locator('button[data-skill-key="ability:bomb"]').click();await page.getByLabel('技能对象',{exact:true}).selectOption('bomb-dragon');await coordinates(0.5,3);await confirm();s=await read();assert.deepEqual(s,beforeBomb);
 await page.locator('button[data-skill-key="ability:bomb"]').click();await page.getByLabel('技能对象',{exact:true}).selectOption('bomb-dragon');await coordinates(0,6);await confirm();s=await read();assert.deepEqual(s.warps,[{x:0,y:6}]);assert.equal(s.effectsByPieceId['bomb-dragon'].ammunition,0);assert.equal(s.effectsByPieceId['bomb-victim'].timeCollapse.expiresAtOwnerTurnEnd,1);assert.equal(s.turn,'black');assert.equal(s.formalTurns.black,0);assert.equal(s.turnLifecycle.phase,'before_main');done('bomb rejects fractional DOM target without spending ammo and accepts a range-three retry');
 const firstBomb=structuredClone(s);await page.locator('button[data-skill-key="ability:bomb"]').click();await page.getByLabel('技能对象',{exact:true}).selectOption('bomb-second');await coordinates(2,4);await confirm();s=await read();assert.deepEqual(s,firstBomb);assert.equal(s.effectsByPieceId['bomb-second'].ammunition,1);done('bomb army quota rejects a different dragon without spending its ammo');
 for(const air of [false,true]){
  await load(flightWindow(air));await page.locator('button[data-skill-key="ability:timeline_twist"]').click();await coordinates(air?1:2,air?4:5);await confirm();s=await read();assert.deepEqual(s.formalTurns,{red:4,black:4});assert.equal(s.turn,'red');assert.equal(s.effectsByPieceId['flight-trainee'].flight.forcedLanding,true);assert.equal(s.effectsByPieceId['flight-trainee'].flight.remainingOwnerTurns,0);
  if(air){assert.equal(s.pieces.find(p=>p.id==='flight-trainee').layer,'air');assert.equal(s.pieces.find(p=>p.id==='flight-trainee').x,1);assert.deepEqual(s.pieces.find(p=>p.id==='flight-return-ground'),revealed('flight-return-ground','red','horse',0,4));assert(s.pieces.some(p=>p.id==='flight-destination-ground'));}else assert.equal(s.pieces.find(p=>p.id==='flight-mover').y,5);
  await page.getByRole('button',{name:'已接手',exact:true}).click();await page.getByRole('button',{name:'飞行期限已到：原地降落',exact:true}).click();s=await read();assert.deepEqual(s.formalTurns,{red:5,black:4});assert.equal(s.turn,'black');assert.equal(s.effectsByPieceId['flight-trainee'].flight,undefined);assert.equal(s.pieces.find(p=>p.id==='flight-trainee').layer,undefined);if(air)assert(s.captured.some(p=>p.id==='flight-destination-ground'&&p.cause==='crush'));
  done(air?'timeline controls the original flyer above ground objects then next formal main lands it':'next-turn flight obligation preserves timeline ground control then requires formal landing');
 }

 const chaosFixture=will=>{
  const q={state:initializeFeatureGameState(gameState([revealed('brawler','red','rook',0,7),covered('own-first',0,6),covered('own-next',2,6),covered('enemy-last',2,3)]),{red:'berserker',black:'hunter'},'chaos'),secret:secretState({'own-first':{color:'black',type:'horse'},'own-next':{color:'black',type:'cannon'},'enemy-last':{color:'red',type:'pawn'}})};
  beginFormalTurn(q.state,q.secret,()=>0);q.secret.identities['own-first'].color='black';q.secret.identities['own-next'].color='black';q.secret.identities['enemy-last'].color='red';q.state.heroRuntime.red.will=will;startFormalClock(q.state,Date.now(),q.secret);return q;
 };
 await load(chaosFixture(6));const chainClock=(await read()).turnDeadlineAt;
 await page.locator('button[data-skill-key="ability:brawl"]').click();await page.getByLabel('技能棋子',{exact:true}).selectOption('brawler');await coordinates(0,6);await confirm();s=await read();
 assert.equal(s.heroRuntime.red.will,2);assert.equal(s.heroRuntime.red.chargeCount,1);assert.equal(s.pendingHeroChild.kind,'brawl');assert.equal(s.formalTurns.red,0);assert.equal(s.turnDeadlineAt,chainClock);
 await page.getByRole('button',{name:'乱斗连斩',exact:true}).click();assert.equal(await page.getByLabel('技能棋子',{exact:true}).isDisabled(),true);await coordinates(2,6);await confirm();s=await read();assert.equal(s.heroRuntime.red.will,4);assert.equal(s.turnDeadlineAt,chainClock);
 await page.getByRole('button',{name:'乱斗连斩',exact:true}).click();await coordinates(2,3);await confirm();s=await read();assert.equal(s.heroRuntime.red.will,7);assert.equal(s.heroRuntime.red.chargeCount,1);assert.equal(s.formalTurns.red,1);assert.equal(s.turn,'black');assert.equal(s.pendingHeroChild,undefined);done('active brawl DOM pays once and same-piece allied allied enemy chain closes one formal turn');
 await load(chaosFixture(4));const insufficientBefore=await read();await page.locator('button[data-skill-key="ability:brawl"]').click();await page.getByLabel('技能棋子',{exact:true}).selectOption('brawler');await coordinates(0,6);await confirm();s=await read();assert.deepEqual(s,insufficientBefore);assert.equal(await page.getByRole('button',{name:'乱斗连斩',exact:true}).count(),0);done('brawl DOM refuses borrowing first kill resources without committing state');
 for(const [type,lethal] of [['pawn',false],['horse',true]]){
  await load(pair('warlock',[revealed('flame-center','red',type,3,8)]));await page.locator('button[data-skill-key="ability:burning_flame"]').click();await page.getByLabel('技能棋子',{exact:true}).selectOption('flame-center');await confirm();s=await read();assert.equal(s.captured.some(p=>p.id==='red-general'),lethal);assert(s.captured.some(p=>p.id==='flame-center'));done(`flame ${type} center DOM ${lethal?'eliminates':'spares'} neighboring general`);
 }
 const flameKings=pair('warlock',[revealed('flame-rook','black','rook',2,8)]);const otherKing=flameKings.state.pieces.find(p=>p.id==='black-general');otherKing.x=4;otherKing.y=8;
 await load(flameKings);await page.locator('button[data-skill-key="ability:burning_flame"]').click();await page.getByLabel('技能棋子',{exact:true}).selectOption('red-general');await confirm();s=await read();assert.equal(s.drawReason,'mutual_destruction');assert.equal(s.destructionBatches.length,1);assert.equal(s.destructionBatches[0].destroyedIds.length,3);done('general flame center DOM includes rook and both generals in one mutual destruction batch');
 const dragon=pair('devout_zealot',[revealed('protected','red','pawn',0,6),revealed('attacker','black','rook',0,2)],'front','invincible');dragon.state.heroRuntime.red.invokeCount=4;dragon.state.heroRuntime.red.omen=true;beginFormalTurn(dragon.state,dragon.secret,()=>0);dragon.state.turn='black';delete dragon.state.turnLifecycle;
 await load(dragon);await page.locator('#board-points .point[data-x="0"][data-y="2"]').click();await page.locator('#board-points .point[data-x="0"][data-y="6"]').click();s=await read();assert.equal(s.pieces.find(p=>p.id==='attacker').y,2);assert(s.pieces.some(p=>p.id==='protected'));assert.equal(s.effectsByPieceId.protected.dragonScale,undefined);assert.equal(s.formalTurns.black,1);done('ordinary board attack consumes dragon scale and returns attacker to origin');
 const scaledLanding=pair('sky_admiral',[{...revealed('scaled-flyer','red','horse',0,6),layer:'air'},revealed('scaled-ground','black','pawn',0,6)]);scaledLanding.state.effectsByPieceId['scaled-flyer']={flight:{source:'sky_admiral',owner:'red',remainingOwnerTurns:0,forcedLanding:true}};scaledLanding.state.effectsByPieceId['scaled-ground']={dragonScale:1};
 await load(scaledLanding);await page.getByRole('button',{name:'飞行期限已到：原地降落',exact:true}).click();s=await read();assert(s.pieces.some(p=>p.id==='scaled-ground'));assert.equal(s.effectsByPieceId['scaled-ground'].dragonScale,undefined);assert.equal(s.captured.find(p=>p.id==='scaled-flyer').cause,'suffocation');assert.equal(s.formalTurns.red,1);done('forced landing DOM consumes ground scale and suffocates flyer without retry');
 await page.waitForLoadState('networkidle');assert.deepEqual(report.errors,[]);report.passed=true;
} catch(e){report.passed=false;report.failure=e.stack;throw e;}
finally{await mkdir(resolve(root,'review/invariants'),{recursive:true});await writeFile(resolve(root,'review/invariants/HERO_TRANSFER_BROWSER_2026-10-07.json'),JSON.stringify(report,null,2)+'\n');await browser.close();await new Promise(done=>server.close(done));}
console.log(JSON.stringify({passed:report.passed,cases:report.cases.length,errors:report.errors.length}));
console.log(JSON.stringify({evidenceFile:'review/invariants/HERO_TRANSFER_BROWSER_2026-10-07.json',report}));

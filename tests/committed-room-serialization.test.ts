import assert from 'node:assert/strict';
import test from 'node:test';
import { runCommittedOutputResearch } from '../scripts/research/committed-output-research.ts';

const r=runCommittedOutputResearch();
test('committed half-chaos original110 preserve final room metadata,100 move messages and four exact server refusals',()=>{
  assert.equal(r.halfRows.length,110);assert.equal(r.halfRows.filter(x=>x.sourceKind==='normal_main'&&x.currentActionMessagePresent).length,100);
  const refused=r.halfRows.filter(x=>x.disposition==='rejected');assert.equal(refused.length,4);assert(refused.every(x=>x.serverRuleError!.code==='IN_CHECK'));
  assert.equal(r.totals.committedPublicJson,110);assert.equal(r.totals.committedPlayerJson,220);
  assert(r.halfRows.every(x=>x.exactCommittedReturn&&!x.midActionFrame&&!x.halfChaosBluetoothDelivery));
});
test('derived duplicate/refusal controls use exact original payloads and stay separate from original110 and client acceptance',()=>{
  assert.equal(r.duplicates.length,106);assert(r.duplicates.every(x=>x.actualDuplicate&&x.authorityHistoryClockUnchanged&&!x.clientReceipt));
  assert.equal(r.repeatRefusals.length,4);assert(r.repeatRefusals.every(x=>x.code==='IN_CHECK'&&x.authorityHistoryClockUnchanged&&!x.clientReceipt));
  assert.equal(r.totals.fullOriginal56Discharged,0);assert.equal(r.totals.formalOriginal64Accepted,0);assert.equal(r.totals.actualDeviceDeliveries,0);
});
test('actual web handlers preserve game authority/events/RNG across patch while fixing only rejected action output freshness',()=>{
  assert.equal(r.channelCases.length,6);assert(r.channelCases.every(x=>x.parentFixedAuthorityAndEventsAndDrawsEqual));
  assert.equal(r.privateWorldWirePairComparisons,3);assert.equal(r.privateWorldWirePairsEqual,3);
  assert(r.channelCases.filter(x=>x.deltaFromObservedDeadline>=0).every(x=>JSON.stringify(x.parentPacketTypes)==='["error"]'&&JSON.stringify(x.fixedPacketTypes)==='["error","snapshot"]'));
  assert(r.channelCases.every(x=>x.observedDeadline===65000&&x.authorityTurn==='red'&&x.fixedAppliedTurn==='red'&&!x.realRadioDelivery&&!x.actualDOMRender));
});

/** Research-only memory wrapper at the recorded send boundary, never app imported.
 * Exact raw string binding is conservative (even JSON key reordering mismatches).
 * Fixture scope/answers are NOT authenticated wire/native metadata.
 */
import { randomUUID } from 'node:crypto';
import { parseBluetoothEnvelope } from '../../src/bluetooth-protocol.ts';
export type Scope={actor:string|null;authority:string|null;room:string|null;match:string|null;provenance:'research_fixture_only'|'production_missing'};
export type Local='not_sent'|'written'|'unknown';
export class PendingMemory {
  #records=new Map<string,any>(); #instance=randomUUID(); #next=0; #limit:number;
  constructor(limit=256){if(!Number.isSafeInteger(limit)||limit<1)throw Error('limit');this.#limit=limit;}
  capture(raw:string,scope:Scope){
    const e=parseBluetoothEnvelope(raw);if(e.type!=='action')throw Error('action only');
    const token=this.#instance+':'+(++this.#next);this.#records.set(token,{token,raw,transportId:e.id??null,scope:structuredClone(scope),local:'unknown',outcome:'unknown',conflict:false});
    while(this.#records.size>this.#limit)this.#records.delete(this.#records.keys().next().value!);
    return token;
  }
  local(token:string,status:Local){if(!['not_sent','written','unknown'].includes(status))throw Error('local status');const r=this.#records.get(token);if(!r)return;
    r.local=status;if(status==='not_sent'&&r.outcome==='accepted'){r.conflict=true;r.outcome='unknown';}}
  inspect(token:string){return structuredClone(this.#records.get(token)??{outcome:'unknown',reason:'not_retained'});}
  /** Legacy lifecycle callbacks cannot authenticate an attempt or resolve it. */
  lifecycle(_event:unknown){return {covered:false,reason:'no_trusted_native_generation'};}
  /** Explicit test-only evidence seam. Not a parser/listener for real replies. */
  fixtureAnswer(token:string,binding:{raw:string;scope:Scope},answer:'accepted'|'rejected'|'unknown'){
    if(!['accepted','rejected','unknown'].includes(answer))throw Error('answer');
    const r=this.#records.get(token);if(!r)return 'unknown';
    if(r.scope.provenance!=='research_fixture_only'||binding.scope.provenance!=='research_fixture_only'||
      !r.transportId||['actor','authority','room','match'].some(k=>!r.scope[k]))return 'unknown';
    if(r.raw!==binding.raw||['actor','authority','room','match'].some(k=>r.scope[k]!==binding.scope[k as keyof Scope]))return 'binding_mismatch';
    if(r.conflict)return 'conflict';
    if((r.local==='not_sent'&&answer==='accepted')||(r.outcome!=='unknown'&&answer!=='unknown'&&r.outcome!==answer)){
      r.conflict=true;r.outcome='unknown';return 'conflict';}
    if(answer!=='unknown')r.outcome=answer;return r.outcome;
  }
}

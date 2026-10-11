import { mkdirSync, writeFileSync } from "node:fs";
import { resolve, join } from "node:path";
import { execFileSync } from "node:child_process";
import { MODE_QUALIFICATION_CASES, modeQualificationMetadata } from "./mode-qualification-cases.ts";
const output=process.argv[2];if(!output)throw new Error("Specify a private output directory");
const sourceCommit=execFileSync("git",["rev-parse","HEAD"],{encoding:"utf8"}).trim();
const dirty=execFileSync("git",["status","--porcelain"],{encoding:"utf8"}).trim().length>0;
const directory=resolve(output);mkdirSync(directory,{recursive:true,mode:0o700});
const cases=[];
for(const item of MODE_QUALIFICATION_CASES){
  const ctx={sessions:[]};
  try{const observed=item.run(ctx);ctx.sessions.forEach((s:any,i:number)=>s.save(join(directory,"private",item.id,String(i)),sourceCommit));cases.push({id:item.id,check:"passed",observed_runtime:observed});}
  catch(error){cases.push({id:item.id,check:"failed",error:String(error)});}
}
const report={...modeQualificationMetadata(),source_commit:sourceCommit,dirty_worktree:dirty,cases,checks_passed:cases.filter(c=>c.check==="passed").length,checks_total:cases.length};
writeFileSync(join(directory,"PUBLIC_ACCEPTANCE_SUMMARY.json"),JSON.stringify(report,null,2)+"\n",{mode:0o600});
process.stdout.write(JSON.stringify({source_commit:sourceCommit,dirty_worktree:dirty,passed:report.checks_passed,total:cases.length,formal_scoring_status:"frozen"})+"\n");
if(report.checks_passed!==cases.length)process.exitCode=1;

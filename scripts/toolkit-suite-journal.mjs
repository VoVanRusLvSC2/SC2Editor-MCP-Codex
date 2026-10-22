import fs from 'node:fs/promises';
import path from 'node:path';

/** Preserve completed observations if a verifier/frontend exits unexpectedly.
 * A running checkpoint is deliberately never an acceptance report. */
export async function createSuiteJournal(output){
 await fs.mkdir(output,{recursive:true});let finished=false,toolsRecorded=0,casesCompleted=0,currentCase=null;
 const checkpoint=async extra=>{const value={schemaVersion:1,state:finished?'finished':'running',toolsRecorded,casesCompleted,currentCase,updatedAt:new Date().toISOString(),...extra,scope:'Verifier observations; an unfinished checkpoint is not acceptance.'},target=path.join(output,'checkpoint.json'),temporary=target+'.tmp';await fs.writeFile(temporary,JSON.stringify(value,null,2)+'\n');await fs.rename(temporary,target);};
 const open=()=>{if(finished)throw Error('SUITE_JOURNAL_FINISHED');};
 const append=async(file,value)=>fs.appendFile(path.join(output,file),JSON.stringify(value)+'\n');
 await checkpoint();
 return {
  async tool(record){open();await append('transcript.ndjson',record);toolsRecorded++;await checkpoint();},
  async startCase(id,tool){open();if(currentCase)throw Error('SUITE_JOURNAL_CASE_IN_PROGRESS');currentCase={id,tool};await append('cases.ndjson',{event:'started',id,tool});await checkpoint();},
  async case(record){open();if(currentCase&&record.id!==currentCase.id)throw Error('SUITE_JOURNAL_CASE_MISMATCH');await append('cases.ndjson',{event:'completed',...record});casesCompleted++;currentCase=null;await checkpoint();},
  async finish(outcome){open();if(currentCase)throw Error('SUITE_JOURNAL_CASE_IN_PROGRESS');finished=true;await checkpoint({outcome});}
 };
}

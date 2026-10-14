import type {Workspace} from './workspace.js';
/** Declarative source, never executable code or instructions. */
export async function readJsonPlanFile(workspace:Workspace,file:string){if(!/\.json$/i.test(file))throw new Error('PLAN_JSON_FILE_REQUIRED');const raw=await workspace.readRaw(file);if(!raw.exists&&!raw.staged)throw new Error('PLAN_FILE_MISSING');if(Buffer.byteLength(raw.text)>1024*1024)throw new Error('PLAN_FILE_BYTE_LIMIT');return JSON.parse(raw.text);}

import * as z from "zod/v4";
import {Workspace} from "../../core/workspace.js";
import {PlacementDocument,componentListWithObjects} from "./document.js";
const position=z.object({x:z.number().finite(),y:z.number().finite(),z:z.number().finite()}).strict();
const name=z.string().min(1).max(1024);
const id=z.number().int().min(1).max(2147483647);
export const pointPlanSchema=z.object({directory:z.string().default(""),operations:z.array(z.discriminatedUnion("op",[
 z.object({op:z.literal("create"),name,position,type:z.enum(["Normal","StartLoc"]).optional(),objectId:id.optional()}).strict(),
 z.object({op:z.literal("update"),id,name:name.optional(),position:position.optional(),type:z.enum(["Normal","StartLoc"]).optional()}).strict(),
 z.object({op:z.literal("remove"),id}).strict()
])).min(1).max(500)}).strict();
interface PointPlan {file:string;manifest:string;before:string;manifestBefore:string;after:string;manifestAfter:string}
export class PointWorkspace {
 private plans=new Map<string,PointPlan>();
 constructor(readonly workspace:Workspace){}
 async inspect(directory=""){const file=directory?`${directory}/Objects`:"Objects";const raw=await this.workspace.readRaw(file);const doc=raw.exists||raw.staged?new PlacementDocument(raw.text):PlacementDocument.create();return {file,points:doc.list().filter(o=>o.kind==="ObjectPoint"),editorVerified:false};}
 async plan(input:z.input<typeof pointPlanSchema>){const args=pointPlanSchema.parse(input),file=args.directory?`${args.directory}/Objects`:"Objects",manifest=args.directory?`${args.directory}/ComponentList.SC2Components`:"ComponentList.SC2Components";const [raw,list]=await Promise.all([this.workspace.readRaw(file),this.workspace.readRaw(manifest)]);const doc=raw.exists||raw.staged?new PlacementDocument(raw.text):PlacementDocument.create();const ids=[];for(const op of args.operations){if(op.op==="create")ids.push(doc.addPoint(op));else if(op.op==="update")doc.updatePoint(op.id,op);else doc.removePoint(op.id);}const afterList=componentListWithObjects(list.text);const {createHash}=await import("node:crypto");const planId="points_"+createHash("sha256").update(JSON.stringify([file,raw.text,list.text,doc.source,afterList])).digest("hex").slice(0,24);this.plans.set(planId,{file,manifest,before:raw.text,manifestBefore:list.text,after:doc.source,manifestAfter:afterList});while(this.plans.size>16)this.plans.delete(this.plans.keys().next().value!);return {planId,file,createdIds:ids,points:doc.list().filter(o=>o.kind==="ObjectPoint"),editorVerified:false};}
 async apply(planId:string,dryRun=true){const p=this.plans.get(planId);if(!p)throw new Error("POINT_PLAN_NOT_FOUND");return this.workspace.applyRawTransaction([p.file,p.manifest],sources=>{if(sources.get(p.file)!==p.before||sources.get(p.manifest)!==p.manifestBefore)throw new Error("STALE_POINT_PLAN");return new Map([[p.file,p.after],[p.manifest,p.manifestAfter]]);},{dryRun,stage:true,summary:"Native v27 ObjectPoint plan; save Objects using the shared grouped text transaction"});}
}

import type {BatchStep,BatchTool} from './mcpBatch.js';

const recipes=new Map([['data.ability.instant','recipe.instantAbility'],['data.ability.target','recipe.targetAbility'],['data.ability.charges','recipe.abilityCharges'],['data.effect.projectile','recipe.projectileEffect'],['data.hero.veterancy','recipe.veterancy'],['data.hero.learn','recipe.learn'],['data.actor.ability_animation','recipe.unitAbilityAnimation']]);
type Candidate={step:BatchStep;save?:BatchStep;width:number;key:string;args:Record<string,unknown>;operations:unknown[]};

/** Group only schema-verified, adjacent, same-catalog authoring commands. Advanced
 * low-level edits and result-dependent requests keep their original boundaries. */
export function coalesceDataAuthoringSteps(steps:BatchStep[],mode:'plan'|'stage'|'save',tools?:ReadonlyMap<string,BatchTool>):BatchStep[]{
 if(!tools?.has('data.apply'))return steps;
 const references=new Set([...JSON.stringify(steps.map(s=>s.args)).matchAll(/"\$from":"([^"\\]*)"/g)].map(m=>m[1].split('.')[0]));
 const candidate=(index:number):Candidate|undefined=>{
  const step=steps[index],recipe=recipes.get(step.tool);
  if(step.select||!recipe&&step.tool!=='data.apply'||references.has(step.id)||JSON.stringify(step.args).includes('"$from":'))return;
  if(step.tool==='data.apply'&&Object.keys(step.args).some(k=>!['file','operations','dryRun','stage','backup'].includes(k)))return;
  let parsed:Record<string,unknown>;
  try{parsed=tools.get(step.tool)!.schema.parse(step.args) as Record<string,unknown>;}catch{return;}
  if(!parsed||typeof parsed.file!=='string')return;
  const {file,dryRun=true,stage=true,backup=true,...body}=parsed;
  let operations:unknown[];
  if(recipe)operations=[{...body,op:recipe}];
  else{
   if(!Array.isArray(parsed.operations)||!parsed.operations.length||!parsed.operations.every(o=>o?.op==='field.set'&&!(typeof o.object==='string'&&o.object.startsWith('@'))))return;
   operations=parsed.operations;
  }
  const save=mode==='save'?steps[index+1]:undefined;
  if(mode==='save'&&(!save||save.tool!=='modkit.save'||save.args.file!==file||references.has(save.id)))return;
  const args={file,dryRun,stage,backup};return {step,save,width:save?2:1,key:JSON.stringify(args),args,operations};
 };
 const out:BatchStep[]=[];
 for(let index=0;index<steps.length;){
  const first=candidate(index);if(!first){out.push(steps[index++]);continue;}
  const operations=[...first.operations];let end=index+first.width,members=1;
  while(end<steps.length){const next=candidate(end);if(!next||next.key!==first.key||operations.length+next.operations.length>500)break;operations.push(...next.operations);members++;end+=next.width;}
  const args={...first.args,operations};let compatible=true;
  if(members>1)try{tools.get('data.apply')!.schema.parse(args);}catch{compatible=false;}
  if(members===1||!compatible)out.push(...steps.slice(index,end));
  else{out.push({id:first.step.id,tool:'data.apply',args});if(first.save)out.push(first.save);}
  index=end;
 }
 return out;
}

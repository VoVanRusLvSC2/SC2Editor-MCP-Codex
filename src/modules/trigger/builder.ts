/** Compact local authoring helpers; output is the same strict MCP GUI plan. */
import type {GuiValue,GuiCall} from './authoring.js';
import type {GuiMemberAccess} from './typeSystem.js';
export const integer=(value:number):GuiValue=>({kind:'literal',type:'int',value});
export const real=(value:number|string):GuiValue=>({kind:'literal',type:'fixed',value});
export const boolean=(value:boolean):GuiValue=>({kind:'literal',type:'bool',value});
export const string=(value:string):GuiValue=>({kind:'literal',type:'string',value});
export const variable=(name:string,indices?:GuiValue[],members?:GuiMemberAccess[]):GuiValue=>({kind:'variable',name,indices,members});
export const parameter=(name:string):GuiValue=>({kind:'parameter',name});
export const preset=(name:string,owner?:string):GuiValue=>({kind:'preset',name,preset:owner});
export const call=(fn:string,args:Record<string,GuiValue|GuiValue[]>={}):GuiValue=>({kind:'call',function:fn,args});
export const action=(fn:string,args:Record<string,GuiValue|GuiValue[]>={}):GuiCall=>({kind:'Action',function:fn,args});
export const condition=(fn:string,args:Record<string,GuiValue|GuiValue[]>={}):GuiCall=>({kind:'Condition',function:fn,args});
export const event=(fn:string,args:Record<string,GuiValue|GuiValue[]>={}):GuiCall=>({kind:'Event',function:fn,args});
export const text=(value:string,ruRU?:string):GuiValue=>({kind:'text',value,translations:ruRU?{ruRU}:undefined});
export function at(base:GuiValue,...indices:GuiValue[]):GuiValue{if(base.kind!=='variable'&&base.kind!=='parameter')throw new Error('GUI_BUILDER_ACCESS_BASE');if(base.members?.length){const members=[...base.members],last=members.at(-1)!;members[members.length-1]={...last,indices:[...(last.indices??[]),...indices]};return {...base,members};}return {...base,indices:[...(base.indices??[]),...indices]};}
export function member(base:GuiValue,field:string):GuiValue{if(base.kind!=='variable'&&base.kind!=='parameter')throw new Error('GUI_BUILDER_ACCESS_BASE');return {...base,members:[...(base.members??[]),{field}]};}
